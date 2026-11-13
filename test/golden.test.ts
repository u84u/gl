import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { compile } from "../src/index";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures", "gl");
const expectedDir = join(__dirname, "fixtures", "glsl");

function getFixtureNames(): string[] {
  return readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".gl"))
    .map((f) => f.replace(/\.gl$/, ""))
    .filter((name) => {
      try {
        readFileSync(join(expectedDir, `${name}.glsl`), "utf-8");
        return true;
      } catch {
        return false;
      }
    })
    .sort();
}

describe("golden-file GLSL output", () => {
  const names = getFixtureNames();
  for (const name of names) {
    it(`matches golden output for ${name}`, () => {
      const source = readFileSync(join(fixturesDir, `${name}.gl`), "utf-8");
      const expected = readFileSync(join(expectedDir, `${name}.glsl`), "utf-8");

      const result = compile({ source, target: "glsl", file: join(fixturesDir, `${name}.gl`) });

      expect(result.diagnostics).toEqual([]);
      expect(result.code).toBe(expected);
    });
  }
});
