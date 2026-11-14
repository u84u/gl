import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { compile, compileAsync } from "../src/index";
import { NodeFileSourceResolver } from "../src/node/resolver";

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
    it(`matches golden output for ${name}`, async () => {
      const file = join(fixturesDir, `${name}.gl`);
      const source = readFileSync(file, "utf-8");
      const expected = readFileSync(join(expectedDir, `${name}.glsl`), "utf-8");

      let result;
      if (source.includes("import")) {
        const resolver = new NodeFileSourceResolver(fixturesDir);
        result = await compileAsync({
          source,
          target: "glsl",
          sourceId: file,
          file,
          resolver,
        });
      } else {
        result = compile({ source, target: "glsl", file });
      }

      expect(result.diagnostics).toEqual([]);
      expect(result.code).toBe(expected);
    });
  }
});
