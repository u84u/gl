# @u84u/gl

Compiler for `gl`, a statically-typed shading language that transpiles to GLSL fragment shaders.

## Install

```bash
npm install @u84u/gl
```

## CLI

```
gl <input.gl> [--target=glsl|wgsl] [--output=<file>] [--format] [--check]
```

| Flag | Description |
|------|-------------|
| `--target`, `-t` | Output target (`glsl` only in v1; `wgsl` planned for v2) |
| `--output`, `-o` | Write output to file instead of stdout |
| `--format`, `-f` | Format `.gl` source canonically |
| `--check` | Validate without emitting output (exit 0 on success, 1 on error) |

## Example

```glsl
struct Color { f32 r, f32 g, f32 b }

@binding(0) uniform tex: sampler2D
@binding(1) uniform time: f32

fn main(): vec4 {
  let uv: vec2 = vec2(0.5, 0.5)
  let col: vec4 = texture(tex, uv)
  return vec4(col.rgb * time, col.a)
}
```

## Types

Scalars: `i32`, `u32`, `f32`, `bool`
Vectors: `vec2`, `vec3`, `vec4` (float vectors only in v1)
Structs: `struct Color { f32 r, f32 g }`
Enums: `enum Color { Red, Green, Blue }`
Type aliases: `type MyColor = vec4`

## Typing

Abstract literals (`2`, `1.0`) adapt to context. Concrete typed values (`i32` vs `f32`) are never implicitly coerced.

## Control flow

`if/else`, `while`, `for`, `do/while`, `loop`, `break`, `continue`

## Expressions

Compound assignment (`+=`, `-=`, `*=`, `/=`, `%=`, `&=`, `\|=`, `^=`, `<<=`, `>>=`), increment/decrement (`++`, `--`), ternary (`? :`), null coalescing (`??`), spaceship (`<=>`), bitwise (`&`, `\|`, `^`, `~`, `<<`, `>>`), match expressions

## Statements

`panic`, `unreachable`, `discard`

## Entry point

`fn main(): vec4` lowers to `out vec4 fragColor; void main() { fragColor = ...; }`.

Struct returns lower to multiple `out` vars:

```glsl
struct FragOutput { f32 color, f32 depth }

fn main(): FragOutput {
  return FragOutput { .color = vec4(1.0, 0.0, 0.0, 1.0), .depth = 0.5 }
}
```

## Imports

`import "./other.gl"` brings top-level `struct`, `fn`, `@binding` declarations into scope. Circular imports handled via visited set.

## Built-ins

`dot`, `cross`, `normalize`, `length`, `mix`, `clamp`, `min`, `max`, `abs`, `sin`, `cos`, `pow`, `sqrt`, `floor`, `fract`, `texture`

## Development

```bash
npm install
npm run build   # tsup bundle to dist/
npm run typecheck   # tsc --noEmit
npm test        # vitest
```

## License

CC BY 4.0