import { describe, it, expect } from "vitest";
import { compile } from "../src/index";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";

const VALIDATE_BIN = join(__dirname, "cvalidate", "build", "gl_validate");

function renderPixel(glslSource: string, width = 4, height = 4): string {
  const dir = mkdtempSync(join(tmpdir(), "gl-render-"));
  try {
    const glslPath = join(dir, "shader.glsl");
    writeFileSync(glslPath, glslSource);
    const output = execSync(`${VALIDATE_BIN} ${glslPath} ${width} ${height}`, {
      encoding: "utf-8",
    }).trim();
    // Output format: "<colored_count> <RRGGBBAA>" — return just the color
    return output.split(" ")[1] ?? output;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function compileToGlsl(source: string): string {
  const result = compile({ source, target: "glsl", file: "test.gl" });
  if (result.diagnostics.length > 0) {
    throw new Error(
      `Compile errors: ${result.diagnostics.map((d) => d.message).join(", ")}`
    );
  }
  if (!result.code) {
    throw new Error("No code generated");
  }
  return result.code;
}

describe("headless render validation (Mesa llvmpipe)", () => {
  it("renders solid color shader", () => {
    const glsl = compileToGlsl(`
      fn main(): vec4 {
        return vec4(1.0, 0.5, 0.25, 1.0)
      }
    `);
    const pixel = renderPixel(glsl);
    // vec4(1.0, 0.5, 0.25, 1.0) -> FF8040FF
    expect(pixel).toBe("FF8040FF");
  });

  it("renders black color", () => {
    const glsl = compileToGlsl(`
      fn main(): vec4 {
        return vec4(0.0, 0.0, 0.0, 1.0)
      }
    `);
    const pixel = renderPixel(glsl);
    expect(pixel).toBe("000000FF");
  });

  it("renders white color", () => {
    const glsl = compileToGlsl(`
      fn main(): vec4 {
        return vec4(1.0, 1.0, 1.0, 1.0)
      }
    `);
    const pixel = renderPixel(glsl);
    expect(pixel).toBe("FFFFFFFF");
  });

  it("renders conditional shader (true branch)", () => {
    const glsl = compileToGlsl(`
      fn main(): vec4 {
        let x: f32 = 1.0
        if (x > 0.5) {
          return vec4(1.0, 0.0, 0.0, 1.0)
        } else {
          return vec4(0.0, 0.0, 1.0, 1.0)
        }
      }
    `);
    const pixel = renderPixel(glsl);
    // x > 0.5 is true -> red
    expect(pixel).toBe("FF0000FF");
  });

  it("renders conditional shader (false branch)", () => {
    const glsl = compileToGlsl(`
      fn main(): vec4 {
        let x: f32 = 0.1
        if (x > 0.5) {
          return vec4(1.0, 0.0, 0.0, 1.0)
        } else {
          return vec4(0.0, 0.0, 1.0, 1.0)
        }
      }
    `);
    const pixel = renderPixel(glsl);
    // x > 0.5 is false -> blue
    expect(pixel).toBe("0000FFFF");
  });

  it("renders binary operations", () => {
    const glsl = compileToGlsl(`
      fn main(): vec4 {
        let a: f32 = 1.0
        let b: f32 = 2.0
        let c: f32 = a + b
        return vec4(c / 3.0, 0.0, 0.0, 1.0)
      }
    `);
    const pixel = renderPixel(glsl);
    // (1.0 + 2.0) / 3.0 = 1.0 -> red
    expect(pixel).toBe("FF0000FF");
  });

  it("rejects GLSL that fails to compile", () => {
    // This GLSL has a syntax error
    const badGlsl = "#version 450 core\nout vec4 fragColor;\nvoid main() { fragColor = ;\n}";
    const dir = mkdtempSync(join(tmpdir(), "gl-render-"));
    try {
      const glslPath = join(dir, "bad.glsl");
      writeFileSync(glslPath, badGlsl);
      expect(() =>
        execSync(`${VALIDATE_BIN} ${glslPath} 4 4`, { encoding: "utf-8" })
      ).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("traces GL calls with apitrace", () => {
    const glsl = compileToGlsl(`
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const dir = mkdtempSync(join(tmpdir(), "gl-render-"));
    try {
      const glslPath = join(dir, "shader.glsl");
      const tracePath = join(dir, "trace.trace");
      writeFileSync(glslPath, glsl);

      // Run validator under apitrace trace (may fail on link under some Mesa
      // versions, but trace file should still be created with captured calls)
      try {
        execSync(`apitrace trace -o ${tracePath} ${VALIDATE_BIN} ${glslPath} 4 4`, {
          encoding: "utf-8",
        });
      } catch {
        // apitrace tracing may fail on link; that's OK for this test
      }

      // Trace file should exist and contain captured GL calls
      expect(existsSync(tracePath)).toBe(true);

      const dump = execSync(`apitrace dump ${tracePath}`, {
        encoding: "utf-8",
      });

      // Should capture shader compilation
      expect(dump).toMatch(/glCompileShader/);
      // Should capture program linking
      expect(dump).toMatch(/glLinkProgram/);
      // Should capture shader source with our vec4 value
      expect(dump).toMatch(/1\.0.*0\.0.*0\.0.*1\.0/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
