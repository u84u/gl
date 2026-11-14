# AGENTS.md - @u84u/gl

Compiler for `gl`, a statically-typed shading language that transpiles to GLSL (450, ES 3.00) and WGSL.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run typecheck` | `tsc --noEmit` — strict, run before every change |
| `npm test` | `vitest run` — full test suite |
| `npm run coverage` | `vitest run --coverage` |
| `npm run build` | `tsup` bundle to `dist/` (ESM only, clean output) |
| `npm run build:validate` | Compiles C validator (needs system `libOSMesa`, `libGL`) |
| `npm run validate` | Runs `build:validate` |
| `npm run dev` | `tsup --watch` |
| `npm run lsp` | `tsx src/lsp/server.ts` |

No separate lint step. `tsconfig.json` is strict (`noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`, etc.).

## Entry points

- `src/index.ts` — `compileSync(options)` / `compileAsync(options)`: resolve imports → parse → typecheck → lower to IR → validate → codegen. Re-exports `tokenize`, `parse`, `typeCheck`, `generateGLSL`, `generateWGSL`. `CompileResult` exposes `code` and `shaders`. Registry injectable via `options.registry`.
- `src/cli.ts` — `gl <input.gl> [--target=glsl\|glsl-450\|glsl-es-300\|wgsl] [--output=<file>] [--format] [--check]` (Node-only)
- `src/typechecker.ts` — `typeCheck(program, file, provenance?)` → `{ diagnostics }`
- `tsup.config.ts` — ESM only, entries `src/index.ts`, `src/node/resolver.ts`, `src/browser/resolver.ts`, `src/cli.ts`
- `src/modules/resolver.ts` — `SourceResolver` interface, `SourceModule`, `MemorySourceResolver`
- `src/modules/graph.ts` — `collectModuleGraph()`: import traversal, cycle detection, declaration collection via resolver. Returns `{ statements, registry, provenance }`.
- `src/node/resolver.ts` — `NodeFileSourceResolver` (Node-only, uses `node:fs/promises` and `node:path`)
- `src/browser/resolver.ts` — `FetchSourceResolver` (browser, uses `fetch`)
- `src/ir/shader-ir.ts` — backend-independent shader IR types (`IRModule`, `IRModuleItem`, `IRType`, `IRExpression`, `IRStatement`)
- `src/ir/lower.ts` — AST → IR lowering (`lowerProgram`)
- `src/ir/raise.ts` — IR → AST raise (`raiseProgram`)
- `src/codegen/capabilities.ts` — `BackendCapabilities`, `ShaderTarget`, `ShaderStage`, `ScalarTypeName`
- `src/codegen/backend.ts` — `ShaderCodegenBackend` interface, `BackendRegistry`, `defaultRegistry`, `createDefaultBackendRegistry`, `getBackend`
- `src/codegen/glsl.ts` — GLSL 4.50 backend (`GlslBackend`) + `validateGLSLModule`
- `src/codegen/glsl-es-300.ts` — GLSL ES 3.00 backend (`GlslEs300Backend`)
- `src/codegen/wgsl.ts` — WGSL backend (`WgslBackend`) + `validateWGSLModule` + `validateWGSLModuleIR`

Package exports: `.` (core), `./node` (Node resolver), `./browser` (fetch resolver), `./cli` (CLI).

**Core purity**: `src/index.ts` and the module graph do not import `fs`, `path`, or any Node built-in at module scope. All host I/O goes through an injected `SourceResolver`. The Node resolver uses `node:fs/promises` and `node:path`.

Pipeline: `resolve imports (via SourceResolver) → tokenize → parse → typeCheck → lower to IR → validate capabilities → codegen`.

Backends register themselves in `defaultRegistry` (`src/codegen/backend.ts`). `compileSync`/`compileAsync` look up the backend by target ID and call `validate()` then `generate()`.

## Targets

| Target | Consumer | GLSL version header |
|--------|----------|---------------------|
| `glsl` / `glsl-450` | Desktop OpenGL | `#version 450 core` |
| `glsl-es-300` | WebGL 2 | `#version 300 es` |
| `wgsl` | WebGPU | n/a |

`glsl` is an alias for `glsl-450`. GLSL ES 3.00 is a distinct backend — not merely GLSL 4.50 with a different version line (adds `precision mediump float;`, rejects f64/64-bit ints).

## Shader stages

`FnDecl.stage` (`ShaderStage`: `"vertex" \| "fragment" \| "compute"`) is optional. When present on `main`:

- **fragment**: returns `vec4` → `out vec4 fragColor` (GLSL) / `@location(0) vec4<f32>` (WGSL)
- **vertex**: returns `vec4` → `out vec4 gl_Position` (GLSL) / `@builtin(position) vec4<f32>` (WGSL)
- **compute**: no return → `void main()` (GLSL) / `fn main()` (WGSL) with `@workgroup_size(1, 1, 1)`

Stage attributes: `@vertex fn main()`, `@fragment fn main()`, `@compute fn main()`. Default is `fragment`.

## Public API

```ts
compileSync({ target, source?, ast?, file?, sourceId?, registry?, provenance? })       // sync; no imports in source
compileAsync({ target, resolver, source?, ast?, file?, sourceId?, registry?, provenance? })  // async; resolver required for imports
compile({ target, source?, ast?, file? })                      // deprecated alias for compileSync
```

Targets: `"glsl" \| "glsl-450" \| "glsl-es-300" \| "wgsl"` (type is `string`; custom targets can be registered).

Source containing imports **must** use `compileAsync` with an injected `SourceResolver`; `compileSync` returns a diagnostic if imports are present.

### CompileResult

```ts
interface CompileResult {
  code: string | null;
  shaders: ShaderArtifact[];  // full artifact list (code, stage, entryPoint, reflection)
  ast: Program;
  diagnostics: Diagnostic[];
  target: string;
}
```

### BackendRegistry

- `register(backend)` — registers a backend; validates capability consistency (e.g. `supportsF16` must match `scalarTypes.has("f16")`).
- `replace(backend)` — replaces an existing backend (same validation).
- `get(id)` / `has(id)` / `ids()` — lookup by string target ID.
- `createDefaultBackendRegistry()` — copies all built-in backends into a new registry.

Backends implement `ShaderCodegenBackend` with `validate(module: IRModule, file)` and `generate(module: IRModule, file, options?)` — they consume `IRModule`, not `Program` AST.

## Type system quirks

- **Abstract literals** (bare `2` / `1.0`) adapt to context; concrete typed values (`i32` vs `f32`) are never implicitly coerced — convert explicitly.
- **No silent numeric narrowing**: backends reject unsupported scalar types (`i64`, `u64`, `f64`, `bf16` for WGSL/ES 3.00; etc.) with structured diagnostics instead of silently collapsing them to 32-bit types.
- **`main` entry**: see shader stages above.
- **Imports**: `import "./other.gl"` brings top-level `struct`/`fn`/`@binding`/`enum`/`type`/`opaque`/`trait`/`impl` declarations into scope. Circular imports handled via a visited set — do not reimplement. `collectModuleGraph` returns a `provenance` map for imported diagnostics.

## Diagnostics

Structured `Diagnostic` type: `file`, `code?`, `severity?` ("error"\|"warning"\|"info"\|"hint"), `message`, `span` ({line, column, endLine?, endColumn?}), `related?`, `help?`. Use `diagnostic(file, span, message, options?)` helper. Backend validation diagnostics include stable codes like `WGSL_UNSUPPORTED_SCALAR`, `WGSL_UNSUPPORTED_STAGE`, `GLSL_UNSUPPORTED_SCALAR`, `GLSL_ES_NO_DOUBLE`.

## Adding a language feature

1. `lexer.ts`: add `TokenKind` + `KEYWORDS` entry + `scanToken()` logic
2. `types.ts`: add AST interface(s), add to `Statement`/`Expression`/`Type` unions
3. `parser.ts`: add parsing method, wire into `declaration()`/`statement()`/`expression()`
4. `typechecker.ts`: `typeOf()` for expressions, `typeCheckStatement()` for statements
5. `src/ir/lower.ts` + `src/ir/raise.ts`: add IR node + lowering/raising (handle `IRModuleItem` in `lowerProgram`/`raiseProgram`)
6. `src/codegen/glsl.ts` / `src/codegen/glsl-es-300.ts` / `src/codegen/wgsl.ts`: `emitStatement()` and/or `emitExpression()` + target validation (validate against `IRModule`)
7. `formatter.ts`: `formatStatement()` and/or `formatExpression()`
8. `*.test.ts`: add tests
9. Run `npm run typecheck`, `npm test`, `npm run build`, `npm run validate`

Adding a new `Statement`/`Expression` kind requires updating the `StatementVisitor`/`ExpressionVisitor` interfaces and `visitStatement`/`visitExpression` dispatchers in `types.ts`.

## Style

- 2-space indentation, double quotes
- No comments unless explaining non-obvious logic
- Error messages include construct name and actual/expected types
- All functions have explicit return types
- All AST nodes carry `kind` discriminant + `span: { line, column }`

## What not to do

- Don't add a lint command — none exists.
- Don't claim WGSL / GLSL ES are stubs/throws — both are fully implemented.
- Don't import `fs`, `path`, or Node built-ins into `src/index.ts` or `src/modules/*` — host I/O goes through `SourceResolver` adapters only.
- Don't silently narrow numeric types — backends must reject unsupported types with diagnostics.
- Don't mutate `fn params[i]` without `!` — `noUncheckedIndexedAccess` makes indexed access possibly `undefined`.
- Don't use property access on index signatures — `noPropertyAccessFromIndexSignature` is on.
