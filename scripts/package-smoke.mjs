import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = mkdtempSync(join(tmpdir(), "gl-package-smoke-"));
const consumerDir = join(tempDir, "consumer");

function runNpm(args, options = {}) {
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) throw new Error("Run this smoke test through `npm run test:package`");
  const command = process.execPath;
  const commandArgs = [npmExecPath, ...args];
  try {
    return execFileSync(command, commandArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
  } catch (error) {
    const details = [error.stdout, error.stderr].filter(Boolean).join("\n");
    throw new Error(`npm ${args.join(" ")} failed${details ? `:\n${details}` : ""}`, { cause: error });
  }
}

try {
  runNpm(["run", "build"], { cwd: projectRoot, stdio: "inherit" });
  const packed = JSON.parse(runNpm([
    "pack",
    "--ignore-scripts",
    "--pack-destination",
    tempDir,
    "--json",
  ], { cwd: projectRoot }));
  const tarballPath = join(tempDir, packed[0].filename);

  mkdirSync(consumerDir, { recursive: true });
  writeFileSync(join(consumerDir, "package.json"), JSON.stringify({ name: "gl-package-smoke", private: true, type: "module" }));
  runNpm([
    "install",
    "--prefix",
    consumerDir,
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    tarballPath,
  ], { cwd: tempDir });

  const apiProbe = `
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { compileAsync, compileSync, MemorySourceResolver } from "@u84u/gl";
import { NodeFileSourceResolver } from "@u84u/gl/node";
import { FetchSourceResolver } from "@u84u/gl/browser";
import { join } from "node:path";
const result = compileSync({
  target: "wgsl",
  source: "fn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }",
});
assert.equal(result.diagnostics.length, 0);
assert.match(result.code, /@fragment/);

const memory = new MemorySourceResolver();
memory.set("shader/color.gl", "fn red(): f32 { return 1.0 }");
const imported = await compileAsync({
  target: "glsl",
  sourceId: "shader/main.gl",
  source: 'import "./color.gl"\\nfn main(): vec4 { return vec4(red(), 0.0, 0.0, 1.0) }',
  resolver: memory,
});
assert.equal(imported.diagnostics.length, 0);
assert.match(imported.code, /red\\(\\)/);

const mainFile = join(process.cwd(), "main.gl");
await writeFile(join(process.cwd(), "color.gl"), "struct Color { f32 r }");
const nodeResolver = new NodeFileSourceResolver(process.cwd());
const nodeModule = await nodeResolver.resolve("./color.gl", {
  id: mainFile,
  displayName: mainFile,
  source: "",
});
assert.equal(nodeModule.source, "struct Color { f32 r }");

const browserResolver = new FetchSourceResolver("https://example.test/shaders/", async (url) => ({
  ok: true,
  status: 200,
  statusText: "OK",
  text: async () => "struct Color { f32 r }",
  url,
}));
const browserModule = await browserResolver.resolve("./color.gl", {
  id: "https://example.test/shaders/main.gl",
  displayName: "main.gl",
  source: "",
});
assert.equal(browserModule.id, "https://example.test/shaders/color.gl");
assert.equal(browserModule.source, "struct Color { f32 r }");
`;
  const apiProbePath = join(consumerDir, "api-smoke.mjs");
  writeFileSync(apiProbePath, apiProbe);
  execFileSync(process.execPath, [apiProbePath], { cwd: consumerDir, stdio: "inherit" });

  const packageManifest = JSON.parse(readFileSync(join(consumerDir, "node_modules", "@u84u", "gl", "package.json"), "utf8"));
  if (packageManifest.bin?.gl !== "dist/cli.js") {
    throw new Error("Packed package does not expose the expected gl CLI binary");
  }

  const resolvedCliPath = import.meta.resolve("@u84u/gl/cli", pathToFileURL(join(consumerDir, "api-smoke.mjs")).href);
  if (!resolvedCliPath.endsWith("/dist/cli.js")) {
    throw new Error(`Unexpected CLI export resolution: ${resolvedCliPath}`);
  }
  const versionOutput = runNpm(["exec", "--prefix", consumerDir, "--", "gl", "--version"], { cwd: consumerDir });
  if (!versionOutput.trim().startsWith("gl v")) {
    throw new Error(`Unexpected CLI version output: ${versionOutput}`);
  }

  const cliInput = join(consumerDir, "cli-smoke.gl");
  const cliOutput = join(consumerDir, "cli-smoke.wgsl");
  writeFileSync(cliInput, "fn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }");
  runNpm(["exec", "--prefix", consumerDir, "--", "gl", cliInput, "--target=wgsl", `--output=${cliOutput}`], { cwd: consumerDir });
  if (!readFileSync(cliOutput, "utf8").includes("@fragment")) {
    throw new Error("Installed CLI did not write expected WGSL output");
  }

  process.stdout.write("Packed package API, resolver exports, and CLI smoke checks passed.\n");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
