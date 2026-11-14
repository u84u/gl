import {
  ImportDecl,
  Statement,
} from "../types";
import { tokenize } from "../lexer";
import { parse } from "../parser";
import { DeclarationRegistry as ModuleRegistry } from "./registry";
import { SourceModule, SourceResolver } from "./resolver";

export interface ModuleGraphOptions {
  source: string;
  sourceId: string;
  isMainFile: boolean;
  resolver: SourceResolver;
}

export interface CollectedProgram {
  statements: Statement[];
  registry: ModuleRegistry;
}

async function collectFromSource(
  source: string,
  sourceId: string,
  visited: Set<string>,
  registry: ModuleRegistry,
  allStatements: Statement[],
  isMainFile: boolean,
  resolver: SourceResolver,
): Promise<void> {
  if (visited.has(sourceId)) return;
  visited.add(sourceId);

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
  for (const imp of importDecls) {
    const importer: SourceModule = {
      id: sourceId,
      displayName: sourceId,
      source,
    };
    const imported = await resolver.resolve(imp.path, importer);
    await collectFromSource(
      imported.source,
      imported.id,
      visited,
      registry,
      allStatements,
      false,
      resolver,
    );
  }

  // Collect local declarations
  for (const stmt of localStatements) {
    if (stmt.kind === "FnDecl") {
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
      const typeKey =
        stmt.type.kind === "struct" ? stmt.type.name : JSON.stringify(stmt.type);
      if (registry.set(stmt, typeKey)) {
        allStatements.push(stmt);
      }
    } else {
      // Top-level executable statements (VarDecl, ReturnStmt, etc.)
      allStatements.push(stmt);
    }
  }
}

export async function collectModuleGraph(
  options: ModuleGraphOptions,
): Promise<CollectedProgram> {
  const { source, sourceId, isMainFile, resolver } = options;
  const registry = new ModuleRegistry();
  const allStatements: Statement[] = [];
  const visited = new Set<string>();

  await collectFromSource(
    source,
    sourceId,
    visited,
    registry,
    allStatements,
    isMainFile,
    resolver,
  );

  return { statements: allStatements, registry };
}
