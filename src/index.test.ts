import { describe, it, expect } from "vitest";
import { compile } from "../src/index";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("compile API", () => {
  it("compiles valid shader to GLSL", () => {
    const result = compile({
      source: `fn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }`,
      target: "glsl",
      file: "test.gl",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("#version 450 core");
    expect(result.code).toContain("out vec4 fragColor;");
    expect(result.code).toContain("void main() {");
    expect(result.code).toContain("fragColor = vec4(1.0, 0.0, 0.0, 1.0);");
  });

  it("compiles valid shader to WGSL", () => {
    const result = compile({
      source: `fn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }`,
      target: "wgsl",
      file: "test.wgsl",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("@fragment");
    expect(result.code).toContain("fn main() -> @location(0) vec4<f32>");
    expect(result.code).toContain("return vec4<f32>(1.0, 0.0, 0.0, 1.0);");
  });

  it("throws for unknown target", () => {
    const result = compile({
      source: "fn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }",
      target: ("hlsl" as string) as "glsl" | "wgsl",
      file: "test.gl",
    });
    expect(result.code).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]!.message).toContain("Unknown target");
  });

  it("returns diagnostics for invalid shader", () => {
    const result = compile({
      source: `fn main(): vec4 { return vec4(undeclared, 0.0, 0.0, 1.0) }`,
      target: "glsl",
      file: "test.gl",
    });
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0]!.message).toContain("Undeclared identifier");
    expect(result.code).toBeNull();
  });

  it("does not emit code when there are diagnostics", () => {
    const result = compile({
      source: `fn main(): vec4 { return vec4(undeclared, 0.0, 0.0, 1.0) }`,
      target: "glsl",
      file: "test.gl",
    });
    expect(result.code).toBeNull();
  });

  it("includes file name in diagnostics", () => {
    const result = compile({
      source: `fn main(): vec4 { return vec4(undeclared, 0.0, 0.0, 1.0) }`,
      target: "glsl",
      file: "shader.gl",
    });
    expect(result.diagnostics[0]!.file).toBe("shader.gl");
  });

  it("includes span info in diagnostics", () => {
    const result = compile({
      source: `fn main(): vec4 { return vec4(undeclared, 0.0, 0.0, 1.0) }`,
      target: "glsl",
      file: "test.gl",
    });
    const d = result.diagnostics[0]!;
    expect(d.span.line).toBeGreaterThan(0);
    expect(d.span.column).toBeGreaterThan(0);
  });

  it("compiles shader with imported struct", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-test-"));
    try {
      writeFileSync(join(dir, "types.gl"), `struct Color { f32 r, f32 g, f32 b, f32 a }`);
      writeFileSync(join(dir, "main.gl"), `
        import "./types.gl"
        fn main(): vec4 {
          let c: Color = { .r = 1.0, .g = 0.5, .b = 0.25, .a = 1.0 }
          return vec4(c.r, c.g, c.b, c.a)
        }
      `);
      const result = compile({
        source: `
          import "./types.gl"
          fn main(): vec4 {
            let c: Color = { .r = 1.0, .g = 0.5, .b = 0.25, .a = 1.0 }
            return vec4(c.r, c.g, c.b, c.a)
          }
        `,
        target: "glsl",
        file: join(dir, "main.gl"),
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toContain("struct Color {");
      expect(result.code).toContain("float r;");
      expect(result.code).toContain("float g;");
      expect(result.code).toContain("float b;");
      expect(result.code).toContain("float a;");
      expect(result.code).toContain("Color c = Color(1.0, 0.5, 0.25, 1.0);");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("compiles shader with imported function", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-test-"));
    try {
      writeFileSync(join(dir, "math.gl"), `fn half(x: f32): f32 { return x * 0.5 }`);
      writeFileSync(join(dir, "main.gl"), `
        import "./math.gl"
        fn main(): vec4 {
          return vec4(half(1.0), 0.0, 0.0, 1.0)
        }
      `);
      const result = compile({
        source: `
          import "./math.gl"
          fn main(): vec4 {
            return vec4(half(1.0), 0.0, 0.0, 1.0)
          }
        `,
        target: "glsl",
        file: join(dir, "main.gl"),
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toContain("float half(float x)");
      expect(result.code).toContain("return (x * 0.5);");
      expect(result.code).toContain("half(1.0)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles circular imports without infinite loop", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-test-"));
    try {
      writeFileSync(join(dir, "a.gl"), `import "./b.gl"\nstruct A { f32 x }`);
      writeFileSync(join(dir, "b.gl"), `import "./a.gl"\nstruct B { f32 y }`);
      const result = compile({
        source: `import "./a.gl"\nfn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }`,
        target: "glsl",
        file: join(dir, "main.gl"),
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toContain("struct A {");
      expect(result.code).toContain("struct B {");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on missing import file", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-test-"));
    try {
      const result = compile({
        source: `import "./nonexistent.gl"\nfn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }`,
        target: "glsl",
        file: join(dir, "main.gl"),
      });
      expect(result.code).toBeNull();
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0]!.message).toContain("nonexistent.gl");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("deduplicates imported declarations", () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-test-"));
    try {
      writeFileSync(join(dir, "shared.gl"), `struct Shared { f32 x }`);
      writeFileSync(join(dir, "a.gl"), `import "./shared.gl"`);
      writeFileSync(join(dir, "b.gl"), `import "./shared.gl"`);
      const result = compile({
        source: `
          import "./a.gl"
          import "./b.gl"
          fn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }
        `,
        target: "glsl",
        file: join(dir, "main.gl"),
      });
      expect(result.diagnostics).toEqual([]);
      // Shared struct should only appear once
      const structMatches = (result.code || "").match(/struct Shared/g);
      expect(structMatches).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
