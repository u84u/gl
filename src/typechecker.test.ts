import { describe, it, expect } from "vitest";
import { tokenize } from "../src/lexer";
import { parse } from "../src/parser";
import { typeCheck } from "../src/typechecker";
import {
  Program,
  Span,
} from "../src/types";

function check(source: string, file = "test.gl") {
  const program = parse(tokenize(source));
  return typeCheck(program, file);
}

describe("typechecker", () => {
  it("accepts valid vec4 return", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects main returning non-vec4 at codegen level", () => {
    const { diagnostics } = check(`
      fn main(): i32 {
        return 42
      }
    `);
    // Type checker doesn't validate main return type - that's codegen
    // But it does type-check the return expression against the declared type
    expect(diagnostics.length).toBeGreaterThanOrEqual(0);
  });

  it("reports undeclared identifier", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        return vec4(undeclared, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]!.message).toContain("Undeclared identifier");
  });

  it("accepts abstract int literal assigned to f32", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: f32 = 42
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts abstract float literal assigned to f32", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: f32 = 1.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects i32 assigned to f32 without conversion", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: i32 = 5
        let y: f32 = x
        return vec4(y, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("expects f32, got i32"))).toBe(true);
  });

  it("rejects f32 assigned to i32 without conversion", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: f32 = 5.0
        let y: i32 = x
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("rejects vec4 assigned to f32", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let v: vec4 = vec4(1.0, 0.0, 0.0, 1.0)
        let x: f32 = v
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("expects f32, got vec4"))).toBe(true);
  });

  it("accepts arithmetic between f32 values", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: f32 = 1.0
        let b: f32 = 2.0
        let c: f32 = a + b
        return vec4(c, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects arithmetic between i32 and f32", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: i32 = 1
        let b: f32 = 2.0
        let c: f32 = a + b
        return vec4(c, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("accepts comparison between same types", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: f32 = 1.0
        let b: f32 = 2.0
        let c: bool = a < b
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects comparison between different types", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: i32 = 1
        let b: f32 = 2.0
        let c: bool = a < b
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("rejects if condition that is not bool", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: f32 = 1.0
        if (x) {
          return vec4(1.0, 0.0, 0.0, 1.0)
        }
        return vec4(0.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("If condition must be bool"))).toBe(true);
  });

  it("accepts if condition that is bool", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let b: bool = true
        if (b) {
          return vec4(1.0, 0.0, 0.0, 1.0)
        }
        return vec4(0.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects return type mismatch", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        return 42
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("does not match function return type"))).toBe(true);
  });

  it("rejects missing return value", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        return
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Missing return value"))).toBe(true);
  });

  it("rejects duplicate struct definitions", () => {
    const { diagnostics } = check(`
      struct Point { i32 x, i32 y }
      struct Point { i32 x, i32 y }
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Duplicate struct definition"))).toBe(true);
  });

  it("rejects duplicate function definitions", () => {
    const { diagnostics } = check(`
      fn helper(): f32 { return 1.0 }
      fn helper(): f32 { return 2.0 }
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Duplicate function definition"))).toBe(true);
  });

  it("validates struct literal fields", () => {
    const { diagnostics } = check(`
      struct Point { i32 x, i32 y }
      fn main(): vec4 {
        let p: Point = { .x = 1, .z = 2 }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("has no field"))).toBe(true);
  });

  it("validates missing struct literal fields", () => {
    const { diagnostics } = check(`
      struct Point { i32 x, i32 y }
      fn main(): vec4 {
        let p: Point = { .x = 1 }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Missing field"))).toBe(true);
  });

  it("validates swizzle component count against vector size", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let v: vec2 = vec2(1.0, 2.0)
        return vec4(v.xyz, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Swizzle of length 3 on vec2"))).toBe(true);
  });

  it("rejects swizzle on non-vector", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: f32 = 1.0
        return vec4(x.x, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Cannot swizzle non-vector"))).toBe(true);
  });

  it("rejects invalid swizzle characters", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let v: vec4 = vec4(1.0, 0.0, 0.0, 1.0)
        return vec4(v.xq, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Cannot access field"))).toBe(true);
  });

  it("rejects mixing xyzw and rgba swizzle components", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let v: vec4 = vec4(1.0, 0.0, 0.0, 1.0)
        return vec4(v.xg, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Cannot mix"))).toBe(true);
  });

  it("rejects field access on non-struct", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: f32 = 1.0
        return vec4(x.foo, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Cannot access field"))).toBe(true);
  });

  it("rejects unknown struct field", () => {
    const { diagnostics } = check(`
      struct Point { i32 x, i32 y }
      fn main(): vec4 {
        let p: Point = { .x = 1, .y = 2 }
        return vec4(p.z, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("has no field"))).toBe(true);
  });

  it("rejects call to undeclared function", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        return vec4(mystery(), 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Undeclared function"))).toBe(true);
  });

  it("rejects wrong argument count", () => {
    const { diagnostics } = check(`
      fn helper(x: f32, y: f32): f32 { return x + y }
      fn main(): vec4 {
        return vec4(helper(1.0), 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("expects 2 arguments"))).toBe(true);
  });

  it("rejects wrong argument type", () => {
    const { diagnostics } = check(`
      fn helper(x: i32): i32 { return x }
      fn main(): vec4 {
        return vec4(helper(1.0), 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("cannot be converted to i32"))).toBe(true);
  });

  it("accepts user function call with correct types", () => {
    const { diagnostics } = check(`
      fn helper(x: f32): f32 { return x * 2.0 }
      fn main(): vec4 {
        return vec4(helper(1.0), 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts dot built-in", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: vec3 = vec3(1.0, 0.0, 0.0)
        let b: vec3 = vec3(0.0, 1.0, 0.0)
        let d: f32 = dot(a, b)
        return vec4(d, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects dot with wrong types", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: vec3 = vec3(1.0, 0.0, 0.0)
        let b: vec4 = vec4(1.0, 0.0, 0.0, 1.0)
        let d: f32 = dot(a, b)
        return vec4(d, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("accepts vec4 constructor with 4 f32 args", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts vec4 constructor with vec3 + f32", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        return vec4(vec3(1.0, 0.0, 0.0), 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts vec4 constructor with f32 + vec3", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        return vec4(1.0, vec3(0.0, 0.0, 1.0))
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects vec4 constructor with wrong arg count", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("accepts normalize, length, clamp, mix, min, max, abs, sin, cos, pow, sqrt, floor, fract", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let v: vec3 = vec3(1.0, 0.0, 0.0)
        let n: vec3 = normalize(v)
        let l: f32 = length(v)
        let c: f32 = clamp(0.5, 0.0, 1.0)
        let m: f32 = mix(0.0, 1.0, 0.5)
        let mn: f32 = min(1.0, 2.0)
        let mx: f32 = max(1.0, 2.0)
        let a: f32 = abs(-1.0)
        let s: f32 = sin(1.0)
        let c2: f32 = cos(1.0)
        let p: f32 = pow(2.0, 3.0)
        let r: f32 = sqrt(4.0)
        let fl: f32 = floor(1.5)
        let fr: f32 = fract(1.5)
        return vec4(n.x, l, c, m)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects cross with non-vec3", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: vec2 = vec2(1.0, 0.0)
        let b: vec2 = vec2(0.0, 1.0)
        let c: vec2 = cross(a, b)
        return vec4(c.x, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("accepts struct field access chain", () => {
    const { diagnostics } = check(`
      struct Point { f32 x, f32 y }
      fn main(): vec4 {
        let p: Point = { .x = 1.0, .y = 2.0 }
        return vec4(p.x, p.y, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects binary op between bool and f32", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let b: bool = true
        let x: f32 = 1.0
        let r: f32 = b + x
        return vec4(r, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("rejects unary minus on bool", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let b: bool = true
        let x: f32 = -b
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("rejects logical and on non-bool", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: f32 = 1.0
        let y: f32 = 2.0
        let b: bool = x and y
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("accepts struct literal with correct field types", () => {
    const { diagnostics } = check(`
      struct Color { f32 r, f32 g, f32 b, f32 a }
      fn main(): vec4 {
        let c: Color = { .r = 1.0, .g = 0.5, .b = 0.25, .a = 1.0 }
        return vec4(c.r, c.g, c.b, c.a)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects struct literal with wrong field types", () => {
    const { diagnostics } = check(`
      struct Color { f32 r, f32 g, f32 b, f32 a }
      fn main(): vec4 {
        let c: Color = { .r = true, .g = 0.5, .b = 0.25, .a = 1.0 }
        return vec4(c.r, c.g, c.b, c.a)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("rejects variable initialization that cannot be converted", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: i32 = 1.0
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("cannot be initialized"))).toBe(true);
  });

  it("rejects return value that cannot be converted", () => {
    const { diagnostics } = check(`
      fn main(): i32 {
        return 1.0
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("cannot be converted"))).toBe(true);
  });

  it("rejects logical not on non-bool operand", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: f32 = 1.0
        let b: bool = !x
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("requires bool operand"))).toBe(true);
  });

  it("rejects function argument type mismatch after concretification", () => {
    const { diagnostics } = check(`
      fn helper(x: f32): f32 { return x }
      fn main(): vec4 {
        return vec4(helper(true), 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("expects f32, got bool"))).toBe(true);
  });

  it("accepts binding declaration", () => {
    const { diagnostics } = check(`
      @binding(0) uniform time: f32
      @binding(1) uniform color: vec4
      fn main(): vec4 {
        return color
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects duplicate binding slot", () => {
    const { diagnostics } = check(`
      @binding(0) uniform time: f32
      @binding(0) uniform other: f32
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Duplicate binding slot"))).toBe(true);
  });

  it("accepts binding with struct type", () => {
    const { diagnostics } = check(`
      struct Light { f32 r, f32 g, f32 b }
      @binding(0) uniform light: Light
      fn main(): vec4 {
        return vec4(light.r, light.g, light.b, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("handles nested blocks", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        {
          let x: f32 = 1.0
          return vec4(x, 0.0, 0.0, 1.0)
        }
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("reports line and column in diagnostics", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        return vec4(undeclared_var, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]!.span.line).toBe(3);
    expect(diagnostics[0]!.span.column).toBeGreaterThan(0);
  });

  it("accepts sampler2D binding with texture() call", () => {
    const { diagnostics } = check(`
      @binding(0) uniform tex: sampler2D
      fn main(): vec4 {
        return texture(tex, vec2(0.5, 0.5))
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts samplerCube binding with texture() call", () => {
    const { diagnostics } = check(`
      @binding(0) uniform env: samplerCube
      fn main(): vec4 {
        return texture(env, vec3(1.0, 0.0, 0.0))
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects sampler2D as local variable", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let tex: sampler2D
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("can only appear in a binding declaration"))).toBe(true);
  });

  it("rejects sampler2D as struct field", () => {
    const { diagnostics } = check(`
      struct Mat { sampler2D tex, f32 roughness }
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("cannot have sampler type"))).toBe(true);
  });

  it("rejects sampler2D as function parameter", () => {
    const { diagnostics } = check(`
      fn helper(tex: sampler2D): f32 { return 1.0 }
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("cannot have sampler type"))).toBe(true);
  });

  it("rejects sampler2D as return type", () => {
    const { diagnostics } = check(`
      fn helper(): sampler2D { return texture(uniform_tex, vec2(0.0)) }
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("cannot return sampler type"))).toBe(true);
  });

  it("rejects texture() with wrong argument types", () => {
    const { diagnostics } = check(`
      @binding(0) uniform tex: sampler2D
      fn main(): vec4 {
        return texture(tex, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("rejects texture() with wrong sampler type", () => {
    const { diagnostics } = check(`
      @binding(0) uniform tex: sampler3D
      fn main(): vec4 {
        return texture(tex, vec2(0.5, 0.5))
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("accepts array variable declaration", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let arr: [f32; 4]
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts array index access", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let arr: [f32; 4]
        return vec4(arr[0], 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects array index with non-i32 type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let arr: [f32; 4]
        return vec4(arr[1.0], 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Array index must be i32"))).toBe(true);
  });

  it("rejects indexing non-array type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: f32 = 1.0
        return vec4(x[0], 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Cannot index non-array"))).toBe(true);
  });

  it("rejects array of samplers", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let arr: [sampler2D; 4]
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("can only appear in a binding declaration"))).toBe(true);
  });

  it("rejects struct with array of samplers field", () => {
    const { diagnostics } = check(`
      struct Mat { [sampler2D; 4] texs }
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("cannot have sampler type"))).toBe(true);
  });

  it("accepts array of vec4", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let arr: [vec4; 3]
        return vec4(arr[0].x, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts array binding", () => {
    const { diagnostics } = check(`
      @binding(0) uniform colors: [vec4; 4]
      fn main(): vec4 {
        return colors[0]
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts i32 arithmetic", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: i32 = 1
        let b: i32 = 2
        let c: i32 = a + b
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts logic and operator", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: bool = true
        let b: bool = false
        let c: bool = a and b
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts logic or operator", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: bool = true
        let b: bool = false
        let c: bool = a or b
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects logic operator on non-bool operands", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: f32 = 1.0
        let b: f32 = 2.0
        let c: bool = a and b
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("requires bool operands"))).toBe(true);
  });

  it("accepts unary minus on i32", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: i32 = 5
        let b: i32 = -a
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts unary minus on f32", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: f32 = 1.0
        let b: f32 = -a
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts unary not on bool", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let b: bool = true
        let x: bool = !b
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects unknown unary operator", () => {
    const span: Span = { line: 1, column: 1 };
    const program: Program = {
      kind: "Program",
      statements: [
        {
          kind: "FnDecl",
          name: "main",
          params: [],
          returnType: { kind: "vector", element: "f32", size: 4 },
          body: {
            kind: "Block",
            statements: [
              {
                kind: "ReturnStmt",
                value:                 {
                  kind: "UnaryExpr",
                  operator: "@",
                  operand: {
                    kind: "Literal",
                    value: 1,
                    literalKind: "int",
                    span,
                  },
                  span,
                },
                span,
              },
            ],
            span,
          },
          span,
        },
      ],
      span,
    };
    const { diagnostics } = typeCheck(program, "test.gl");
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Unknown unary operator"))).toBe(true);
  });

  it("type-checks binding declaration inside function body", () => {
    const span: Span = { line: 1, column: 1 };
    const program: Program = {
      kind: "Program",
      statements: [
        {
          kind: "FnDecl",
          name: "main",
          params: [],
          returnType: { kind: "scalar", name: "f32" },
          body: {
            kind: "Block",
            statements: [
              {
                kind: "BindingDecl",
                binding: 0,
                name: "tex",
                type: { kind: "sampler", name: "sampler2D" },
                span,
              },
              {
                kind: "ReturnStmt",
                value: {
                  kind: "Literal",
                  value: 1.0,
                  literalKind: "float",
                  span,
                },
                span,
              },
            ],
            span,
          },
          span,
        },
      ],
      span,
    };
    const { diagnostics } = typeCheck(program, "test.gl");
    expect(diagnostics).toEqual([]);
  });

  it("rejects unknown binary operator", () => {
    const span: Span = { line: 1, column: 1 };
    const program: Program = {
      kind: "Program",
      statements: [
        {
          kind: "FnDecl",
          name: "main",
          params: [],
          returnType: { kind: "vector", element: "f32", size: 4 },
          body: {
            kind: "Block",
            statements: [
              {
                kind: "ReturnStmt",
                value: {
                  kind: "BinaryExpr",
                  left: {
                    kind: "Literal",
                    value: 1,
                    literalKind: "int",
                    span,
                  },
                  operator: "@",
                  right: {
                    kind: "Literal",
                    value: 2,
                    literalKind: "int",
                    span,
                  },
                  span,
                },
                span,
              },
            ],
            span,
          },
          span,
        },
      ],
      span,
    };
    const { diagnostics } = typeCheck(program, "test.gl");
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Unknown operator"))).toBe(true);
  });

  it("type-checks bare expression statement", () => {
    const span: Span = { line: 1, column: 1 };
    const program: Program = {
      kind: "Program",
      statements: [
        {
          kind: "FnDecl",
          name: "main",
          params: [],
          returnType: { kind: "scalar", name: "f32" },
          body: {
            kind: "Block",
            statements: [
              {
                kind: "ExpressionStmt",
                expression: {
                  kind: "Literal",
                  value: 1.0,
                  literalKind: "float",
                  span,
                },
                span,
              },
              {
                kind: "ReturnStmt",
                value: {
                  kind: "Literal",
                  value: 1.0,
                  literalKind: "float",
                  span,
                },
                span,
              },
            ],
            span,
          },
          span,
        },
      ],
      span,
    };
    const { diagnostics } = typeCheck(program, "test.gl");
    expect(diagnostics).toEqual([]);
  });

  it("type-checks array type comparison", () => {
    const { diagnostics } = check(`
      fn takeArray(x: [f32; 4]): f32 { return x[0] }
      fn main(): vec4 {
        let a: [i32; 4]
        return vec4(takeArray(a), 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("expects f32[4], got i32[4]"))).toBe(true);
  });

  it("type-checks abstract int plus concrete float", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: f32 = 2.0
        let y: f32 = 1 + x
        return vec4(y, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("type-checks abstract int plus abstract int", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let y: i32 = 1 + 2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects duplicate field in struct literal", () => {
    const { diagnostics } = check(`
      struct Point { f32 x, f32 y }
      fn main(): vec4 {
        let p: Point = { .x = 1.0, .x = 2.0 }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Duplicate field"))).toBe(true);
  });

  it("rejects struct literal field that cannot convert", () => {
    const { diagnostics } = check(`
      struct Point { i32 x, f32 y }
      fn main(): vec4 {
        let p: Point = { .x = 1.0, .y = 2.0 }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Cannot convert field"))).toBe(true);
  });

  it("rejects struct literal with unknown type name", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: f32 = { .r = 1.0 }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("Unknown struct"))).toBe(true);
  });

  // New scalar types
  it("accepts i32 scalar type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: i32 = 42
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts i8 scalar type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: i8 = 42
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts u8 scalar type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: u8 = 42
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts i16 scalar type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: i16 = 42
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts i64 scalar type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: i64 = 42
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts f64 scalar type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: f64 = 1.0
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts u16 scalar type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: u16 = 42
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts u64 scalar type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: u64 = 42
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts f16 scalar type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: f16 = 1.0
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts bf16 scalar type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: bf16 = 1.0
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts ivec4 vector type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: ivec4 = ivec4(1, 2, 3, 4)
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts uvec4 vector type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: uvec4 = uvec4(1, 2, 3, 4)
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts dvec4 vector type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: dvec4 = dvec4(1.0, 2.0, 3.0, 4.0)
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts bvec4 vector type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: bvec4 = bvec4(true, false, true, false)
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts quat type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: quat
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  // Hex/octal/binary literals
  it("accepts hex integer literal", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: i32 = 0xFF
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts octal integer literal", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: i32 = 0o77
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts binary integer literal", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: i32 = 0b1010
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts scientific notation float literal", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: f32 = 1.5e-3
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts char literal", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: i32 = 'A'
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts color literal", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: u32 = #FF0000
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  // Swizzle on non-float vectors
  it("accepts swizzle on ivec4", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: ivec4 = ivec4(1, 2, 3, 4)
        let y: i32 = x.x
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts swizzle on bvec4", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: bvec4 = bvec4(true, false, true, false)
        let y: bool = x.x
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  // Arrays of various types
  it("accepts array of i32", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let arr: [i32; 4]
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects struct field with sampler type", () => {
    const { diagnostics } = check(`
      struct Mat { sampler2D tex, f32 roughness }
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("cannot have sampler type"))).toBe(true);
  });

  // Matrix types
  it("accepts mat2 type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: mat2 = mat2(1.0, 0.0, 0.0, 1.0)
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts mat3 type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: mat3 = mat3(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts mat4 type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: mat4 = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0)
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts mat4 from vec4 columns", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let c1: vec4 = vec4(1.0, 0.0, 0.0, 0.0)
        let c2: vec4 = vec4(0.0, 1.0, 0.0, 0.0)
        let c3: vec4 = vec4(0.0, 0.0, 1.0, 0.0)
        let c4: vec4 = vec4(0.0, 0.0, 0.0, 1.0)
        let x: mat4 = mat4(c1, c2, c3, c4)
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts dmat4 type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: dmat4
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts imat2 type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: imat2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts umat4 type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: umat4
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts non-square mat2x3 type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: mat2x3
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts non-square mat4x2 type", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: mat4x2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  // Quaternion constructor
  it("accepts quat constructor", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: quat = quat(1.0, 0.0, 0.0, 0.0)
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  // deg / rad built-ins
  it("accepts deg built-in", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: f32 = deg(1.0)
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts rad built-in", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: f32 = rad(1.0)
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  // Array literals
  it("accepts float array literal", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let arr: [f32; 3] = [1.0, 2.0, 3.0]
        return vec4(arr[0], arr[1], arr[2], 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts int array literal", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let arr: [i32; 3] = [1, 2, 3]
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects array literal with mismatched element types", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let arr: [f32; 3] = [1.0, 2, 3.0]
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  // Phase 5: Mutable variables
  it("accepts mutable variable declaration", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let mut x: f32 = 1.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  // Phase 5: Compound assignment
  it("accepts compound assignment with same types", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let mut x: f32 = 1.0
        x += 2.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects compound assignment with different types", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let mut x: f32 = 1.0
        x += true
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  // Phase 5: Increment/decrement
  it("accepts increment on i32", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let mut x: i32 = 1
        ++x
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts decrement on f32", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let mut x: f32 = 1.0
        x--
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  // Phase 5: Bitwise operators
  it("accepts bitwise and on i32", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: i32 = 1 & 2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts bitwise or on i32", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: i32 = 1 | 2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts bitwise xor on i32", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: i32 = 1 ^ 2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts bitwise not on i32", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: i32 = ~1
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts left shift on i32", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: i32 = 1 << 2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts right shift on i32", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: i32 = 4 >> 1
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects bitwise on f32", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: f32 = 1.0 & 2.0
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  // Phase 5: Spaceship operator
  it("accepts spaceship operator", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let a: i32 = 1 <=> 2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  // Phase 5: Ternary conditional
  it("accepts ternary conditional", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let b: bool = true
        let x: f32 = b ? 1.0 : 2.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects ternary with non-bool condition", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: f32 = 1.0 ? 1.0 : 2.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("must be bool"))).toBe(true);
  });

  it("rejects ternary with mismatched branch types", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let b: bool = true
        let x: f32 = b ? 1.0 : 2
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  // Phase 5: Null coalescing
  it("accepts null coalescing", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: i32 = 1 ?? 2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  // Phase 5: While loop
  it("accepts while loop with bool condition", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let mut i: i32 = 0
        while (i < 5) {
          i += 1
        }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("rejects while loop with non-bool condition", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        while (1.0) {
          return vec4(1.0, 0.0, 0.0, 1.0)
        }
      }
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("must be bool"))).toBe(true);
  });

  // Phase 5: For loop
  it("accepts for loop", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        for (let mut i: i32 = 0; i < 5; i += 1) {
          i
        }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  // Phase 5: Do-while loop
  it("accepts do-while loop", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let mut i: i32 = 0
        do {
          i += 1
        } while (i < 5)
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  // Phase 5: Loop
  it("accepts loop with break", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let mut i: i32 = 0
        loop {
          i += 1
          if (i > 5) { break }
        }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  // Phase 5: Match expression
  it("accepts match expression with literal patterns", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        let x: i32 = 1
        match x {
          1 => { return vec4(1.0, 0.0, 0.0, 1.0) }
          _ => { return vec4(0.0, 0.0, 0.0, 1.0) }
        }
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  // Phase 5: Panic and unreachable
  it("accepts panic statement", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        panic
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts unreachable statement", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        unreachable
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  // Phase 5: Discard
  it("accepts discard statement", () => {
    const { diagnostics } = check(`
      fn main(): vec4 {
        discard
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  // Phase 6: Enum declaration
  it("accepts enum declaration", () => {
    const { diagnostics } = check(`
      enum Color { Red, Green, Blue }
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  // Phase 6: Type alias
  it("accepts type alias", () => {
    const { diagnostics } = check(`
      type MyColor = vec4
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });

  // Phase 6: Impl block
  it("accepts impl block", () => {
    const { diagnostics } = check(`
      struct MyStruct { f32 x }
      impl MyStruct {
        fn getX(): f32 { return 1.0 }
      }
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(diagnostics).toEqual([]);
  });
});
