# @u84u/gl

Compile `gl`, a statically-typed shading language, to GLSL (450 core, ES 3.00) or WGSL.

## Install

Not on npm. Install from GitHub:

```bash
npm install github:u84u/gl
```

## CLI

```bash
gl <input.gl> [--target=glsl|wgsl] [--output=<file>] [--format] [--check]
```

See `LANGUAGE.md` for the full language reference, shader stages, imports, and built-ins.

## Library API

```ts
import { compile } from "@u84u/gl";

const { code, diagnostics } = compile({
  target: "wgsl",
  source: `fn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }`,
  file: "shader.gl",
});
```

Package entry points: `@u84u/gl` (core), `@u84u/gl/node` (filesystem resolver), `@u84u/gl/browser` (fetch resolver), `@u84u/gl/cli`.

## Development

```bash
npm install          # dependencies
npm run build        # tsup bundle to dist/ (ESM)
npm run typecheck    # tsc --noEmit (strict)
npm test             # vitest — 587 tests
npm run validate     # build & run C shader validator (needs libOSMesa, libGL)
```

## License

CC BY 4.0
