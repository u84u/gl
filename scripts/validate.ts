/**
 * Cross-platform build script for the C shader validator.
 *
 * Detects the host OS and constructs the appropriate compiler command
 * to build `test/cvalidate/src/main.c` into `test/cvalidate/build/gl_validate`.
 *
 * Usage:
 *   npx tsx scripts/validate.ts build   # compile the validator
 *   npx tsx scripts/validate.ts validate # compile + run a smoke test
 */

import { execSync, spawnSync } from "child_process";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "test", "cvalidate", "src", "main.c");
const OUT_DIR = join(ROOT, "test", "cvalidate", "build");
const OUT_NAME =
  process.platform === "win32" ? "gl_validate.exe" : "gl_validate";
const OUT_PATH = join(OUT_DIR, OUT_NAME);

type Platform = "linux" | "darwin" | "win32";

function detectPlatform(): Platform {
  switch (process.platform) {
    case "linux":
      return "linux";
    case "darwin":
      return "darwin";
    case "win32":
      return "win32";
    default:
      throw new Error(
        `Unsupported platform for C validator build: ${process.platform}`
      );
  }
}

function buildCommand(plat: Platform): string[] {
  const cmd: string[] = [];

  switch (plat) {
    case "linux":
      cmd.push("gcc");
      cmd.push("-Wall", "-Wextra", "-Wpedantic", "-std=c99");
      cmd.push("-o", OUT_PATH);
      cmd.push(SRC);
      cmd.push("-lOSMesa", "-lGL", "-lm");
      break;
    case "darwin":
      cmd.push("clang");
      cmd.push("-Wall", "-Wextra", "-Wpedantic");
      cmd.push("-o", OUT_PATH);
      cmd.push(SRC);
      cmd.push("-framework", "OpenGL");
      break;
    case "win32":
      cmd.push("cl");
      cmd.push("/nologo", "/W4");
      cmd.push("/Fe:" + OUT_PATH);
      cmd.push(SRC);
      cmd.push("opengl32.lib");
      break;
  }

  return cmd;
}

function smokeTest(): void {
  const tmpShader = join(tmpdir(), "gl-validate-smoke.glsl");
  writeFileSync(
    tmpShader,
    "#version 450 core\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0, 0.5, 0.25, 1.0); }\n"
  );

  try {
    const result = spawnSync(OUT_PATH, [tmpShader, "4", "4"], {
      stdio: "pipe",
      encoding: "utf-8",
    });

    if (result.status !== 0) {
      console.error(
        `Validator smoke test failed (exit ${result.status}):\n${result.stderr}`
      );
      process.exit(1);
    }

    const output = (result.stdout || "").trim();
    console.log(`[smoke] validator output: ${output}`);

    // Expect: "<colored_count> <RRGGBBAA>" -> FF8040FF
    const color = output.split(" ")[1];
    if (color !== "FF8040FF") {
      console.error(
        `Validator smoke test failed: expected color FF8040FF, got ${color ?? "<none>"}`
      );
      process.exit(1);
    }

    console.log("[smoke] validator smoke test passed");
  } finally {
    rmSync(tmpShader, { force: true });
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0] ?? "build";

  if (command !== "build" && command !== "validate") {
    console.error(
      `Usage: npx tsx scripts/validate.ts [build|validate]`
    );
    process.exit(1);
  }

  const plat = detectPlatform();
  console.log(`[${plat}] Building C validator...`);

  mkdirSync(OUT_DIR, { recursive: true });

  const cmd = buildCommand(plat);
  console.log(`[${plat}] ${cmd.join(" ")}`);

  try {
    execSync(cmd.join(" "), { stdio: "inherit", cwd: ROOT });
  } catch (err) {
    console.error(`[${plat}] Build failed: ${err}`);
    process.exit(1);
  }

  console.log(`[${plat}] Build complete: ${OUT_PATH}`);

  if (command === "validate") {
    smokeTest();
  }
}

main();
