import { tokenize } from "./lexer";
import { parse } from "./parser";
import { typeCheck } from "./typechecker";
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
import { Diagnostic } from "./typechecker";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";

/**
 * Options for compiling a gl source file.
 */
export interface CompileOptions {
  target: "glsl" | "wgsl";
  source: string;
  file: string;
}

/**
 * Result of compiling a gl source file.
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
 * Compiles a gl source file to the target language.
 *
 * Performs import resolution, parsing, type checking, and code generation
 * in a single pipeline.
 *
 * @param options - Compilation options (target, source, file path).
 * @returns CompileResult containing generated code (or null on error), the AST, and diagnostics.
 */
export function compile(options: CompileOptions): CompileResult {
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
      options.source,
      options.file,
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
      file: options.file,
      span: { line: 1, column: 1 },
      message: formatError(err),
    });
    return { code: null, ast: { kind: "Program", statements: [], span: { line: 1, column: 1 } }, diagnostics };
  }

  const ast: Program = { kind: "Program", statements: allStatements, span: { line: 1, column: 1 } };

  try {
    const typeResult = typeCheck(ast, options.file);
    diagnostics.push(...typeResult.diagnostics);
  } catch (err) {
    diagnostics.push({
      file: options.file,
      span: { line: 1, column: 1 },
      message: formatError(err),
    });
    return { code: null, ast, diagnostics };
  }

  const hasErrors = diagnostics.length > 0;

  let code: string | null = null;
  if (!hasErrors) {
    try {
      switch (options.target) {
        case "glsl":
          code = generateGLSL(ast);
          break;
        case "wgsl":
          code = generateWGSL(ast);
          break;
        default:
          throw new Error(`Unknown target: ${options.target}`);
      }
    } catch (err) {
      diagnostics.push({
        file: options.file,
        span: { line: 1, column: 1 },
        message: formatError(err),
      });
      return { code: null, ast, diagnostics };
    }
  }

  return { code, ast, diagnostics };
}

export { tokenize, parse, typeCheck, generateGLSL, generateWGSL };
