import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "../src/index";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "wgsl");
const nagaCli = fileURLToPath(import.meta.resolve("naga-wasi-cli/bin/naga.mjs"));

function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

describe("WGSL validation with Naga", () => {
  it("accepts every generated WGSL fixture", () => {
    const tempDir = mkdtempSync(join(process.cwd(), ".wgsl-validation-"));
    try {
      const inputs: string[] = [];
      const sources = readdirSync(fixturesDir).filter((name) => name.endsWith(".gl")).sort();

      for (const sourceName of sources) {
        const sourcePath = join(fixturesDir, sourceName);
        const result = compile({ source: readText(sourcePath), target: "wgsl", file: sourcePath });
        expect(result.diagnostics, sourceName).toEqual([]);
        expect(result.shaders.length, sourceName).toBeGreaterThan(0);

        result.shaders.forEach((shader, index) => {
          const inputPath = `${sourceName.replace(/\.gl$/, "")}-${index}.wgsl`;
          writeFileSync(join(tempDir, inputPath), shader.code);
          inputs.push(`./${tempDir.split(/[\\/]/).pop()}/${inputPath}`);
        });
      }

      execFileSync(process.execPath, [nagaCli, "--bulk-validate", ...inputs], {
        encoding: "utf8",
        timeout: 120_000,
      });

      const invalidPath = join(tempDir, "invalid.wgsl");
      const relativeInvalidPath = `./${tempDir.split(/[\\/]/).pop()}/invalid.wgsl`;
      writeFileSync(invalidPath, "@fragment fn main() { let value: i32 = ; }");
      const invalidResult = spawnSync(process.execPath, [nagaCli, relativeInvalidPath], {
        encoding: "utf8",
        timeout: 30_000,
      });
      expect(invalidResult.status).not.toBe(0);
      expect(invalidResult.stderr).toContain("expected expression");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 180_000);
});
