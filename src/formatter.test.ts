import { describe, it, expect } from "vitest";
import { format } from "../src/formatter";

describe("formatter", () => {
  it("formats simple main function", () => {
    const source = "fn main():vec4{return vec4(1.0,0.0,0.0,1.0)}";
    const result = format(source);
    expect(result).toBe("fn main(): vec4 {\n  return vec4(1.0, 0.0, 0.0, 1.0);\n}\n");
  });

  it("formats struct declaration", () => {
    const source = "struct Point { i32 x, i32 y }";
    const result = format(source);
    expect(result).toBe("struct Point {\n  i32 x,\n  i32 y\n}\n");
  });

  it("formats binding declaration", () => {
    const source = "@binding(0)uniform time:f32";
    const result = format(source);
    expect(result).toBe("@binding(0) uniform time: f32;\n");
  });

  it("formats import declaration", () => {
    const source = 'import "./utils.gl"';
    const result = format(source);
    expect(result).toBe('import "./utils.gl";\n');
  });

  it("formats variable declaration", () => {
    const source = "fn main(): vec4 { let x: f32 = 1.0 }";
    const result = format(source);
    expect(result).toContain("let x: f32 = 1.0;");
  });

  it("formats return statement", () => {
    const source = "fn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("return vec4(1.0, 0.0, 0.0, 1.0);");
  });

  it("formats if-else statement", () => {
    const source = "fn main(): vec4 { if (true) { return vec4(1.0, 0.0, 0.0, 1.0) } else { return vec4(0.0, 0.0, 0.0, 1.0) } }";
    const result = format(source);
    expect(result).toContain("if (true) {");
    expect(result).toContain("else {");
  });

  it("formats swizzle expression", () => {
    const source = "fn main(): vec4 { let v: vec4 = vec4(1.0, 0.0, 0.0, 1.0) return v.rgb }";
    const result = format(source);
    expect(result).toContain("v.rgb");
  });

  it("formats array type", () => {
    const source = "fn main(): vec4 { let arr: [f32; 4] return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("[f32; 4]");
  });

  it("formats sampler type", () => {
    const source = "@binding(0) uniform tex: sampler2D fn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("uniform tex: sampler2D;");
  });

  it("is idempotent", () => {
    const source = "fn main():vec4{return vec4(1.0,0.0,0.0,1.0)}";
    const once = format(source);
    const twice = format(once);
    expect(twice).toBe(once);
  });

  it("formats struct literal in return", () => {
    const source = "struct Color { f32 r, f32 g, f32 b, f32 a } fn main(): vec4 { return { .r = 1.0, .g = 0.5, .b = 0.25, .a = 1.0 } }";
    const result = format(source);
    expect(result).toContain("{ r = 1.0, g = 0.5, b = 0.25, a = 1.0 }");
  });

  it("formats unary expression", () => {
    const source = "fn main(): vec4 { let x: f32 = -1.0 return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("(-1.0)");
  });

  it("formats member expression", () => {
    const source = "fn main(): vec4 { let v: vec4 = vec4(1.0, 0.0, 0.0, 1.0) return vec4(v.r, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("v.r");
  });

  it("formats call expression", () => {
    const source = "fn main(): vec4 { return dot(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0)) }";
    const result = format(source);
    expect(result).toContain("dot(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0))");
  });

  it("formats char literal", () => {
    const source = "fn main(): vec4 { let x: i32 = 'A' return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("'A'");
  });

  it("formats color literal", () => {
    const source = "fn main(): vec4 { let x: u32 = #FF0000 return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("#FF0000");
  });

  it("formats index expression", () => {
    const source = "fn main(): vec4 { let arr: [f32; 4] return vec4(arr[0], 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("arr[0]");
  });

  it("formats bare return", () => {
    const source = "fn main(): vec4 { return }";
    const result = format(source);
    expect(result).toContain("return;");
  });

  it("formats parenthesized expression", () => {
    const source = "fn main(): vec4 { let x: f32 = (1.0 + 2.0) return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("(1.0 + 2.0)");
  });

  it("formats bare expression statement", () => {
    const source = "fn main(): vec4 { let x: f32 = 1.0 x return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("x;");
  });

  it("formats binary expression with parentheses", () => {
    const source = "fn main(): vec4 { let x: f32 = 1.0 + 2.0 * 3.0 return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("(1.0 + (2.0 * 3.0))");
  });

  it("formats multiple statements", () => {
    const source = "struct Point { i32 x, i32 y } @binding(0) uniform p: Point fn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("struct Point {");
    expect(result).toContain("@binding(0) uniform p: Point;");
    expect(result).toContain("fn main(): vec4 {");
  });

  it("formats mat2 type", () => {
    const source = "fn main(): vec4 { let x: mat2 return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("x: mat2;");
  });

  it("formats mat4 type", () => {
    const source = "fn main(): vec4 { let x: mat4 return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("x: mat4;");
  });

  it("formats dmat3 type", () => {
    const source = "fn main(): vec4 { let x: dmat3 return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("x: dmat3;");
  });

  it("formats non-square mat2x3 type", () => {
    const source = "fn main(): vec4 { let x: mat2x3 return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("x: mat2x3;");
  });

  it("formats non-square mat4x2 type", () => {
    const source = "fn main(): vec4 { let x: mat4x2 return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("x: mat4x2;");
  });

  it("formats array literal", () => {
    const source = "fn main(): vec4 { let arr: [f32; 3] = [1.0, 2.0, 3.0] return vec4(arr[0], arr[1], arr[2], 1.0) }";
    const result = format(source);
    expect(result).toContain("[1.0, 2.0, 3.0]");
  });

  it("formats quat constructor call", () => {
    const source = "fn main(): vec4 { let x: quat = quat(1.0, 0.0, 0.0, 0.0) return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("quat(1.0, 0.0, 0.0, 0.0)");
  });

  it("formats deg built-in call", () => {
    const source = "fn main(): vec4 { let x: f32 = deg(1.0) return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("deg(1.0)");
  });

  it("preserves range-for variable names", () => {
    const result = format("fn main(): vec4 { for index in 0..3 { let value: i32 = index } return vec4(1.0, 0.0, 0.0, 1.0) }");
    expect(result).toContain("for index in 0..3 {");
    expect(result).not.toContain("__loop_var");
  });

  it("formats mutable variable", () => {
    const source = "fn main(): vec4 { let mut x: f32 = 1.0 return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("let mut x: f32 = 1.0;");
  });

  it("formats compound assignment", () => {
    const source = "fn main(): vec4 { let mut x: f32 = 1.0 x += 2.0 return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("x += 2.0;");
  });

  it("formats increment", () => {
    const source = "fn main(): vec4 { let mut x: i32 = 1 ++x return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("++x;");
  });

  it("formats decrement", () => {
    const source = "fn main(): vec4 { let mut x: i32 = 1 x-- return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("x--;");
  });

  it("formats ternary conditional", () => {
    const source = "fn main(): vec4 { let b: bool = true let x: f32 = b ? 1.0 : 2.0 return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("b ? 1.0 : 2.0");
  });

  it("formats null coalescing", () => {
    const source = "fn main(): vec4 { let x: i32 = 1 ?? 2 return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("1 ?? 2");
  });

  it("formats spaceship operator", () => {
    const source = "fn main(): vec4 { let x: i32 = 1 <=> 2 return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("1 <=> 2");
  });

  it("formats bitwise and", () => {
    const source = "fn main(): vec4 { let a: i32 = 1 & 2 return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("1 & 2");
  });

  it("formats bitwise or", () => {
    const source = "fn main(): vec4 { let a: i32 = 1 | 2 return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("1 | 2");
  });

  it("formats bitwise xor", () => {
    const source = "fn main(): vec4 { let a: i32 = 1 ^ 2 return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("1 ^ 2");
  });

  it("formats bitwise not", () => {
    const source = "fn main(): vec4 { let a: i32 = ~1 return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("~1");
  });

  it("formats left shift", () => {
    const source = "fn main(): vec4 { let a: i32 = 1 << 2 return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("1 << 2");
  });

  it("formats right shift", () => {
    const source = "fn main(): vec4 { let a: i32 = 4 >> 1 return vec4(x, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("4 >> 1");
  });

  it("formats while loop", () => {
    const source = "fn main(): vec4 { let mut i: i32 = 0 while ((i < 5)) { i += 1; } return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("while ((i < 5)) {");
    expect(result).toContain("i += 1;");
  });

  it("formats for loop", () => {
    const source = "fn main(): vec4 { for (let mut i: i32 = 0; (i < 5); (i = i + 1)) { i; } return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("for (let mut i: i32 = 0;");
  });

  it("formats do-while loop", () => {
    const source = "fn main(): vec4 { let mut i: i32 = 0 do { i += 1; } while ((i < 5)) return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("do {");
    expect(result).toContain("} while ((i < 5));");
  });

  it("formats loop", () => {
    const source = "fn main(): vec4 { loop { break } return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("loop {");
    expect(result).toContain("break;");
  });

  it("formats break and continue", () => {
    const source = "fn main(): vec4 { loop { break continue } return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("break;");
    expect(result).toContain("continue;");
  });

  it("formats discard", () => {
    const source = "fn main(): vec4 { discard return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("discard;");
  });

  it("formats panic", () => {
    const source = "fn main(): vec4 { panic return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("panic;");
  });

  it("formats unreachable", () => {
    const source = "fn main(): vec4 { unreachable return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("unreachable;");
  });

  it("formats match expression", () => {
    const source = "fn main(): vec4 { let x: i32 = 1 match x { 1 => { return vec4(1.0, 0.0, 0.0, 1.0) } _ => { return vec4(0.0, 0.0, 0.0, 1.0) } } return vec4(1.0, 0.0, 0.0, 1.0) }";
    const result = format(source);
    expect(result).toContain("match");
  });

  it("is idempotent with new constructs", () => {
    const source = "fn main(): vec4 { let mut x: f32 = 1.0 x += 2.0 ++x x-- let b: bool = true let y: f32 = b ? 1.0 : 2.0 let z: i32 = 1 ?? 2 let w: i32 = 1 <=> 2 let a: i32 = 1 & 2 let c: i32 = 1 | 2 let d: i32 = 1 ^ 2 let e: i32 = ~1 let f: i32 = 1 << 2 let g: i32 = 4 >> 1 return vec4(x, y, z, w) }";
    const once = format(source);
    const twice = format(once);
    expect(twice).toBe(once);
  });
});
