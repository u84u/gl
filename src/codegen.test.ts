import { describe, it, expect } from "vitest";
import { tokenize } from "../src/lexer";
import { parse } from "../src/parser";
import { compile } from "../src/index";
import { generateGLSL } from "../src/codegen/glsl";

function compileToGLSL(source: string) {
  return generateGLSL(parse(tokenize(source)));
}

describe("codegen/glsl", () => {
  it("emits main as out vec4 fragColor with void main", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("#version 450 core");
    expect(code).toContain("out vec4 fragColor;");
    expect(code).toContain("void main() {");
    expect(code).toContain("fragColor = vec4(1.0, 0.0, 0.0, 1.0);");
  });

  it("emits struct declarations", () => {
    const code = compileToGLSL(`
      struct Point { i32 x, i32 y }
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("struct Point {");
    expect(code).toContain("int x;");
    expect(code).toContain("int y;");
    expect(code).toContain("};");
  });

  it("emits variable declarations with initializers", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let x: f32 = 1.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("float x = 1.0;");
    expect(code).toContain("fragColor = vec4(x, 0.0, 0.0, 1.0);");
  });

  it("emits struct literal as constructor call", () => {
    const code = compileToGLSL(`
      struct Color { f32 r, f32 g, f32 b, f32 a }
      fn main(): vec4 {
        let c: Color = { .r = 1.0, .g = 0.5, .b = 0.25, .a = 1.0 }
        return vec4(c.r, c.g, c.b, c.a)
      }
    `);
    expect(code).toContain("Color(1.0, 0.5, 0.25, 1.0)");
  });

  it("emits if-else statements", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let x: f32 = 1.0
        if (x > 0.5) {
          return vec4(1.0, 0.0, 0.0, 1.0)
        } else {
          return vec4(0.0, 0.0, 0.0, 1.0)
        }
      }
    `);
    expect(code).toContain("if ((x > 0.5))");
    expect(code).toContain("else");
    expect(code).toContain("fragColor = vec4(1.0, 0.0, 0.0, 1.0);");
    expect(code).toContain("fragColor = vec4(0.0, 0.0, 0.0, 1.0);");
  });

  it("emits if without else", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        if (true) {
          return vec4(1.0, 0.0, 0.0, 1.0)
        }
        return vec4(0.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("if (true)");
    expect(code).not.toContain("else");
  });

  it("emits member access", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let v: vec4 = vec4(1.0, 0.0, 0.0, 1.0)
        return vec4(v.x, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("v.x");
  });

  it("emits swizzle expressions", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let v: vec4 = vec4(1.0, 0.0, 0.0, 1.0)
        return vec4(v.rgb, 1.0)
      }
    `);
    expect(code).toContain("v.rgb");
  });

  it("emits binary expressions with parentheses", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let x: f32 = 1.0 + 2.0 * 3.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("(1.0 + (2.0 * 3.0))");
  });

  it("emits unary expressions", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let x: f32 = -1.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("(-1.0)");
  });

  it("emits function calls", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        return dot(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0))
      }
    `);
    expect(code).toContain("dot(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0))");
  });

  it("emits helper functions before main", () => {
    const code = compileToGLSL(`
      fn helper(x: f32): f32 {
        return x * 2.0
      }
      fn main(): vec4 {
        return vec4(helper(1.0), 0.0, 0.0, 1.0)
      }
    `);
    const helperIdx = code.indexOf("float helper");
    const mainIdx = code.indexOf("void main");
    expect(helperIdx).toBeGreaterThan(-1);
    expect(mainIdx).toBeGreaterThan(helperIdx);
  });

  it("emits integer literals without decimal", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let x: i32 = 42
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("int x = 42;");
  });

  it("emits float literals with .0", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let x: f32 = 1.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("float x = 1.0;");
  });

  it("emits boolean literals", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let b: bool = true
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("bool b = true;");
  });

  it("throws when main returns non-vec4", () => {
    expect(() => compileToGLSL(`
      fn main(): i32 {
        return 42
      }
    `)).toThrow("main must return vec4");
  });

  it("throws when main has parameters", () => {
    expect(() => compileToGLSL(`
      fn main(x: i32): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `)).toThrow("main must take no parameters");
  });

  it("throws when no main function", () => {
    expect(() => compileToGLSL(`
      fn helper(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `)).toThrow("No main function found");
  });

  it("emits nested blocks", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        {
          let x: f32 = 1.0
          return vec4(x, 0.0, 0.0, 1.0)
        }
      }
    `);
    expect(code).toContain("{");
    expect(code).toContain("float x = 1.0;");
    expect(code).toContain("fragColor = vec4(x, 0.0, 0.0, 1.0);");
  });

  it("emits vec2, vec3, vec4 types", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let v2: vec2 = vec2(1.0, 2.0)
        let v3: vec3 = vec3(1.0, 2.0, 3.0)
        return vec4(v2.x, v2.y, v3.x, 1.0)
      }
    `);
    expect(code).toContain("vec2 v2");
    expect(code).toContain("vec3 v3");
  });

  it("emits expression statements inside main", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let x: f32 = 1.0
        x
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("x;");
  });

  it("throws when main returns without value", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        return
      }
    `));
    expect(() => generateGLSL(program)).toThrow("main must return a value");
  });

  it("emits struct declaration inside main", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        struct Point { i32 x, i32 y }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("struct Point {");
    expect(code).toContain("int x;");
    expect(code).toContain("int y;");
  });

  it("emits helper function inside main", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        fn helper(): f32 { return 1.0 }
        return vec4(helper(), 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("float helper()");
  });

  it("emits binding uniforms", () => {
    const program = parse(tokenize(`
      @binding(0) uniform time: f32
      @binding(1) uniform color: vec4
      fn main(): vec4 {
        return color
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("uniform float time;");
    expect(code).toContain("uniform vec4 color;");
    expect(code).toContain("out vec4 fragColor;");
    expect(code).toContain("fragColor = color;");
  });

  it("emits binding uniforms before main", () => {
    const program = parse(tokenize(`
      @binding(0) uniform time: f32
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    const bindingIdx = code.indexOf("uniform float time");
    const mainIdx = code.indexOf("void main");
    expect(bindingIdx).toBeGreaterThan(-1);
    expect(mainIdx).toBeGreaterThan(bindingIdx);
  });

  it("emits struct literal in return expression", () => {
    const program = parse(tokenize(`
      struct Color { f32 r, f32 g, f32 b, f32 a }
      fn main(): vec4 {
        return { .r = 1.0, .g = 0.5, .b = 0.25, .a = 1.0 }
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("vec4(1.0, 0.5, 0.25, 1.0)");
  });

  it("emits sampler2D uniform declaration", () => {
    const program = parse(tokenize(`
      @binding(0) uniform tex: sampler2D
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("layout(binding = 0) uniform sampler2D tex;");
  });

  it("emits texture() call in GLSL", () => {
    const program = parse(tokenize(`
      @binding(0) uniform tex: sampler2D
      fn main(): vec4 {
        return texture(tex, vec2(0.5, 0.5))
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("texture(tex, vec2(0.5, 0.5))");
  });

  it("emits sampler3D uniform declaration", () => {
    const program = parse(tokenize(`
      @binding(0) uniform tex3d: sampler3D
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("layout(binding = 0) uniform sampler3D tex3d;");
  });

  it("emits samplerCube uniform declaration", () => {
    const program = parse(tokenize(`
      @binding(0) uniform env: samplerCube
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("layout(binding = 0) uniform samplerCube env;");
  });

  it("emits array variable declaration", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let arr: [f32; 4]
        return vec4(arr[0], 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("float arr[4];");
    expect(code).toContain("fragColor = vec4(arr[0], 0.0, 0.0, 1.0);");
  });

  it("emits array binding declaration", () => {
    const program = parse(tokenize(`
      @binding(0) uniform colors: [vec4; 4]
      fn main(): vec4 {
        return colors[0]
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("uniform vec4 colors[4];");
    expect(code).toContain("fragColor = colors[0];");
  });

  it("emits struct with array field", () => {
    const program = parse(tokenize(`
      struct Data { [f32; 4] values }
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("struct Data {");
    expect(code).toContain("float values[4];");
  });

  it("emits struct literal as function argument", () => {
    const program = parse(tokenize(`
      struct Color { f32 r, f32 g, f32 b, f32 a }
      fn takeColor(c: Color): vec4 { return c }
      fn main(): vec4 {
        return takeColor({ .r = 1.0, .g = 0.5, .b = 0.25, .a = 1.0 })
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("takeColor((1.0, 0.5, 0.25, 1.0))");
  });

  it("emits struct with array field inside main", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        struct Data { [f32; 4] values }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("struct Data {");
    expect(code).toContain("float values[4];");
  });

  it("emits helper function inside main", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        fn helper(x: f32): f32 { return x }
        return vec4(helper(1.0), 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("float helper(float x)");
    expect(code).toContain("helper(1.0)");
  });

  it("emits top-level variable declaration", () => {
    const program = parse(tokenize(`
      let x: f32 = 1.0
      fn main(): vec4 {
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("float x = 1.0;");
  });

  it("emits top-level bare return", () => {
    const program = parse(tokenize(`
      return
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("return;");
  });

  it("emits top-level block", () => {
    const program = parse(tokenize(`
      {
        let x: f32 = 1.0
      }
      fn main(): vec4 {
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("{");
    expect(code).toContain("float x = 1.0;");
    expect(code).toContain("}");
  });

  it("emits top-level if statement", () => {
    const program = parse(tokenize(`
      if (true) {
        let x: f32 = 1.0
      } else {
        let y: f32 = 2.0
      }
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("if (true)");
    expect(code).toContain("float x = 1.0;");
    expect(code).toContain("else");
    expect(code).toContain("float y = 2.0;");
  });

  it("emits top-level expression statement", () => {
    const program = parse(tokenize(`
      let x: f32 = 1.0
      x
      fn main(): vec4 {
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("float x = 1.0;");
    expect(code).toContain("x;");
  });

  it("emits top-level array variable", () => {
    const program = parse(tokenize(`
      let arr: [f32; 4]
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("float arr[4];");
  });

  it("emits top-level struct literal initializer", () => {
    const program = parse(tokenize(`
      struct Color { f32 r, f32 g, f32 b, f32 a }
      let c: Color = { .r = 1.0, .g = 0.5, .b = 0.25, .a = 1.0 }
      fn main(): vec4 {
        return vec4(c.r, c.g, c.b, c.a)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("Color(1.0, 0.5, 0.25, 1.0)");
  });

  it("emits i64 scalar type", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: i64 = 42
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("int64_t x = 42;");
  });

  it("emits f64 scalar type", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: f64 = 1.0
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("double x = 1.0;");
  });

  it("emits ivec4 type", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: ivec4 = ivec4(1, 2, 3, 4)
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("ivec4 x = ivec4(1, 2, 3, 4);");
  });

  it("emits uvec4 type", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: uvec4 = uvec4(1, 2, 3, 4)
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("uvec4 x = uvec4(1, 2, 3, 4);");
  });

  it("emits dvec4 type", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: dvec4 = dvec4(1.0, 2.0, 3.0, 4.0)
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("dvec4 x = dvec4(1.0, 2.0, 3.0, 4.0);");
  });

  it("emits hex integer literal", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: i32 = 0xFF
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("int x = 255;");
  });

  it("emits char literal as character code", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: i32 = 'A'
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("int x = 65;");
  });

  it("emits color literal as hex", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: u32 = #FF0000
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("uint x = 0xFF0000;");
  });

  it("throws when main returns unknown struct type", () => {
    expect(() => compileToGLSL(`
      fn main(): Nonexistent {
        return 42
      }
    `)).toThrow("Unknown struct 'Nonexistent'");
  });

  it("emits scientific float literal", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: f32 = 1.5e-3
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("float x = 0.0015;");
  });

  it("emits mat2 type", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: mat2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("mat2 x;");
  });

  it("emits mat4 type", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: mat4
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("mat4 x;");
  });

  it("emits dmat3 type", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: dmat3
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("dmat3 x;");
  });

  it("emits imat2 type", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: imat2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("imat2 x;");
  });

  it("emits umat4 type", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: umat4
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("umat4 x;");
  });

  it("emits non-square mat2x3 type", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: mat2x3
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("mat2x3 x;");
  });

  it("emits non-square mat4x2 type", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: mat4x2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("mat4x2 x;");
  });

  it("emits mat4 constructor from scalars", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: mat4 = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0)
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("mat4(");
  });

  it("emits mat2 constructor from vec2 columns", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let c1: vec2 = vec2(1.0, 0.0)
        let c2: vec2 = vec2(0.0, 1.0)
        let x: mat2 = mat2(c1, c2)
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("mat2(");
  });

  it("emits quat constructor", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: quat = quat(1.0, 0.0, 0.0, 0.0)
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("quat(");
  });

  it("emits deg built-in", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: f32 = deg(1.0)
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("deg(1.0)");
  });

  it("emits rad built-in", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let x: f32 = rad(1.0)
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("rad(1.0)");
  });

  it("emits array literal", () => {
    const program = parse(tokenize(`
      fn main(): vec4 {
        let arr: [f32; 3] = [1.0, 2.0, 3.0]
        return vec4(arr[0], arr[1], arr[2], 1.0)
      }
    `));
    const code = generateGLSL(program);
    expect(code).toContain("float[3](1.0, 2.0, 3.0)");
  });

  // Phase 5: Mutable variable
  it("emits mutable variable declaration", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let mut x: f32 = 1.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("float x = 1.0;");
  });

  // Phase 5: Compound assignment
  it("emits compound assignment", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let mut x: f32 = 1.0
        x += 2.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("(x = x + 2.0)");
  });

  // Phase 5: Increment/decrement
  it("emits increment", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let mut x: i32 = 1
        ++x
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("(x = x + 1, x)");
  });

  it("emits decrement", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let mut x: i32 = 1
        x--
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("(x = x - 1)");
  });

  // Phase 5: Bitwise operators
  it("emits bitwise and", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let a: i32 = 1 & 2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("(1 & 2)");
  });

  it("emits bitwise or", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let a: i32 = 1 | 2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("(1 | 2)");
  });

  it("emits bitwise xor", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let a: i32 = 1 ^ 2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("(1 ^ 2)");
  });

  it("emits bitwise not", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let a: i32 = ~1
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("(~1)");
  });

  it("emits left shift", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let a: i32 = 1 << 2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("(1 << 2)");
  });

  it("emits right shift", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let a: i32 = 4 >> 1
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("(4 >> 1)");
  });

  // Phase 5: Spaceship operator
  it("emits spaceship operator", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let a: i32 = 1 <=> 2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("(1 <=> 2)");
  });

  // Phase 5: Ternary conditional
  it("emits ternary conditional", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let b: bool = true
        let x: f32 = b ? 1.0 : 2.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("(b ? 1.0 : 2.0)");
  });

  // Phase 5: Null coalescing
  it("emits null coalescing", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let x: i32 = 1 ?? 2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("(1 != 0 ? 1 : 2)");
  });

  // Phase 5: While loop
  it("emits while loop", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let mut i: i32 = 0
        while (i < 5) {
          i += 1
        }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("while ((i < 5)) {");
    expect(code).toContain("(i = i + 1)");
  });

  // Phase 5: For loop
  it("emits for loop", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        for (let mut i: i32 = 0; i < 5; i += 1) {
          i
        }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("for (int i = 0; (i < 5); (i = i + 1)) {");
  });

  // Phase 5: Do-while loop
  it("emits do-while loop", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        let mut i: i32 = 0
        do {
          i += 1
        } while (i < 5)
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("do {");
    expect(code).toContain("} while ((i < 5));");
  });

  // Phase 5: Loop
  it("emits loop", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        loop {
          break
        }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("for (;;) {");
    expect(code).toContain("break;");
  });

  // Phase 5: Break and continue
  it("emits break and continue", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        loop {
          break
          continue
        }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("break;");
    expect(code).toContain("continue;");
  });

  // Phase 5: Discard
  it("emits discard", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        discard
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("discard;");
  });

  // Phase 5: Panic
  it("emits panic", () => {
    const code = compileToGLSL(`
      fn main(): vec4 {
        panic
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("// panic");
  });
});

describe("codegen/wgsl", () => {
  function compileToWGSL(source: string) {
    const result = compile({ source, target: "wgsl", file: "test.wgsl" });
    if (result.diagnostics.length > 0) {
      throw new Error(
        `WGSL compile errors: ${result.diagnostics.map((d) => d.message).join(", ")}`
      );
    }
    if (!result.code) {
      throw new Error("No WGSL code generated");
    }
    return result.code;
  }

  it("emits main as @fragment returning @location(0) vec4<f32>", () => {
    const code = compileToWGSL(`
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("@fragment");
    expect(code).toContain("fn main() -> @location(0) vec4<f32> {");
    expect(code).toContain("return vec4<f32>(1.0, 0.0, 0.0, 1.0);");
    expect(code).toContain("}");
  });

  it("emits struct declarations", () => {
    const code = compileToWGSL(`
      struct Point { i32 x, i32 y }
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("struct Point {");
    expect(code).toContain("x: i32,");
    expect(code).toContain("y: i32,");
    expect(code).toContain("};");
  });

  it("emits variable declarations", () => {
    const code = compileToWGSL(`
      fn main(): vec4 {
        let x: f32 = 1.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("let x: f32 = 1.0;");
    expect(code).toContain("return vec4<f32>(x, 0.0, 0.0, 1.0);");
  });

  it("emits mutable variable declarations", () => {
    const code = compileToWGSL(`
      fn main(): vec4 {
        let mut x: f32 = 1.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("var x: f32 = 1.0;");
  });

  it("emits struct literal as constructor call", () => {
    const code = compileToWGSL(`
      struct Color { f32 r, f32 g, f32 b, f32 a }
      fn main(): vec4 {
        let c: Color = { .r = 1.0, .g = 0.5, .b = 0.25, .a = 1.0 }
        return vec4(c.r, c.g, c.b, c.a)
      }
    `);
    expect(code).toContain("Color(1.0, 0.5, 0.25, 1.0)");
  });

  it("emits member access and swizzle", () => {
    const code = compileToWGSL(`
      fn main(): vec4 {
        let v: vec4 = vec4(1.0, 0.0, 0.0, 1.0)
        return vec4(v.x, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("v.x");
  });

  it("emits swizzle expressions", () => {
    const code = compileToWGSL(`
      fn main(): vec4 {
        let v: vec4 = vec4(1.0, 0.0, 0.0, 1.0)
        return vec4(v.rgb, 1.0)
      }
    `);
    expect(code).toContain("v.rgb");
  });

  it("emits binary expressions with parentheses", () => {
    const code = compileToWGSL(`
      fn main(): vec4 {
        let x: f32 = 1.0 + 2.0 * 3.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("(1.0 + (2.0 * 3.0))");
  });

  it("emits unary expressions", () => {
    const code = compileToWGSL(`
      fn main(): vec4 {
        let x: f32 = -1.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("(-1.0)");
  });

  it("emits function calls", () => {
    const code = compileToWGSL(`
      fn main(): vec4 {
        return vec4(dot(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0)), 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("dot(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0))");
  });

  it("emits if-else statements", () => {
    const code = compileToWGSL(`
      fn main(): vec4 {
        let x: f32 = 1.0
        if (x > 0.5) {
          return vec4(1.0, 0.0, 0.0, 1.0)
        } else {
          return vec4(0.0, 0.0, 0.0, 1.0)
        }
      }
    `);
    expect(code).toContain("if (x > 0.5) {");
    expect(code).toContain("else {");
  });

  it("emits while loops", () => {
    const code = compileToWGSL(`
      fn main(): vec4 {
        let mut i: i32 = 0
        while (i < 5) {
          i += 1
        }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("while (i < 5) {");
    expect(code).toContain("(i = i + 1)");
  });

  it("emits loop, break and continue", () => {
    const code = compileToWGSL(`
      fn main(): vec4 {
        loop {
          break
          continue
        }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("loop {");
    expect(code).toContain("break;");
    expect(code).toContain("continue;");
  });

  it("emits discard", () => {
    const code = compileToWGSL(`
      fn main(): vec4 {
        discard
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("discard;");
  });

  it("emits binding uniforms", () => {
    const code = compileToWGSL(`
      @binding(0) uniform time: f32
      @binding(1) uniform color: vec4
      fn main(): vec4 {
        return color
      }
    `);
    expect(code).toContain("@group(0) @binding(0) var<uniform> time: f32;");
    expect(code).toContain("@group(0) @binding(1) var<uniform> color: vec<f32>;");
    expect(code).toContain("@fragment");
  });

  it("emits sampler2D binding as texture", () => {
    const code = compileToWGSL(`
      @binding(0) uniform tex: sampler2D
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(code).toContain("@group(0) @binding(0) var tex: texture_2d<f32>;");
  });

  it("emits texture() as textureSample", () => {
    const code = compileToWGSL(`
      @binding(0) uniform tex: sampler2D
      fn main(): vec4 {
        return texture(tex, vec2(0.5, 0.5))
      }
    `);
    expect(code).toContain("textureSample(tex, sampler, vec2<f32>(0.5, 0.5))");
  });

  it("emits built-in math functions", () => {
    const code = compileToWGSL(`
      fn main(): vec4 {
        let x: f32 = abs(-1.0)
        let y: f32 = sin(1.0)
        let z: f32 = cos(1.0)
        let p: f32 = pow(2.0, 3.0)
        let r: f32 = sqrt(4.0)
        let fl: f32 = floor(1.5)
        let fr: f32 = fract(1.5)
        let mn: f32 = min(1.0, 2.0)
        let mx: f32 = max(1.0, 2.0)
        let cl: f32 = clamp(0.5, 0.0, 1.0)
        return vec4(x, y, z, 1.0)
      }
    `);
    expect(code).toContain("abs((-1.0))");
    expect(code).toContain("sin(1.0)");
    expect(code).toContain("cos(1.0)");
    expect(code).toContain("pow(2.0, 3.0)");
    expect(code).toContain("sqrt(4.0)");
    expect(code).toContain("floor(1.5)");
    expect(code).toContain("fract(1.5)");
    expect(code).toContain("min(1.0, 2.0)");
    expect(code).toContain("max(1.0, 2.0)");
    expect(code).toContain("clamp(0.5, 0.0, 1.0)");
  });

  it("emits deg and rad as degrees and radians", () => {
    const code = compileToWGSL(`
      fn main(): vec4 {
        let x: f32 = deg(1.0)
        let y: f32 = rad(1.0)
        return vec4(x, y, 0.0, 1.0)
      }
    `);
    expect(code).toContain("degrees(1.0)");
    expect(code).toContain("radians(1.0)");
  });

  it("throws when main returns non-vec4", () => {
    expect(() =>
      compileToWGSL(`
        fn main(): i32 {
          return 42
        }
      `)
    ).toThrow("main must return vec4");
  });

  it("throws when no main function", () => {
    expect(() =>
      compileToWGSL(`
        fn helper(): vec4 {
          return vec4(1.0, 0.0, 0.0, 1.0)
        }
      `)
    ).toThrow("No main function found");
  });
});
