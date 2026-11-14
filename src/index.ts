import { tokenize } from "./lexer";
import { parse } from "./parser";
import { typeCheck, Diagnostic } from "./typechecker";
import { generateGLSL } from "./codegen/glsl";
import { generateWGSL } from "./codegen/wgsl";
import { lowerProgram } from "./ir/lower";
import { raiseProgram } from "./ir/raise";
import { defaultRegistry } from "./codegen/backend";
import "./codegen/glsl-es-300";
import "./codegen/glsl";
import "./codegen/wgsl";
import {
  Program,
  Statement,
} from "./types";
import {
  SourceResolver,
} from "./modules/resolver";
import { collectModuleGraph, CollectedProgram } from "./modules/graph";
export {
  span,
  scalarType, i8, u8, i16, u16, i32, u32, i64, u64, f16, f32, f64, bf16, boolType,
  vectorType, vec2, vec3, vec4, ivec2, ivec3, ivec4, uvec2, uvec3, uvec4,
  bvec2, bvec3, bvec4, dvec2, dvec3, dvec4, matrixType, mat2, mat3, mat4,
  mat2x3, mat3x2, dmat3, quatType, structType, enumType, samplerType,
  sampler2D, sampler3D, samplerCube, arrayType, tupleType, optionType,
  resultType, aliasType, opaqueType, anonymousStructType, unionType,
  field, param,
  structDecl, enumDecl, fnDecl, bindingDecl, importDecl, varDecl,
  returnStmt, expressionStmt, block, ifStmt, whileStmt, forStmt,
  rangeForStmt, doWhileStmt, loopStmt, breakStmt, continueStmt,
  discardStmt, panicStmt, unreachableStmt,
  ident, int, float, boolLiteral, binary, unary, call, member,
  swizzle, index, structLiteral, arrayLiteral, compoundAssign, update,
  conditional, nullCoalescing, match, blockExpr,
  literalPattern, bindingPattern, wildcardPattern, arm,
  typeAlias, newtypeDecl, opaqueDecl, traitDecl, implBlock,
  program, mainFn, mainVec4,
} from "./ast";
export { SourceResolver, SourceModule, MemorySourceResolver } from "./modules/resolver";

/**
 * Options for compiling a gl source file or AST.
 */
export interface CompileOptions {
  target: "glsl" | "glsl-es-300" | "glsl-450" | "wgsl";
  file?: string;
  /** Source text to parse and compile (mutually exclusive with `ast`). */
  source?: string;
  /** Pre-built AST to type-check and codegen (mutually exclusive with `source`). */
  ast?: Program;
  /** Source resolver for import resolution. Required when source contains imports. */
  resolver?: SourceResolver;
  /** Stable, canonical identity for the main source (used in diagnostics + module graph). */
  sourceId?: string;
}

export interface CompileSyncOptions<Target extends "glsl" | "glsl-es-300" | "glsl-450" | "wgsl" = "glsl" | "glsl-es-300" | "glsl-450" | "wgsl">
  extends CompileOptions {
  target: Target;
}

export interface CompileAsyncOptions<Target extends "glsl" | "glsl-es-300" | "glsl-450" | "wgsl" = "glsl" | "glsl-es-300" | "glsl-450" | "wgsl">
  extends CompileOptions {
  target: Target;
  resolver: SourceResolver;
}

/**
 * Result of compiling a gl source file or AST, indexed by target.
 */
export interface CompileResult<Target extends "glsl" | "glsl-es-300" | "glsl-450" | "wgsl" = "glsl" | "glsl-es-300" | "glsl-450" | "wgsl"> {
  code: string | null;
  ast: Program;
  diagnostics: Diagnostic[];
  target: Target;
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Compiles a pre-built Program AST to the target language.
 *
 * Skips parsing and import resolution; runs type checking and code
 * generation directly on the supplied AST.
 */
function compileProgram<Target extends "glsl" | "glsl-es-300" | "glsl-450" | "wgsl">(
  ast: Program,
  file: string,
  target: Target,
): CompileResult<Target> {
  const diagnostics: Diagnostic[] = [];

  try {
    const typeResult = typeCheck(ast, file);
    diagnostics.push(...typeResult.diagnostics);
  } catch (err) {
    diagnostics.push({
      file,
      span: { line: 1, column: 1 },
      message: formatError(err),
    });
    return { code: null, ast, diagnostics, target } as CompileResult<Target>;
  }

  const hasErrors = diagnostics.length > 0;

  let code: string | null = null;
  if (!hasErrors) {
    try {
      // Lower the type-checked AST into the backend-independent IR, then
      // raise it back to an AST for code generation. This round-trip proves
      // the IR preserves the program and lets existing generators consume IR.
      const ir = lowerProgram(ast, file);
      const raisedAst = raiseProgram(ir);

      const backend = defaultRegistry.get(target);
      if (!backend) {
        throw new Error(`Unknown target: ${target}`);
      }

      const validationDiagnostics = backend.validate(raisedAst, file);
      diagnostics.push(...validationDiagnostics);
      if (validationDiagnostics.some((d) => d.severity === "error")) {
        return { code: null, ast: raisedAst, diagnostics, target } as CompileResult<Target>;
      }

      const output = backend.generate(raisedAst, file);
      diagnostics.push(...output.diagnostics);
      if (output.diagnostics.some((d) => d.severity === "error")) {
        return { code: null, ast: raisedAst, diagnostics, target } as CompileResult<Target>;
      }

      code = output.shaders.length > 0 ? output.shaders[0]!.code : null;
    } catch (err) {
      diagnostics.push({
        file,
        span: { line: 1, column: 1 },
        message: formatError(err),
      });
      return { code: null, ast, diagnostics, target } as CompileResult<Target>;
    }
  }

  return { code, ast, diagnostics, target } as CompileResult<Target>;
}

/**
 * Collects declarations from a single source string synchronously.
 * Only supports source without imports. Returns null if imports are present.
 */
function collectSingleFile(
  source: string,
): { statements: Statement[]; hasImports: boolean } {
  const tokens = tokenize(source);
  const ast = parse(tokens);

  const statements: Statement[] = [];
  let hasImports = false;

  for (const stmt of ast.statements) {
    if (stmt.kind === "ImportDecl") {
      hasImports = true;
    } else {
      statements.push(stmt);
    }
  }

  return { statements, hasImports };
}

/**
 * Compiles a pre-built Program AST or single-file source (no imports) to the target language.
 *
 * This is the synchronous entry point. Source containing imports requires
 * `compileAsync` with an injected `SourceResolver`.
 *
 * @param options - Compilation options (target, file, and either `source` or `ast`).
 * @returns CompileResult indexed by the target.
 */
export function compileSync<Target extends "glsl" | "glsl-es-300" | "glsl-450" | "wgsl">(
  options: CompileSyncOptions<Target>,
): CompileResult<Target> {
  const { target } = options;
  const file = options.file ?? options.sourceId ?? "test.gl";

  // AST-based path: skip parsing / imports
  if (options.ast) {
    return compileProgram(options.ast, file, target);
  }

  // Source-based path: parse + typecheck + codegen (no imports supported synchronously)
  const source = options.source;
  if (!source) {
    return {
      code: null,
      ast: { kind: "Program", statements: [], span: { line: 1, column: 1 } },
      diagnostics: [
        {
          file,
          span: { line: 1, column: 1 },
          message: "Either 'source' or 'ast' must be provided",
        },
      ],
      target,
    } as CompileResult<Target>;
  }

  const { statements, hasImports } = collectSingleFile(source);
  if (hasImports) {
    return {
      code: null,
      ast: { kind: "Program", statements, span: { line: 1, column: 1 } },
      diagnostics: [
        {
          file,
          span: { line: 1, column: 1 },
          message: "Source contains imports; use compileAsync with a SourceResolver to resolve imported modules",
        },
      ],
      target,
    } as CompileResult<Target>;
  }

  const programAst: Program = {
    kind: "Program",
    statements,
    span: { line: 1, column: 1 },
  };

  return compileProgram(programAst, file, target as Target);
}

/**
 * Compiles a gl source file or pre-built AST to the target language with async
 * module resolution. Resolves imports through the injected `SourceResolver`.
 *
 * @param options - Compilation options (target, resolver, and either `source` or `ast`).
 * @returns CompileResult indexed by the target.
 */
export async function compileAsync<Target extends "glsl" | "glsl-es-300" | "glsl-450" | "wgsl">(
  options: CompileAsyncOptions<Target>,
): Promise<CompileResult<Target>> {
  const { target, resolver } = options;
  const file = options.file ?? options.sourceId ?? "test.gl";
  const sourceId = options.sourceId ?? file;

  // AST-based path: skip parsing / imports
  if (options.ast) {
    return compileProgram(options.ast, file, target);
  }

  // Source-based path: resolve module graph + typecheck + codegen
  const source = options.source;
  if (!source) {
    return {
      code: null,
      ast: { kind: "Program", statements: [], span: { line: 1, column: 1 } },
      diagnostics: [
        {
          file,
          span: { line: 1, column: 1 },
          message: "Either 'source' or 'ast' must be provided",
        },
      ],
      target,
    } as CompileResult<Target>;
  }

  let graph: CollectedProgram | undefined;
  try {
    graph = await collectModuleGraph({
      source,
      sourceId,
      isMainFile: true,
      resolver,
    });
  } catch (err) {
    return {
      code: null,
      ast: { kind: "Program", statements: [], span: { line: 1, column: 1 } },
      diagnostics: [
        {
          file,
          span: { line: 1, column: 1 },
          message: formatError(err),
        },
      ],
      target,
    } as CompileResult<Target>;
  }

  const programAst: Program = {
    kind: "Program",
    statements: graph!.statements,
    span: { line: 1, column: 1 },
  };

  return compileProgram(programAst, file, target as Target);
}

/**
 * Compiles a gl source file or pre-built AST to the target language.
 *
 * When `source` is given without imports, compiles synchronously. When `source`
 * contains imports, returns a diagnostic directing the caller to `compileAsync`.
 * When `ast` is given, skips parsing and import resolution.
 *
 * @deprecated Use `compileSync` or `compileAsync` explicitly.
 * @param options - Compilation options (target, file, and either `source` or `ast`).
 * @returns CompileResult indexed by the target.
 */
export function compile<Target extends "glsl" | "glsl-es-300" | "glsl-450" | "wgsl">(
  options: CompileOptions & { target: Target },
): CompileResult<Target> {
  return compileSync(options as CompileSyncOptions<Target>);
}

export { tokenize, parse, typeCheck, generateGLSL, generateWGSL };
