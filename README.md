# @u84u/gl

Compile `gl`, a statically-typed shading language, to GLSL (450 core, ES 3.00) or WGSL.

## Install

```bash
npm install @u84u/gl
```

## CLI

```bash
gl <input.gl> [--target=glsl|wgsl] [--output=<file>] [--format] [--check]
```

See `LANGUAGE.md` for the full language reference, shader stages, imports, and built-ins.

## Library API

```ts
import { compileSync } from "@u84u/gl";

const result = compileSync({
  target: "wgsl",
  source: `fn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }`,
  file: "shader.gl",
});

if (result.diagnostics.some((d) => d.severity === "error")) {
  // handle diagnostics
} else {
  // result.code is the legacy single-output convenience path
  // result.shaders contains the complete artifact list with reflection
  console.log(result.shaders[0]?.code);
}
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `target` | `string` | Backend target ID: `"glsl"`, `"glsl-450"`, `"glsl-es-300"`, `"wgsl"` (or a custom registered target) |
| `file` | `string` | Source file identity for diagnostics |
| `sourceId` | `string` | Stable canonical identity for the main source (defaults to `file`) |
| `source` | `string` | Source text to parse and compile (mutually exclusive with `ast`) |
| `ast` | `Program` | Pre-built AST to type-check and codegen (mutually exclusive with `source`) |
| `resolver` | `SourceResolver` | Required for `compileAsync` when source contains imports |
| `registry` | `BackendRegistry` | Optional backend registry (defaults to the shared default registry) |
| `provenance` | `Map<Statement, string>` | Maps statements to source files for imported-module diagnostics |

### Entry points

- `compileSync(options)` — sync; no imports in source. Returns `CompileResult`.
- `compileAsync(options)` — async; `resolver` required when source contains imports. Returns `Promise<CompileResult>`.
- `compile(options)` — deprecated alias for `compileSync`.

### CompileResult

```ts
interface CompileResult {
  code: string | null;        // convenience: first shader's code, or null
  shaders: ShaderArtifact[];  // full artifact list with code, stage, entry point, reflection
  ast: Program;               // type-checked program
  diagnostics: Diagnostic[];  // structured diagnostics
  target: string;             // resolved target ID
}
```

Each `ShaderArtifact` includes `stage`, `entryPoint`, `code`, and `reflection` (entry points, resources, uniforms).

### Shader reflection

`ShaderReflection` includes:
- `entryPoints`: entry point name, stage, inputs (params with name/type), outputs (return values with name/type/location/builtin)
- `resources`: every binding with `kind` ("sampler"/"sampledTexture"/"uniform"/"uniformBuffer"), `binding`, `set`, `stageVisibility`. GLSL non-sampler bindings are reported as standalone `"uniform"` declarations; WGSL `var<uniform>` bindings are reported as `"uniformBuffer"`. Synthesized sampler bindings for texture bindings are included (WGSL) with the binding actually emitted by codegen.
- `uniforms`: uniform declarations with `name`, `type`, `offset`, `size`. GLSL standalone uniforms each have `offset: 0`; WGSL uniform buffers are sized using WGSL uniform address-space layout rules.

### Backend capability enforcement

Backends reject unsupported features with structured diagnostics instead of silently narrowing types:
- `WGSL_UNSUPPORTED_SCALAR`, `WGSL_UNSUPPORTED_STAGE`, `WGSL_UNSUPPORTED_RESOURCE`, `WGSL_UNSUPPORTED_MATRIX`
- `GLSL_UNSUPPORTED_SCALAR`, `GLSL_UNSUPPORTED_STAGE`, `GLSL_UNSUPPORTED_RESOURCE`

Validation checks shader stages, scalar types, and resource kinds against each backend's `BackendCapabilities`.

### Custom backends

Backends register themselves in a `BackendRegistry`. Use `createDefaultBackendRegistry()` to copy the built-in registry, then `registry.register(backend)` or `registry.replace(backend)` to add or override targets. Pass your registry via `options.registry`.

Package entry points: `@u84u/gl` (core), `@u84u/gl/node` (filesystem resolver), `@u84u/gl/browser` (fetch resolver), `@u84u/gl/cli`.

## Development

Development and CI require **Node.js 22.12.0 or newer**. CI checks Node 22.12 and Node 24 on Linux, Windows, and macOS.

```bash
npm ci                      # reproducible dependency install
npm run install:browsers    # once: Playwright Chromium for render tests
npm run build               # tsup bundle to dist/ (ESM)
npm run typecheck           # tsc --noEmit (strict)
npm test                    # vitest — full test suite
npm run test:render         # only the WebGL2 render tests
npm run test:package        # pack/install and smoke-test published entry points

The full suite independently validates every generated WGSL fixture with [Naga](https://github.com/gfx-rs/wgpu/tree/trunk/naga), in addition to checking golden output. Naga runs through the `naga-wasi-cli` dev dependency; it does not require installing Rust.

Render validation runs through Playwright against the standalone WebGL2 page in `test/webgl/index.html`, so no C toolchain, OSMesa, or apitrace is required. Open that page directly in a WebGL2-capable browser to edit and render a fragment shader by hand. On Linux CI, install Chromium system dependencies with `npx playwright install --with-deps chromium`.

## License

CC BY 4.0
