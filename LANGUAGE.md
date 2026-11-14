# Language reference — `gl`

A statically-typed shading language that transpiles to GLSL (450 core, ES 3.00) and WGSL.

## Types

Scalars: `i32`, `u32`, `f32`, `f64`, `bool` (plus `i8`/`u8`/`i16`/`u16`/`i64`/`u64`/`f16`/`bf16` — backend-dependent support; WGSL supports `i32`/`u32`/`f32`/`f16`/`bool` and rejects the rest)
Vectors: `vec2`, `vec3`, `vec4` (WGSL emits `vecN<T>`, e.g. `vec3<i32>`; shaders using `f16` emit `enable f16;`)
Matrices: `mat2`, `mat3`, `mat4`, `dmat3`, `dmat4`
Samplers: `sampler2D`, `sampler3D`, `samplerCube`, etc.
Structs: `struct Color { f32 r, f32 g, f32 b, f32 a }`
Enums: `enum BlendMode { None, Add, Multiply }`
Type aliases: `type MyColor = vec4`
Opaque: `opaque MyOpaque`

Arrays: `[f32; 4]`, Tuples: `(f32, i32)`, Options: `Option<f32>`, Results: `Result<f32, i32>`

## Typing

Abstract literals (`2`, `1.0`) adapt to context. Concrete typed values (`i32` vs `f32`) are never implicitly coerced — you must convert explicitly. Backends reject unsupported scalar types with structured diagnostics rather than silently narrowing.

## Control flow

`if/else`, `while`, `for`, `do/while`, `loop`, `break`, `continue`, `for x in 0..3`, `for x in 0..=3`

## Expressions

Compound assignment (`+=`, `-=`, `*=`, `/=`, `%=`, `&=`, `\|=`, `^=`, `<<=`, `>>=`), increment/decrement (`++`, `--`), ternary (`? :`), null coalescing (`??`), spaceship (`<=>`), bitwise (`&`, `\|`, `^`, `~`, `<<`, `>>`), match expressions

## Statements

`panic`, `unreachable`, `discard`

## Shader stages

`@fragment fn main()` — default stage. Returns `vec4` → `out vec4 fragColor` (GLSL) / `@location(0) vec4<f32>` (WGSL).

`@vertex fn main()` — returns `vec4` → writes the built-in `gl_Position` (GLSL, no `out` declaration) / `@builtin(position) vec4<f32>` (WGSL).

`@compute fn main()` — no return → `void main()` (GLSL) / `fn main()` (WGSL) with `@workgroup_size(1, 1, 1)`.

## Struct returns

Struct-returning `main` lowers to multiple `layout(location = N) out` vars (GLSL) or a returned struct (WGSL).

```gl
struct FragOutput { f32 r, f32 g, f32 b, f32 a, f32 depth }

fn main(): FragOutput {
  return { .r = 1.0, .g = 0.5, .b = 0.25, .a = 1.0, .depth = 0.5 }
}
```

## Imports

`import "./other.gl"` brings top-level `struct`, `fn`, `@binding`, `enum`, `type`, `opaque`, `trait`, `impl` declarations into scope. Circular imports are handled via a visited set — no re-imports.

## Built-ins

`dot`, `cross`, `normalize`, `length`, `mix`, `clamp`, `min`, `max`, `abs`, `sin`, `cos`, `pow`, `sqrt`, `floor`, `fract`, `texture`, `deg`, `rad`, `rotateLeft`, `rotateRight`, `bitCount`, `extract`, `insert`, `reverse`
