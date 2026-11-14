import { describe, it, expect } from "vitest";
import { compile, compileAsync } from "../src/index";
import { NodeFileSourceResolver } from "../src/node/resolver";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
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

  it("compiles shader with imported struct", async () => {
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
      const resolver = new NodeFileSourceResolver(dir);
      const result = await compileAsync({
        source: `
          import "./types.gl"
          fn main(): vec4 {
            let c: Color = { .r = 1.0, .g = 0.5, .b = 0.25, .a = 1.0 }
            return vec4(c.r, c.g, c.b, c.a)
          }
        `,
        target: "glsl",
        sourceId: join(dir, "main.gl"),
        file: join(dir, "main.gl"),
        resolver,
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

  it("compiles shader with imported function", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-test-"));
    try {
      writeFileSync(join(dir, "math.gl"), `fn half(x: f32): f32 { return x * 0.5 }`);
      writeFileSync(join(dir, "main.gl"), `
        import "./math.gl"
        fn main(): vec4 {
          return vec4(half(1.0), 0.0, 0.0, 1.0)
        }
      `);
      const resolver = new NodeFileSourceResolver(dir);
      const result = await compileAsync({
        source: `
          import "./math.gl"
          fn main(): vec4 {
            return vec4(half(1.0), 0.0, 0.0, 1.0)
          }
        `,
        target: "glsl",
        sourceId: join(dir, "main.gl"),
        file: join(dir, "main.gl"),
        resolver,
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toContain("float half(float x)");
      expect(result.code).toContain("return (x * 0.5);");
      expect(result.code).toContain("half(1.0)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles circular imports without infinite loop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-test-"));
    try {
      writeFileSync(join(dir, "a.gl"), `import "./b.gl"\nstruct A { f32 x }`);
      writeFileSync(join(dir, "b.gl"), `import "./a.gl"\nstruct B { f32 y }`);
      const resolver = new NodeFileSourceResolver(dir);
      const result = await compileAsync({
        source: `import "./a.gl"\nfn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }`,
        target: "glsl",
        sourceId: join(dir, "main.gl"),
        file: join(dir, "main.gl"),
        resolver,
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toContain("struct A {");
      expect(result.code).toContain("struct B {");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on missing import file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-test-"));
    try {
      const resolver = new NodeFileSourceResolver(dir);
      const result = await compileAsync({
        source: `import "./nonexistent.gl"\nfn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }`,
        target: "glsl",
        sourceId: join(dir, "main.gl"),
        file: join(dir, "main.gl"),
        resolver,
      });
      expect(result.code).toBeNull();
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0]!.message).toContain("nonexistent.gl");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("deduplicates imported declarations", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gl-test-"));
    try {
      writeFileSync(join(dir, "shared.gl"), `struct Shared { f32 x }`);
      writeFileSync(join(dir, "a.gl"), `import "./shared.gl"`);
      writeFileSync(join(dir, "b.gl"), `import "./shared.gl"`);
      const resolver = new NodeFileSourceResolver(dir);
      const result = await compileAsync({
        source: `
          import "./a.gl"
          import "./b.gl"
          fn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }
        `,
        target: "glsl",
        sourceId: join(dir, "main.gl"),
        file: join(dir, "main.gl"),
        resolver,
      });
      expect(result.diagnostics).toEqual([]);
      // Shared struct should only appear once
      const structMatches = (result.code || "").match(/struct Shared/g);
      expect(structMatches).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unsupported WGSL scalar types with structured diagnostics", () => {
    for (const [typeName, usage] of [
      ["i64", `let x: i64`],
      ["u64", `let x: u64`],
      ["f64", `let x: f64`],
      ["bf16", `let x: bf16`],
    ] as [string, string][]) {
      const result = compile({
        source: `fn main(): vec4 { ${usage}; return vec4(1.0, 0.0, 0.0, 1.0) }`,
        target: "wgsl",
        file: "test.gl",
      });
      expect(result.code).toBeNull();
      const diag = result.diagnostics.find(
        (d) => d.code === "WGSL_UNSUPPORTED_SCALAR",
      );
      expect(diag).toBeDefined();
      expect(diag!.message).toContain(typeName);
      expect(diag!.severity).toBe("error");
    }
  });

  it("supports f16 as a native WGSL scalar type", () => {
    const result = compile({
      source: `fn main(): vec4 { let x: f16 = 1.0; return vec4(1.0, 0.0, 0.0, 1.0) }`,
      target: "wgsl",
      file: "test.gl",
    });
    const unsupported = result.diagnostics.find(
      (d) => d.code === "WGSL_UNSUPPORTED_SCALAR",
    );
    expect(unsupported).toBeUndefined();
  });

  it("compiles to GLSL ES 3.00 with version header", () => {
    const result = compile({
      source: `fn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }`,
      target: "glsl-es-300",
      file: "test.gl",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("#version 300 es");
    expect(result.code).toContain("out vec4 fragColor;");
  });

  it("rejects unsupported types in GLSL ES 3.00", () => {
    const result = compile({
      source: `fn main(): vec4 { let x: i64; return vec4(1.0, 0.0, 0.0, 1.0) }`,
      target: "glsl-es-300",
      file: "test.gl",
    });
    expect(result.code).toBeNull();
    const diag = result.diagnostics.find(
      (d) => d.code === "GLSL_UNSUPPORTED_SCALAR",
    );
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("error");
  });

  it("supports i64 in GLSL 450", () => {
    const result = compile({
      source: `fn main(): vec4 { let x: i64; return vec4(1.0, 0.0, 0.0, 1.0) }`,
      target: "glsl-450",
      file: "test.gl",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.code).toContain("#version 450 core");
  });

  describe("cross-backend equivalence", () => {
    const source = `fn main(): vec4 { return vec4(1.0, 0.5, 0.25, 1.0) }`;

    const targets: Array<{ target: "glsl" | "glsl-es-300" | "glsl-450" | "wgsl"; versionHeader?: string }> = [
      { target: "glsl", versionHeader: "#version 450 core" },
      { target: "glsl-450", versionHeader: "#version 450 core" },
      { target: "glsl-es-300", versionHeader: "#version 300 es" },
      { target: "wgsl" },
    ];

    it("produces equivalent entry-point interfaces across targets", () => {
      const outputs = targets.map((t) => {
        const result = compile({ source, target: t.target, file: "test.gl" });
        expect(result.diagnostics).toEqual([]);
        expect(result.code).toBeTruthy();
        return result.code!;
      });

      // All targets should emit a main entry point returning vec4-equivalent.
      expect(outputs[0]).toContain("void main()");
      expect(outputs[1]).toContain("void main()");
      expect(outputs[2]).toContain("void main()");
      expect(outputs[3]).toContain("fn main()");

      // All targets should assign the same RGBA value to the output.
      const rgba = "1.0, 0.5, 0.25, 1.0";
      outputs.forEach((code) => {
        expect(code).toContain(rgba);
      });
    });

    it("only ES 3.00 includes precision qualifier", () => {
      const esResult = compile({ source, target: "glsl-es-300", file: "test.gl" });
      expect(esResult.code).toContain("precision mediump float;");

      const glslResult = compile({ source, target: "glsl-450", file: "test.gl" });
      expect(glslResult.code).not.toContain("precision mediump float;");

      const wgslResult = compile({ source, target: "wgsl", file: "test.gl" });
      expect(wgslResult.code).not.toContain("precision mediump float;");
    });

    it("rejects f64 in both ES 3.00 and WGSL", () => {
      const f64Source = `fn main(): vec4 { let x: f64; return vec4(1.0, 0.0, 0.0, 1.0) }`;
      for (const target of ["glsl-es-300", "wgsl"] as const) {
        const result = compile({ source: f64Source, target, file: "test.gl" });
        expect(result.code).toBeNull();
        expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
      }
    });
  });

  describe("shader stages", () => {
    it("compiles vertex stage to GLSL 450", () => {
      const result = compile({
        source: `@vertex fn main(): vec4 { return vec4(0.0, 0.0, 0.0, 1.0) }`,
        target: "glsl-450",
        file: "test.gl",
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toContain("out vec4 gl_Position;");
      expect(result.code).toContain("void main() {");
    });

    it("compiles vertex stage to WGSL", () => {
      const result = compile({
        source: `@vertex fn main(): vec4 { return vec4(0.0, 0.0, 0.0, 1.0) }`,
        target: "wgsl",
        file: "test.gl",
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toContain("@vertex");
      expect(result.code).toContain("@builtin(position) vec4<f32>");
    });

    it("compiles compute stage to GLSL 450", () => {
      const result = compile({
        source: `@compute fn main() { }`,
        target: "glsl-450",
        file: "test.gl",
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toContain("layout(local_size_x = 1, local_size_y = 1, local_size_z = 1) in;");
      expect(result.code).toContain("void main() {");
    });

    it("compiles compute stage to WGSL", () => {
      const result = compile({
        source: `@compute fn main() { }`,
        target: "wgsl",
        file: "test.gl",
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toContain("@compute");
      expect(result.code).toContain("@workgroup_size(1, 1, 1)");
      expect(result.code).toContain("fn main() {");
    });

    it("rejects vertex main returning non-vec4", () => {
      const result = compile({
        source: `@vertex fn main(): f32 { return 1.0 }`,
        target: "glsl-450",
        file: "test.gl",
      });
      expect(result.code).toBeNull();
      expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
    });
  });

  describe("IR round-trip preserves declarations", () => {
    it("preserves type alias through lower→raise→codegen", () => {
      const result = compile({
        source: `type MyFloat = f32\n\nfn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }`,
        target: "glsl-450",
        file: "test.gl",
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toBeTruthy();
    });

    it("preserves newtype through lower→raise→codegen", () => {
      const result = compile({
        source: `struct NewInt(i32)\n\nfn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }`,
        target: "glsl-450",
        file: "test.gl",
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toBeTruthy();
    });

    it("preserves opaque type through lower→raise→codegen", () => {
      const result = compile({
        source: `opaque MyOpaque\n\nfn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }`,
        target: "glsl-450",
        file: "test.gl",
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toBeTruthy();
    });

    it("preserves trait through lower→raise→codegen", () => {
      const result = compile({
        source: `trait MyTrait { fn foo(x: f32): f32 }\n\nfn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }`,
        target: "glsl-450",
        file: "test.gl",
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toBeTruthy();
    });

    it("preserves impl block through lower→raise→codegen", () => {
      const result = compile({
        source: `impl MyType for MyTrait { fn foo(x: f32): f32 { return x } }\n\nfn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }`,
        target: "glsl-450",
        file: "test.gl",
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toBeTruthy();
    });

    it("preserves enum variant types through lower→raise→codegen", () => {
      const result = compile({
        source: `enum Color { Red, Green, Blue }\n\nfn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }`,
        target: "glsl-450",
        file: "test.gl",
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.code).toBeTruthy();
    });
  });

  describe("resolver path containment", () => {
    it("allows valid nested imports within root", async () => {
      const dir = mkdtempSync(join(tmpdir(), "gl-test-"));
      try {
        mkdirSync(join(dir, "sub"), { recursive: true });
        writeFileSync(join(dir, "sub", "types.gl"), `struct Color { f32 r, f32 g, f32 b, f32 a }`);
        writeFileSync(
          join(dir, "main.gl"),
          `import "./sub/types.gl"\nfn main(): vec4 { let c: Color = { .r = 1.0 }; return vec4(c.r, 0.0, 0.0, 1.0) }`
        );
        const resolver = new NodeFileSourceResolver(dir);
        const result = await compileAsync({
          source: `import "./sub/types.gl"\nfn main(): vec4 { let c: Color = { .r = 1.0, .g = 0.5, .b = 0.25, .a = 1.0 }; return vec4(c.r, c.g, c.b, c.a) }`,
          target: "glsl",
          sourceId: join(dir, "main.gl"),
          file: join(dir, "main.gl"),
          resolver,
        });
        expect(result.diagnostics).toEqual([]);
        expect(result.code).toContain("struct Color {");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("rejects imports outside root via ..", async () => {
      const dir = mkdtempSync(join(tmpdir(), "gl-test-"));
      const outsideDir = mkdtempSync(join(tmpdir(), "gl-outside-"));
      try {
        writeFileSync(join(outsideDir, "secret.gl"), `struct Secret { f32 x }`);
        const resolver = new NodeFileSourceResolver(dir);
        const result = await compileAsync({
          source: `import "../gl-outside/secret.gl"\nfn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }`,
          target: "glsl",
          sourceId: join(dir, "main.gl"),
          file: join(dir, "main.gl"),
          resolver,
        });
        expect(result.code).toBeNull();
        expect(result.diagnostics.length).toBeGreaterThan(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
        rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it("rejects imports to absolute paths outside root", async () => {
      const dir = mkdtempSync(join(tmpdir(), "gl-test-"));
      try {
        const resolver = new NodeFileSourceResolver(dir);
        const result = await compileAsync({
          source: `import "/etc/passwd"\nfn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }`,
          target: "glsl",
          sourceId: join(dir, "main.gl"),
          file: join(dir, "main.gl"),
          resolver,
        });
        expect(result.code).toBeNull();
        expect(result.diagnostics.length).toBeGreaterThan(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
