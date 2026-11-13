import { tokenize } from "./lexer";
import { parse } from "./parser";
import { typeCheck, Diagnostic } from "./typechecker";
import { generateGLSL } from "./codegen/glsl";
import { generateWGSL } from "./codegen/wgsl";
import {
  Program,
  Statement,
  ImportDecl,
  StructDecl,
  FnDecl,
  BindingDecl,
  EnumDecl,
  ImplBlock,
  TraitDecl,
  TypeAlias,
  NewtypeDecl,
  OpaqueDecl,
} from "./types";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";

/* ------------------------------------------------------------------ */
/* AST builders                                                         */
/* ------------------------------------------------------------------ */

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
  ident, int, float, bool as boolLiteral, binary, unary, call, member,
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
 * Result of compiling a gl source file or AST.
 */
export interface CompileResult {
  code: string | null;
  ast: Program;
  diagnostics: Diagnostic[];
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
 * Recursively collects declarations from a source file and its imports.
 *
 * Processes imports depth-first, then collects local struct, function, and
 * binding declarations into the provided maps. Top-level executable
 * statements are appended to allStatements.
 *
 * @param source - The gl source text.
 * @param file - The source file path (used for import resolution).
 * @param visited - Set of already-visited resolved paths (prevents cycles).
 * @param structs - Map accumulating struct declarations.
 * @param functions - Map accumulating function declarations.
 * @param bindings - Map accumulating binding declarations.
 * @param allStatements - Array accumulating all top-level statements.
 * @param isMainFile - Whether this is the main entry file (affects main fn handling).
 */
function collectDeclarations(
  source: string,
  file: string,
  visited: Set<string>,
  structs: Map<string, StructDecl>,
  functions: Map<string, FnDecl>,
  bindings: Map<string, BindingDecl>,
  enums: Map<string, EnumDecl>,
  impls: Map<string, ImplBlock>,
  traits: Map<string, TraitDecl>,
  aliases: Map<string, TypeAlias>,
  newtypes: Map<string, NewtypeDecl>,
  opaques: Map<string, OpaqueDecl>,
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
      structs,
      functions,
      bindings,
      enums,
      impls,
      traits,
      aliases,
      newtypes,
      opaques,
      allStatements,
      false
    );
  }

  // Collect local declarations
  for (const stmt of localStatements) {
    if (stmt.kind === "StructDecl") {
      if (!structs.has(stmt.name)) {
        structs.set(stmt.name, stmt);
        allStatements.push(stmt);
      }
    } else if (stmt.kind === "FnDecl") {
      // Skip main from non-main files
      if (!isMainFile && stmt.name === "main") continue;
      if (!functions.has(stmt.name)) {
        functions.set(stmt.name, stmt);
        allStatements.push(stmt);
      }
    } else if (stmt.kind === "BindingDecl") {
      if (!bindings.has(stmt.name)) {
        bindings.set(stmt.name, stmt);
        allStatements.push(stmt);
      }
    } else if (stmt.kind === "EnumDecl") {
      if (!enums.has(stmt.name)) {
        enums.set(stmt.name, stmt);
        allStatements.push(stmt);
      }
    } else if (stmt.kind === "ImplBlock") {
      const typeKey = stmt.type.kind === "struct" ? stmt.type.name : JSON.stringify(stmt.type);
      if (!impls.has(typeKey)) {
        impls.set(typeKey, stmt);
        allStatements.push(stmt);
      }
    } else if (stmt.kind === "TraitDecl") {
      if (!traits.has(stmt.name)) {
        traits.set(stmt.name, stmt);
        allStatements.push(stmt);
      }
    } else if (stmt.kind === "TypeAlias") {
      if (!aliases.has(stmt.name)) {
        aliases.set(stmt.name, stmt);
        allStatements.push(stmt);
      }
    } else if (stmt.kind === "NewtypeDecl") {
      if (!newtypes.has(stmt.name)) {
        newtypes.set(stmt.name, stmt);
        allStatements.push(stmt);
      }
    } else if (stmt.kind === "OpaqueDecl") {
      if (!opaques.has(stmt.name)) {
        opaques.set(stmt.name, stmt);
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
 * @returns CompileResult containing generated code (or null on error), the AST, and diagnostics.
 */
function compileProgram(
  ast: Program,
  file: string,
  target: "glsl" | "wgsl",
): CompileResult {
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
    return { code: null, ast, diagnostics };
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
      return { code: null, ast, diagnostics };
    }
  }

  return { code, ast, diagnostics };
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
 * @returns CompileResult containing generated code (or null on error), the AST, and diagnostics.
 */
export function compile(options: CompileOptions): CompileResult {
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
    };
  }

  const structs = new Map<string, StructDecl>();
  const functions = new Map<string, FnDecl>();
  const bindings = new Map<string, BindingDecl>();
  const enums = new Map<string, EnumDecl>();
  const impls = new Map<string, ImplBlock>();
  const traits = new Map<string, TraitDecl>();
  const aliases = new Map<string, TypeAlias>();
  const newtypes = new Map<string, NewtypeDecl>();
  const opaques = new Map<string, OpaqueDecl>();
  const allStatements: Statement[] = [];
  const visited = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  try {
    collectDeclarations(
      source,
      file,
      visited,
      structs,
      functions,
      bindings,
      enums,
      impls,
      traits,
      aliases,
      newtypes,
      opaques,
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
    };
  }

  const ast: Program = {
    kind: "Program",
    statements: allStatements,
    span: { line: 1, column: 1 },
  };

  return compileProgram(ast, file, target);
}

export { tokenize, parse, typeCheck, generateGLSL, generateWGSL };
