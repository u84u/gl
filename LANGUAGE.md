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

`@vertex fn main()` — returns `vec4` → writes the built-in `gl_Position` (GLSL, no `out` declaration) / `@builtin(position) vec4<f32>` (WGSL). May also return an output struct containing a `@builtin(position)` field plus `@location(N)` varying fields.

`@compute fn main()` — no return → `void main()` (GLSL) / `fn main()` (WGSL) with `@workgroup_size(1, 1, 1)`.

### Entry-point parameters

`@vertex` and `@fragment` `main` may take parameters. Each parameter requires an explicit attribute:

- `@location(N)` — a vertex-buffer input (vertex) or interpolated varying input (fragment).
- `@builtin(...)` — a built-in input, e.g. `@builtin(position)` on a vertex input (if supported).

Locations must be unique within a stage; a staged parameter without `@location`/`@builtin` is a compile error.

### Struct returns

Struct-returning `main` lowers to multiple `layout(location = N) out` vars (GLSL) or a returned struct (WGSL). A vertex output struct must include a `@builtin(position)` field (mapped to `gl_Position` in GLSL); its `@location(N)` fields are emitted as varyings (GLSL) / struct fields (WGSL). Fragment output structs keep working: their fields become per-location outputs.

```gl
struct FragOutput { f32 r, f32 g, f32 b, f32 a, f32 depth }

fn main(): FragOutput {
  return { .r = 1.0, .g = 0.5, .b = 0.25, .a = 1.0, .depth = 0.5 }
}
```

## Fragment varyings

Fragment `main` parameters declared with `@location(N)` are interpolated inputs from the vertex stage. Vertex `@location(N)` outputs are the matching varyings.

## Two entry points in one file

A single `.gl` source may declare both `@vertex fn main(...)` and `@fragment fn main(...)`. `compileSync`/`compileAsync` emit one shader artifact per entry point (`result.shaders`, in source order), each standalone with its own header and entry point. A file with only one `main` still produces a single artifact.

### `shape.gl` — rounded/filled rectangle

```gl
struct Uniforms {
  vec4 color,
  vec4 rect,
  f32 radius,
}

@binding(0) uniform uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) vec4 position,
  @location(0) vec4 color,
}

@vertex
fn main(@location(0) position: vec2): VertexOutput {
  let ndc_x: f32 = uniforms.rect.x * 2.0 - 1.0;
  let ndc_y: f32 = 1.0 - uniforms.rect.y * 2.0;
  let ndc_w: f32 = uniforms.rect.z * 2.0;
  let ndc_h: f32 = uniforms.rect.w * 2.0;
  let pos: vec2 = position * vec2(ndc_w, ndc_h) + vec2(ndc_x, ndc_y - ndc_h);

  let mut output: VertexOutput;
  output.position = vec4(pos, 0.0, 1.0);
  output.color = uniforms.color;
  return output;
}

@fragment
fn main(@location(0) color: vec4): vec4 {
  return color;
}
```

### `text.gl` — textured glyph quads

```gl
struct Uniforms {
  vec4 color,
  vec4 rect,
  vec4 uv_rect,
}

@binding(0) uniform uniforms: Uniforms;
@binding(1) uniform tex: sampler2D;

struct VertexOutput {
  @builtin(position) vec4 position,
  @location(0) vec4 color,
  @location(1) vec2 uv,
}

@vertex
fn main(@location(0) position: vec2, @location(1) uv: vec2): VertexOutput {
  ...
}

@fragment
fn main(@location(0) color: vec4, @location(1) uv: vec2): vec4 {
  return color * textureSample(tex, uv);
}
```

## Built-ins

`dot`, `cross`, `normalize`, `length`, `mix`, `clamp`, `min`, `max`, `abs`, `sin`, `cos`, `pow`, `sqrt`, `floor`, `fract`, `texture`, `textureSample`, `deg`, `rad`, `rotateLeft`, `rotateRight`, `bitCount`, `extract`, `insert`, `reverse`

- `texture(tex, uv)` — samples a `sampler2D` (GLSL `texture`, WGSL `textureSample(tex, sampler, uv)` with a synthesized sampler binding).
- `textureSample(tex, uv)` — identical to `texture`; required name for the GLX text shader path.

## Diagnostics

- Missing `@location`/`@builtin` on a staged entry-point parameter.
- Duplicate `@location` within one stage.
- `@builtin(position)` on a non-vertex input.
- Vertex output struct without a `@builtin(position)` field.
- `textureSample` with a non-sampler first argument.
- Sampler used in an arithmetic expression.

