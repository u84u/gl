import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { compile } from "../src/index";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures", "wgsl");

function readText(file: string): string {
  return readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
}

function getFixtureNames(): string[] {
  return readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".gl"))
    .map((f) => f.replace(/\.gl$/, ""))
    .filter((name) => {
      try {
        readFileSync(join(fixturesDir, `${name}.wgsl`), "utf-8");
        return true;
      } catch {
        return false;
      }
    })
    .sort();
}

describe("golden-file WGSL output", () => {
  const names = getFixtureNames();
  it(`discovers ${names.length} WGSL fixtures`, () => {
    expect(names.length).toBeGreaterThan(0);
  });
  for (const name of names) {
    it(`matches golden output for ${name}`, () => {
      const source = readText(join(fixturesDir, `${name}.gl`));
      const expected = readText(join(fixturesDir, `${name}.wgsl`));

      const result = compile({ source, target: "wgsl", file: join(fixturesDir, `${name}.gl`) });

      expect(result.diagnostics).toEqual([]);
      expect(result.code).toBe(expected);
    });
  }
});
