# AGENTS.md - @u84u/gl

Compiler for `gl`, a statically-typed shading language that transpiles to GLSL fragment shaders.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run typecheck` | `tsc --noEmit` — run this before every change |
| `npm test` | `vitest run` — full test suite |
| `npm run coverage` | `vitest run --coverage` |
| `npm run build` | `tsup` bundle to `dist/` (ESM only, clean output) |
| `npm run build:validate` | Compiles C validator (needs `libOSMesa`, `libGL`) |
| `npm run validate` | Runs `build:validate` |

TypeScript is **strict** (`tsconfig.json`): `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`. Write code that passes `typecheck` — there is no separate lint step.

## Entry points

- `src/index.ts` — `compile(options)`: parse → typecheck → codegen. Also re-exports `tokenize`, `parse`, `typeCheck`, `generateGLSL`, `generateWGSL`.
- `src/cli.ts` — `gl <input.gl> [--target=glsl\|wgsl] [--output=<file>] [--format] [--check]`
- `src/typechecker.ts` — `typeCheck(program, file)` → `Diagnostic[]`

Pipeline: `tokenize` → `parse` → `typeCheck` → `generateGLSL`. WGSL is a stub (throws).

## Type system quirks an agent would miss

- **Abstract literals** (WGSL model): bare `2` / `1.0` adapt to context, but concrete typed values (`i32` vs `f32`) are never implicitly coerced.
- **`main` entry**: `fn main(): vec4` or returns a struct. Codegen lowers vec4 returns to GLSL's `out vec4 fragColor`. Struct returns lower to multiple `out` vars at `layout(location = N)`.
- **Imports**: `import "./other.gl"` brings top-level `struct`/`fn`/`@binding` declarations into scope. Circular imports handled via visited set — do not reimplement.

## Adding a language feature

1. `lexer.ts`: add `TokenKind` + `KEYWORDS` entry + `scanToken()` logic
2. `types.ts`: add AST interface(s), add to `Statement`/`Expression`/`Type` unions
3. `parser.ts`: add parsing method, wire into `declaration()`/`statement()`/`expression()`
4. `typechecker.ts`: `typeOf()` for expressions, `typeCheckStatement()` for statements
5. `codegen/glsl.ts`: `emitStatement()` and/or `emitExpression()`
6. `formatter.ts`: `formatStatement()` and/or `formatExpression()`
7. `*.test.ts`: add tests
8. Run `npm run typecheck`, `npm test`, `npm run build`

## Style

- 2-space indentation, double quotes
- No comments unless explaining non-obvious logic
- Error messages include construct name and actual/expected types
- All functions have explicit return types
- All AST nodes carry `kind` discriminant + `span: { line, column }`

## What not to do

- Don't add a lint command — none exists.
- Don't assume `wgsl` codegen works — it throws "not yet implemented".
- Don't mutate `fn params[i]` without `!` — `noUncheckedIndexedAccess` makes indexed access possibly `undefined`.
- Don't use property access on index signatures — `noPropertyAccessFromIndexSignature` is on.
