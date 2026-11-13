import { tokenize } from "./lexer";
import { parse } from "./parser";
import { typeCheck, Diagnostic } from "./typechecker";
import { generateGLSL } from "./codegen/glsl";
import { generateWGSL } from "./codegen/wgsl";
import {
  Program,
  Statement,
  ImportDecl,
} from "./types";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";

export {
  span,
  // Types
  scalarType, i8, u8, i16, u16, i32, u32, i64, u64, f16, f32, f64, bf16, boolType,
  vectorType, vec2, vec3, vec4, ivec2, ivec3, ivec4, uvec2, uvec3, uvec4,
  bvec2, bvec3, bvec4, dvec2, dvec3, dvec4, matrixType, mat2, mat3, mat4,
  mat2x3, mat3x2, dmat3, quatType, structType, enumType, samplerType,
  sampler2D, sampler3D, samplerCube, arrayType, tupleType, optionType,
  resultType, aliasType, opaqueType, anonymousStructType, unionType,
  // Fields / Params
  field, param,
  // Statements
  structDecl, enumDecl, fnDecl, bindingDecl, importDecl, varDecl,
  returnStmt, expressionStmt, block, ifStmt, whileStmt, forStmt,
  rangeForStmt, doWhileStmt, loopStmt, breakStmt, continueStmt,
  discardStmt, panicStmt, unreachableStmt,
  // Expressions
  ident, int, float, boolLiteral, binary, unary, call, member,
  swizzle, index, structLiteral, arrayLiteral, compoundAssign, update,
  conditional, nullCoalescing, match, blockExpr,
  // Patterns
  literalPattern, bindingPattern, wildcardPattern, arm,
  // Declarations
  typeAlias, newtypeDecl, opaqueDecl, traitDecl, implBlock,
  // Program
  program, mainFn, mainVec4,
} from "./ast";

/**
 * Options for compiling a gl source file or AST.
 */
export interface CompileOptions {
  target: "glsl" | "wgsl";
  file: string;
  /** Source text to parse and compile (mutually exclusive with `ast`). */
  source?: string;
  /** Pre-built AST to type-check and codegen (mutually exclusive with `source`). */
  ast?: Program;
}

/**
 * Result of compiling a gl source file or AST, indexed by target.
 * The `target` field is a phantom type that lets consumers narrow
 * the result to a specific backend at the type level.
 */
export interface CompileResult<Target extends "glsl" | "wgsl" = "glsl" | "wgsl"> {
  code: string | null;
  ast: Program;
  diagnostics: Diagnostic[];
  target: Target;
}

/**
 * Formats an unknown caught value into a user-facing error message.
 *
 * @param err - The caught value (typically an Error).
 * @returns A string message suitable for diagnostics.
 */
function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Generic declaration registry. Replaces the previous pattern of ten
 * parallel Map variables with a single generic store keyed by declaration
 * kind and name. Adding a new declaration kind requires no changes here.
 */
class DeclarationRegistry {
  private maps = new Map<string, Map<string, unknown>>();

  private mapFor(kind: string): Map<string, unknown> {
    let m = this.maps.get(kind);
    if (!m) {
      m = new Map();
      this.maps.set(kind, m);
    }
    return m;
  }

  /** Returns true if a declaration of the given kind and key exists. */
  has(kind: string, key: string): boolean {
    return this.mapFor(kind).has(key);
  }

  /** Stores a declaration, returning true if it was newly added. */
  set<T extends { kind: string }>(decl: T, key: string): boolean {
    const m = this.mapFor(decl.kind);
    if (m.has(key)) return false;
    m.set(key, decl);
    return true;
  }

  /** Retrieves a declaration by kind and key. */
  get<T extends { kind: string }>(kind: string, key: string): T | undefined {
    return this.mapFor(kind).get(key) as T | undefined;
  }

  /** Returns all declarations of a given kind. */
  getAll(kind: string): unknown[] {
    const m = this.mapFor(kind);
    return Array.from(m.values());
  }
}

/**
 * Recursively collects declarations from a source file and its imports.
 *
 * Processes imports depth-first, then collects local declarations into
 * the generic registry. Top-level executable statements are appended to
 * allStatements.
 *
 * @param source - The gl source text.
 * @param file - The source file path (used for import resolution).
 * @param visited - Set of already-visited resolved paths (prevents cycles).
 * @param registry - Generic declaration registry.
 * @param allStatements - Array accumulating all top-level statements.
 * @param isMainFile - Whether this is the main entry file (affects main fn handling).
 */
function collectDeclarations(
  source: string,
  file: string,
  visited: Set<string>,
  registry: DeclarationRegistry,
  allStatements: Statement[],
  isMainFile: boolean,
): void {
  const resolvedPath = resolve(file);
  if (visited.has(resolvedPath)) return;
  visited.add(resolvedPath);

  const tokens = tokenize(source);
  const ast = parse(tokens);

  const importDecls: ImportDecl[] = [];
  const localStatements: Statement[] = [];

  for (const stmt of ast.statements) {
    if (stmt.kind === "ImportDecl") {
      importDecls.push(stmt);
    } else {
      localStatements.push(stmt);
    }
  }

  // Process imports first (depth-first)
  const baseDir = dirname(resolvedPath);
  for (const imp of importDecls) {
    const importPath = resolve(baseDir, imp.path);
    const importSource = readFileSync(importPath, "utf-8");
    collectDeclarations(
      importSource,
      importPath,
      visited,
      registry,
      allStatements,
      false
    );
  }

  // Collect local declarations
  for (const stmt of localStatements) {
    if (stmt.kind === "FnDecl") {
      // Skip main from non-main files
      if (!isMainFile && stmt.name === "main") continue;
      if (registry.set(stmt, stmt.name)) {
        allStatements.push(stmt);
      }
    } else if (
      stmt.kind === "StructDecl" ||
      stmt.kind === "BindingDecl" ||
      stmt.kind === "EnumDecl" ||
      stmt.kind === "TraitDecl" ||
      stmt.kind === "TypeAlias" ||
      stmt.kind === "NewtypeDecl" ||
      stmt.kind === "OpaqueDecl"
    ) {
      if (registry.set(stmt, stmt.name)) {
        allStatements.push(stmt);
      }
    } else if (stmt.kind === "ImplBlock") {
      const typeKey = stmt.type.kind === "struct" ? stmt.type.name : JSON.stringify(stmt.type);
      if (registry.set(stmt, typeKey)) {
        allStatements.push(stmt);
      }
    } else {
      // Top-level executable statements (VarDecl, ReturnStmt, etc.)
      allStatements.push(stmt);
    }
  }
}

/**
 * Compiles a pre-built Program AST to the target language.
 *
 * Skips parsing and import resolution; runs type checking and code
 * generation directly on the supplied AST.
 *
 * @param ast - The Program AST to compile.
 * @param file - The source file path (used for diagnostics).
 * @param target - The target language ("glsl" or "wgsl").
 * @returns CompileResult indexed by the target.
 */
function compileProgram<Target extends "glsl" | "wgsl">(
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
      switch (target) {
        case "glsl":
          code = generateGLSL(ast);
          break;
        case "wgsl":
          code = generateWGSL(ast);
          break;
        default:
          throw new Error(`Unknown target: ${target}`);
      }
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
 * Compiles a gl source file or pre-built AST to the target language.
 *
 * When `source` is given, performs import resolution, parsing, type
 * checking, and code generation in a single pipeline. When `ast` is
 * given, skips parsing and import resolution and runs type checking and
 * code generation directly on the supplied AST.
 *
 * @param options - Compilation options (target, file, and either `source` or `ast`).
 * @returns CompileResult indexed by the target.
 */
export function compile<Target extends "glsl" | "wgsl">(
  options: CompileOptions & { target: Target },
): CompileResult<Target> {
  const { target, file } = options;

  // AST-based path: skip parsing / imports
  if (options.ast) {
    return compileProgram(options.ast, file, target);
  }

  // Source-based path: parse + imports + typecheck + codegen
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

  const registry = new DeclarationRegistry();
  const allStatements: Statement[] = [];
  const visited = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  try {
    collectDeclarations(
      source,
      file,
      visited,
      registry,
      allStatements,
      true
    );
  } catch (err) {
    diagnostics.push({
      file,
      span: { line: 1, column: 1 },
      message: formatError(err),
    });
    return {
      code: null,
      ast: { kind: "Program", statements: [], span: { line: 1, column: 1 } },
      diagnostics,
      target,
    } as CompileResult<Target>;
  }

  const programAst: Program = {
    kind: "Program",
    statements: allStatements,
    span: { line: 1, column: 1 },
  };

  return compileProgram(programAst, file, target);
}

export { tokenize, parse, typeCheck, generateGLSL, generateWGSL };
