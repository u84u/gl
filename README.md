# @u84u/gl

Compile `gl`, a statically-typed shading language, to GLSL (450 core, ES 3.00) or WGSL fragment shaders.

`gl` is designed for writing shaders with full static typing, abstract literals that adapt to context, and no implicit coercion between concrete types. It's a small language — structs, enums, bindings, control flow, match expressions — that lowers to `out vec4 fragColor` (GLSL) or `@fragment fn main` (WGSL).

## Install

Not on npm. Install from GitHub:

```bash
npm install github:u84u/gl
```

## CLI

```bash
gl <input.gl> [--target=glsl|glsl-450|glsl-es-300|wgsl] [--output=<file>] [--format] [--check]
```

| Flag | Description |
|------|-------------|
| `--target`, `-t` | Output target (`glsl`/`glsl-450` desktop OpenGL, `glsl-es-300` WebGL 2, `wgsl` WebGPU) |
| `--output`, `-o` | Write output to file instead of stdout |
| `--format`, `-f` | Format `.gl` source canonically |
| `--check` | Validate without emitting output (exit 0 on success, 1 on error) |

## Example

```gl
struct Color { f32 r, f32 g, f32 b, f32 a }

@binding(0) uniform tex: sampler2D
@binding(1) uniform time: f32

fn main(): vec4 {
  let uv: vec2 = vec2(0.5, 0.5)
  let col: vec4 = texture(tex, uv)
  return vec4(col.rgb * time, col.a)
}
```

## Shader stages

`@vertex fn main()` → position output (`out vec4 gl_Position` / `@builtin(position)`).
`@fragment fn main()` → color output (`out vec4 fragColor` / `@location(0)`), the default.
`@compute fn main()` → compute entry (`void main()` with `layout(local_size_x=1,...)` / `@workgroup_size(1, 1, 1)`).

```gl
@vertex
fn main(): vec4 {
  return vec4(0.0, 0.0, 0.0, 1.0)
}
```

## Types

Scalars: `i32`, `u32`, `f32`, `bool` (plus `i8`/`u8`/`i16`/`u16`/`i64`/`u64`/`f16`/`f64`/`bf16` — backend-dependent support)
Vectors: `vec2`, `vec3`, `vec4`
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

## Entry point

`fn main(): vec4` (fragment by default) lowers to `out vec4 fragColor; void main() { fragColor = ...; }`.

Struct returns lower to multiple `layout(location = N) out` vars (GLSL) or a returned struct (WGSL).

```gl
struct FragOutput { f32 r, f32 g, f32 b, f32 a, f32 depth }

fn main(): FragOutput {
  return { .r = 1.0, .g = 0.5, .b = 0.25, .a = 1.0, .depth = 0.5 }
}
```

## Imports

`import "./other.gl"` brings top-level `struct`, `fn`, `@binding`, `enum`, `type`, `opaque`, `trait`, `impl` declarations into scope. Circular imports are handled via a visited set — no re-imports.

The compiler core is host-agnostic: source resolution goes through an injected `SourceResolver`. Use `compileSync` for single-file or AST compilation, `compileAsync` with a resolver for imports. Node (`./node`) and browser (`./browser`) resolver adapters are provided.

## Built-ins

`dot`, `cross`, `normalize`, `length`, `mix`, `clamp`, `min`, `max`, `abs`, `sin`, `cos`, `pow`, `sqrt`, `floor`, `fract`, `texture`, `deg`, `rad`, `rotateLeft`, `rotateRight`, `bitCount`, `extract`, `insert`, `reverse`

## Library API

`gl` is also a library — construct ASTs programmatically and compile to either target:

```ts
import { compile } from "@u84u/gl";
import * as ast from "@u84u/gl";

const program = ast.program([
  ast.mainVec4([
    ast.varDecl("x", ast.f32(), ast.float(1.0)),
    ast.returnStmt(
      ast.call(ast.ident("vec4"), [
        ast.ident("x"), ast.float(0.0), ast.float(0.0), ast.float(1.0)
      ])
    ),
  ]),
]);

const { code } = compile({ target: "glsl", ast: program, file: "test.gl" });
// code -> "#version 450 core\nout vec4 fragColor;\nvoid main() {\n  fragColor = vec4(1.0, 0.0, 0.0, 1.0);\n}"
```

Pass `target: "wgsl"`, `target: "glsl-es-300"`, or `target: "glsl-450"` for other targets.

## Package entry points

| Entry | Purpose |
|-------|---------|
| `@u84u/gl` | Browser-safe compiler core (`compile`, `compileSync`, `compileAsync`, `parse`, `tokenize`, `typeCheck`, AST builders) |
| `@u84u/gl/node` | `NodeFileSourceResolver` for filesystem imports |
| `@u84u/gl/browser` | `FetchSourceResolver` for browser fetch imports |
| `@u84u/gl/cli` | CLI entry point |

## Development

```bash
npm install          # dependencies
npm run build        # tsup bundle to dist/ (ESM)
npm run typecheck    # tsc --noEmit (strict)
npm test             # vitest — golden-file + unit tests
npm run validate     # build & run C shader validator (needs libOSMesa, libGL)
```

TypeScript is strict (`noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, etc.). All functions have explicit return types. All AST nodes carry a `kind` discriminant and `span`.

## Architecture

```
Host app → SourceResolver → Module graph → Frontend (lex/parse/typecheck)
                                      ↓
                                Backend-independent IR
                                      ↓
                           Capability validation → Codegen backend (GLSL/WGSL)
```

The compiler core never imports Node built-ins or browser globals. Host I/O is injected through `SourceResolver`. GPU execution (WebGPU/WebGL device creation, draw calls) is a separate concern and lives outside this package.

## License

CC BY 4.0
