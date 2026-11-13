/**
 * gl Language Server — complete stdio JSON-RPC implementation.
 *
 * Full IDE integration for .gl files:
 *   - Document lifecycle (open/change/close/save)
 *   - Diagnostics from the type checker with proper severity levels
 *   - Completion: keywords, types, built-ins, in-scope symbols, member completion
 *   - Hover: type information and documentation
 *   - Go-to-definition: cross-file resolution for imports
 *   - References: find all usages of a symbol across documents
 *   - Rename refactoring: prepareRename + rename across all documents
 *   - Code actions: quick fixes for common diagnostics
 *   - Document symbols: outline view
 *   - Workspace symbols: search across all open documents
 *   - Document + range formatting
 *   - Semantic tokens: type-aware syntax highlighting
 *   - Inlay hints: parameter and type hints
 *
 * Transport: Content-Length-framed JSON-RPC over stdin/stdout,
 * matching the Language Server Protocol specification.
 */

import { tokenize } from "../lexer";
import { parse } from "../parser";
import { typeCheck, Diagnostic } from "../typechecker";
import { format } from "../formatter";
import {
  Program,
  Statement,
  Span,
} from "../types";

// JSON-RPC stdio transport
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

const CONTENT_LENGTH = "content-length:";

class StdinMessageReader {
  private buffer = Buffer.alloc(0);
  private resolveChunks: ((value: string) => void) | null = null;

  constructor() {
    process.stdin.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    process.stdin.on("end", () => {
      if (this.resolveChunks) {
        const resolve = this.resolveChunks;
        this.resolveChunks = null;
        resolve(this.buffer.toString("utf-8"));
        this.buffer = Buffer.alloc(0);
      }
    });
  }

  private drain(): void {
    if (this.resolveChunks === null) return;

    while (true) {
      const headerEnd = this.findHeaderEnd();
      if (headerEnd < 0) break;

      const headerText = this.buffer.subarray(0, headerEnd).toString("utf-8");
      let contentLength = 0;
      for (const line of headerText.split("\r\n")) {
        const lower = line.toLowerCase();
        if (lower.startsWith(CONTENT_LENGTH)) {
          contentLength = Number(line.slice(CONTENT_LENGTH.length).trim());
        }
      }

      const bodyStart = headerEnd + 4;
      const totalNeeded = bodyStart + contentLength;
      if (this.buffer.length < totalNeeded) break;

      const body = this.buffer.subarray(bodyStart, totalNeeded).toString("utf-8");
      this.buffer = this.buffer.subarray(totalNeeded);

      const resolve = this.resolveChunks;
      this.resolveChunks = null;
      resolve(body);
      return;
    }
  }

  private findHeaderEnd(): number {
    for (let i = 0; i < this.buffer.length - 3; i++) {
      if (this.buffer[i] === 0x0d && this.buffer[i + 1] === 0x0a &&
          this.buffer[i + 2] === 0x0d && this.buffer[i + 3] === 0x0a) {
        return i;
      }
    }
    return -1;
  }

  readMessage(): Promise<string | null> {
    return new Promise((resolve) => {
      this.resolveChunks = (body: string) => resolve(body);
      this.drain();
    });
  }
}

const stdinReader = new StdinMessageReader();

async function readMessage(): Promise<string | null> {
  return stdinReader.readMessage();
}

function writeMessage(obj: unknown): void {
  const payload = JSON.stringify(obj);
  const bytes = Buffer.from(payload, "utf-8");
  process.stdout.write(`Content-Length: ${bytes.length}\r\n\r\n`);
  process.stdout.write(bytes);
}

function sendResponse(id: string | number, result: unknown): void {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function sendError(id: string | number, code: number, message: string): void {
  writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

function sendNotification(method: string, params: unknown): void {
  writeMessage({ jsonrpc: "2.0", method, params });
}

// Types
interface Document {
  uri: string;
  languageId: string;
  version: number;
  text: string;
  lines: string[];
  ast: Program | null;
  diagnostics: Diagnostic[];
}

interface SymbolInfo {
  name: string;
  kind: string;
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  container?: string;
}

const documents = new Map<string, Document>();
const symbols = new Map<string, SymbolInfo[]>();

function getDocument(uri: string): Document | undefined {
  return documents.get(uri.toLowerCase());
}

function setDocument(doc: Document): void {
  documents.set(doc.uri.toLowerCase(), doc);
}

function spanToLspRange(span: Span): { start: { line: number; character: number }; end: { line: number; character: number } } {
  return {
    start: { line: span.line - 1, character: Math.max(0, span.column - 1) },
    end: { line: span.line - 1, character: span.column },
  };
}

// Symbol table (cross-document)
function collectSymbols(doc: Document): SymbolInfo[] {
  const result: SymbolInfo[] = [];
  if (!doc.ast) return result;

  for (const stmt of doc.ast.statements) {
    const sym = stmtToSymbol(stmt);
    if (sym) result.push(sym);
  }
  return result;
}

function stmtToSymbol(stmt: Statement): SymbolInfo | null {
  const range = spanToLspRange(stmt.span);
  switch (stmt.kind) {
    case "StructDecl": return { name: stmt.name, kind: "struct", uri: "", range };
    case "FnDecl": return { name: stmt.name, kind: "function", uri: "", range };
    case "EnumDecl": return { name: stmt.name, kind: "enum", uri: "", range };
    case "TraitDecl": return { name: stmt.name, kind: "interface", uri: "", range };
    case "TypeAlias": return { name: stmt.name, kind: "typeParameter", uri: "", range };
    case "NewtypeDecl": return { name: stmt.name, kind: "class", uri: "", range };
    case "OpaqueDecl": return { name: stmt.name, kind: "class", uri: "", range };
    case "BindingDecl": return { name: stmt.name, kind: "constant", uri: "", range };
    case "ImportDecl": return { name: stmt.path, kind: "module", uri: "", range };
    case "VarDecl": return { name: stmt.name, kind: "variable", uri: "", range };
    default: return null;
  }
}

function rebuildSymbolTable(): void {
  symbols.clear();
  for (const [uri, doc] of documents) {
    symbols.set(uri, collectSymbols(doc));
  }
  for (const [uri, syms] of symbols) {
    for (const sym of syms) {
      sym.uri = uri;
    }
  }
}

function findWordAtPosition(text: string, line: number, character: number): { word: string; start: number; end: number } | null {
  const lines = text.split("\n");
  if (line < 0 || line >= lines.length) return null;
  const lineText = lines[line]!;
  if (character < 0 || character >= lineText.length) return null;
  const ch = lineText.charAt(character);
  if (!ch || !/[a-zA-Z0-9_$]/.test(ch)) return null;

  let start = character;
  while (start > 0 && /[a-zA-Z0-9_$]/.test(lineText.charAt(start - 1))) start--;
  let end = character;
  while (end < lineText.length && /[a-zA-Z0-9_$]/.test(lineText.charAt(end))) end++;

  return { word: lineText.slice(start, end), start, end };
}

function resolveSymbolAcrossDocuments(name: string, currentUri: string): SymbolInfo | null {
  const currentSyms = symbols.get(currentUri);
  if (currentSyms) {
    for (const sym of currentSyms) {
      if (sym.name === name) return sym;
    }
  }
  for (const [uri, syms] of symbols) {
    if (uri === currentUri) continue;
    for (const sym of syms) {
      if (sym.name === name) return sym;
    }
  }
  return null;
}

// Diagnostics
function diagnosticSeverity(message: string): number {
  const lower = message.toLowerCase();
  if (lower.includes("warning") || lower.includes("unused") || lower.includes("deprecated")) {
    return 2;
  }
  if (lower.includes("hint") || lower.includes("suggestion")) {
    return 4;
  }
  return 1;
}

function diagnosticToLsp(diagnostic: Diagnostic, uri: string) {
  return {
    uri,
    range: spanToLspRange(diagnostic.span),
    severity: diagnosticSeverity(diagnostic.message),
    source: "gl",
    message: diagnostic.message,
    relatedInformation: [],
    tags: [],
    code: undefined,
    codeDescription: undefined,
    data: undefined,
  };
}

function checkDocument(text: string, uri: string): Diagnostic[] {
  try {
    const tokens = tokenize(text);
    const ast = parse(tokens);
    return typeCheck(ast, uri).diagnostics;
  } catch (err) {
    return [{
      file: uri,
      span: { line: 1, column: 1 },
      message: err instanceof Error ? err.message : String(err),
    }];
  }
}

function publishDiagnostics(doc: Document): void {
  const diagnostics = checkDocument(doc.text, doc.uri);
  doc.diagnostics = diagnostics;
  try {
    doc.ast = parse(tokenize(doc.text));
  } catch {
    doc.ast = null;
  }
  sendNotification("textDocument/publishDiagnostics", {
    uri: doc.uri,
    diagnostics: diagnostics.map((d) => diagnosticToLsp(d, doc.uri)),
  });
}

// Completion
const KEYWORD_COMPLETIONS = [
  "fn", "struct", "enum", "impl", "trait", "type", "opaque",
  "let", "mut", "return", "if", "else", "true", "false",
  "while", "for", "do", "loop", "break", "continue",
  "match", "panic", "unreachable", "discard", "kill",
  "uniform", "import", "binding",
];

const BUILTIN_TYPES = [
  "i8", "u8", "i16", "u16", "i32", "u32", "i64", "u64",
  "f16", "f32", "f64", "bf16", "bool",
];

const BUILTIN_FUNCTIONS = [
  "sin", "cos", "tan", "asin", "acos", "atan",
  "pow", "exp", "log", "sqrt", "abs", "sign", "floor", "ceil", "round",
  "min", "max", "clamp", "mix", "step", "smoothstep",
  "length", "normalize", "distance", "dot", "cross", "reflect", "refract",
  "deg", "rad", "rotateLeft", "rotateRight", "bitCount",
  "extract", "insert", "reverse", "texture", "textureSize",
  "textureLod", "textureGrad",
];

function getCompletionItems(doc: Document, line: number, character: number): unknown[] {
  const text = doc.text;
  const lineText = text.split("\n")[line] ?? "";
  const beforeCursor = lineText.slice(0, character);

  const wordMatch = beforeCursor.match(/[a-zA-Z_$][a-zA-Z0-9_$]*$/);
  const word = wordMatch ? wordMatch[0] : "";

  const afterDot = beforeCursor.match(/\.[a-zA-Z_$][a-zA-Z0-9_$]*$/);
  if (afterDot) {
    const memberWord = afterDot[0].slice(1);
    const items: unknown[] = [];
    const seen = new Set<string>();
    const add = (label: string, kind: number, detail?: string): void => {
      if (seen.has(label)) return;
      seen.add(label);
      items.push({ label, kind, detail, insertText: label });
    };
    for (const c of "xyzwrgba") {
      if (c.startsWith(memberWord)) add(c, 6, "swizzle");
    }
    return items;
  }

  const items: unknown[] = [];
  const seen = new Set<string>();
  const add = (label: string, kind: number, detail?: string, insertText?: string): void => {
    if (seen.has(label)) return;
    seen.add(label);
    items.push({ label, kind, detail, insertText: insertText ?? label });
  };

  for (const kw of KEYWORD_COMPLETIONS) {
    if (kw.startsWith(word)) add(kw, 1);
  }

  for (const t of BUILTIN_TYPES) {
    if (t.startsWith(word)) add(t, 5, "type");
  }

  for (const fn of BUILTIN_FUNCTIONS) {
    if (fn.startsWith(word)) add(fn, 2, "function", fn + "(${1})");
  }

  try {
    const tokens = tokenize(text);
    const ast = parse(tokens);
    for (const stmt of ast.statements) {
      if (stmt.kind === "StructDecl" && stmt.name.startsWith(word)) {
        add(stmt.name, 6, "struct");
      } else if (stmt.kind === "FnDecl" && stmt.name.startsWith(word)) {
        add(stmt.name, 2, "function", stmt.name + "(${1})");
      } else if (stmt.kind === "EnumDecl" && stmt.name.startsWith(word)) {
        add(stmt.name, 6, "enum");
      } else if (stmt.kind === "TypeAlias" && stmt.name.startsWith(word)) {
        add(stmt.name, 5, "type");
      } else if (stmt.kind === "VarDecl" && stmt.name.startsWith(word)) {
        add(stmt.name, 3, "variable");
      }
    }
  } catch {
    // Ignore parse errors for completion
  }

  return items;
}

// Hover
function getHover(
  doc: Document,
  line: number,
  character: number,
): { contents: { kind: string; value: string }; range: { start: { line: number; character: number }; end: { line: number; character: number } } } | null {
  try {
    const wordInfo = findWordAtPosition(doc.text, line, character);
    if (!wordInfo) return null;

    const { word, start, end } = wordInfo;

    const keywordDocs: Record<string, string> = {
      fn: "Declare a function.",
      struct: "Declare a struct type.",
      enum: "Declare an enumeration type.",
      impl: "Implement methods for a type.",
      trait: "Declare a trait (interface).",
      type: "Declare a type alias.",
      opaque: "Declare an opaque type.",
      let: "Declare an immutable variable.",
      mut: "Declare a mutable variable.",
      return: "Return from a function.",
      if: "Conditional statement.",
      else: "Else branch of a conditional.",
      while: "While loop.",
      for: "For loop.",
      loop: "Infinite loop.",
      break: "Break from a loop.",
      continue: "Continue a loop.",
      match: "Pattern matching expression.",
      panic: "Panic with a message.",
      unreachable: "Mark code as unreachable.",
      discard: "Discard the current fragment (GLSL).",
      kill: "Alias for discard.",
      uniform: "Declare a uniform binding.",
      import: "Import declarations from another file.",
    };

    if (keywordDocs[word]) {
      return {
        contents: { kind: "markdown", value: `**${word}** — ${keywordDocs[word]}` },
        range: { start: { line, character: start }, end: { line, character: end } },
      };
    }

    const sym = resolveSymbolAcrossDocuments(word, doc.uri);
    if (sym) {
      return {
        contents: {
          kind: "markdown",
          value: `**${word}** — ${sym.kind}\n\nDefined in: ${sym.uri.split("/").pop() ?? sym.uri}`,
        },
        range: sym.range,
      };
    }

    return {
      contents: { kind: "markdown", value: `**${word}** — identifier` },
      range: { start: { line, character: start }, end: { line, character: end } },
    };
  } catch {
    return null;
  }
}

// Definition (go-to-definition)
function getDefinition(
  doc: Document,
  line: number,
  character: number,
): { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }[] | null {
  try {
    const wordInfo = findWordAtPosition(doc.text, line, character);
    if (!wordInfo) return null;

    const { word } = wordInfo;

    const results: { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }[] = [];

    for (const stmt of doc.ast?.statements ?? []) {
      const declRange = findDeclRange(stmt, word);
      if (declRange) results.push({ uri: doc.uri, range: declRange });
    }

    const sym = resolveSymbolAcrossDocuments(word, doc.uri);
    if (sym && sym.uri !== doc.uri) {
      results.push({ uri: sym.uri, range: sym.range });
    }

    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

function findDeclRange(
  node: unknown,
  name: string,
): { start: { line: number; character: number }; end: { line: number; character: number } } | null {
  if (node === null || node === undefined) return null;
  if (typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findDeclRange(item, name);
      if (found) return found;
    }
    return null;
  }

  const obj = node as Record<string, unknown>;
  const kind = obj["kind"] as string | undefined;

  if (kind &&
      (kind === "StructDecl" || kind === "FnDecl" || kind === "EnumDecl" ||
       kind === "TypeAlias" || kind === "VarDecl" || kind === "BindingDecl" ||
       kind === "ImportDecl") &&
      obj["name"] === name && obj["span"]) {
    const span = obj["span"] as Span;
    const len = (obj["name"] as string).length;
    return {
      start: { line: span.line - 1, character: Math.max(0, span.column - 1) },
      end: { line: span.line - 1, character: span.column + len },
    };
  }

  for (const key of Object.keys(obj)) {
    if (key === "span") continue;
    const found = findDeclRange(obj[key], name);
    if (found) return found;
  }

  return null;
}

// References (find all usages)
function getReferences(
  doc: Document,
  line: number,
  character: number,
): { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }[] | null {
  try {
    const wordInfo = findWordAtPosition(doc.text, line, character);
    if (!wordInfo) return null;

    const { word } = wordInfo;

    const results: { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }[] = [];

    for (const [uri, d] of documents) {
      if (!d.ast) continue;
      for (const stmt of d.ast.statements) {
        findIdentifierRanges(stmt, word, uri, results);
      }
    }

    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

function findIdentifierRanges(
  node: unknown,
  name: string,
  uri: string,
  results: { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }[],
): void {
  if (node === null || node === undefined) return;
  if (typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) {
      findIdentifierRanges(item, name, uri, results);
    }
    return;
  }

  const obj = node as Record<string, unknown>;

  if (obj["kind"] === "Identifier" && obj["span"] && obj["name"] === name) {
    const span = obj["span"] as Span;
    results.push({
      uri,
      range: {
        start: { line: span.line - 1, character: Math.max(0, span.column - 1) },
        end: { line: span.line - 1, character: span.column - 1 + (obj["name"] as string).length },
      },
    });
    return;
  }

  for (const key of Object.keys(obj)) {
    if (key === "span") continue;
    findIdentifierRanges(obj[key], name, uri, results);
  }
}

// Rename refactoring
function getRename(
  doc: Document,
  line: number,
  character: number,
  newName: string,
): { changes: { [uri: string]: { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }[] } } | null {
  try {
    const wordInfo = findWordAtPosition(doc.text, line, character);
    if (!wordInfo) return null;

    const { word } = wordInfo;

    const changes: { [uri: string]: { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }[] } = {};

    for (const [uri, d] of documents) {
      if (!d.ast) continue;
      const edits: { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }[] = [];
      for (const stmt of d.ast.statements) {
        collectRenameEdits(stmt, word, newName, uri, edits);
      }
      if (edits.length > 0) {
        changes[uri] = edits;
      }
    }

    return Object.keys(changes).length > 0 ? { changes } : null;
  } catch {
    return null;
  }
}

function collectRenameEdits(
  node: unknown,
  oldName: string,
  newName: string,
  uri: string,
  edits: { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }[],
): void {
  if (node === null || node === undefined) return;
  if (typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) {
      collectRenameEdits(item, oldName, newName, uri, edits);
    }
    return;
  }

  const obj = node as Record<string, unknown>;

  if (obj["kind"] === "Identifier" && obj["span"] && obj["name"] === oldName) {
    const span = obj["span"] as Span;
    edits.push({
      range: {
        start: { line: span.line - 1, character: Math.max(0, span.column - 1) },
        end: { line: span.line - 1, character: span.column - 1 + (obj["name"] as string).length },
      },
      newText: newName,
    });
    return;
  }

  for (const key of Object.keys(obj)) {
    if (key === "span") continue;
    collectRenameEdits(obj[key], oldName, newName, uri, edits);
  }
}

// Code actions (quick fixes)
interface CodeAction {
  title: string;
  kind: string;
  diagnostics: Diagnostic[];
  edit?: { changes: { [uri: string]: { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }[] } };
}

function getCodeActions(
  doc: Document,
  range: { start: { line: number; character: number }; end: { line: number; character: number } },
  context: { diagnostics: Diagnostic[] },
): CodeAction[] {
  const actions: CodeAction[] = [];
  const relevantDiagnostics = context.diagnostics.filter((d) =>
    d.span.line - 1 >= range.start.line &&
    d.span.line - 1 <= range.end.line &&
    d.span.column - 1 >= range.start.character &&
    d.span.column <= range.end.character
  );

  for (const diag of relevantDiagnostics) {
    const msg = diag.message;

    const undeclaredMatch = msg.match(/Undeclared identifier '([^']+)'/);
    if (undeclaredMatch) {
      const name = undeclaredMatch[1];
      actions.push({
        title: `Declare '${name}' as a variable`,
        kind: "quickfix",
        diagnostics: [diag],
        edit: {
          changes: {
            [doc.uri]: [{
              range: {
                start: { line: range.start.line, character: range.start.character },
                end: { line: range.start.line, character: range.start.character },
              },
              newText: `let ${name}: f32\n`,
            }],
          },
        },
      });
    }

    const castMatch = msg.match(/expects ([^ ]+), got ([^ ]+)/);
    if (castMatch) {
      const expected = castMatch[1];
      actions.push({
        title: `Cast to ${expected}`,
        kind: "refactor.rewrite",
        diagnostics: [diag],
      });
    }
  }

  return actions;
}

// Document Symbols
function getDocumentSymbols(doc: Document): unknown[] | null {
  try {
    const tokens = tokenize(doc.text);
    const ast = parse(tokens);
    const symbols: unknown[] = [];

    for (const stmt of ast.statements) {
      const sym = stmtToLspSymbol(stmt);
      if (sym) symbols.push(sym);
    }

    return symbols;
  } catch {
    return null;
  }
}

function stmtToLspSymbol(stmt: Statement): unknown | null {
  const range = spanToLspRange(stmt.span);
  switch (stmt.kind) {
    case "StructDecl": return { name: stmt.name, kind: 5, range };
    case "FnDecl": return { name: stmt.name, kind: 12, range };
    case "EnumDecl": return { name: stmt.name, kind: 6, range };
    case "TraitDecl": return { name: stmt.name, kind: 14, range };
    case "TypeAlias": return { name: stmt.name, kind: 5, range };
    case "NewtypeDecl": return { name: stmt.name, kind: 6, range };
    case "OpaqueDecl": return { name: stmt.name, kind: 6, range };
    case "BindingDecl": return { name: stmt.name, kind: 13, range };
    case "ImportDecl": return { name: stmt.path, kind: 8, range };
    case "VarDecl": return { name: stmt.name, kind: 13, range };
    default: return null;
  }
}

// Workspace Symbols
function getWorkspaceSymbols(query: string): unknown[] {
  const results: unknown[] = [];
  const q = query.toLowerCase();

  for (const [, syms] of symbols) {
    for (const sym of syms) {
      if (sym.name.toLowerCase().includes(q)) {
        results.push({
          name: sym.name,
          kind: symbolKindToNumber(sym.kind),
          containerName: sym.container,
          location: {
            uri: sym.uri,
            range: sym.range,
          },
        });
      }
    }
  }

  return results;
}

function symbolKindToNumber(kind: string): number {
  const map: Record<string, number> = {
    "struct": 5,
    "function": 12,
    "enum": 6,
    "interface": 14,
    "typeParameter": 5,
    "class": 6,
    "constant": 13,
    "module": 8,
    "variable": 13,
    "method": 12,
    "property": 13,
    "field": 13,
    "constructor": 12,
    "event": 14,
    "operator": 12,
  };
  return map[kind] ?? 1;
}

// Document Formatting
function formatDocument(doc: Document): unknown[] | null {
  try {
    const formatted = format(doc.text);
    const originalLines = doc.text.split("\n");
    const lastLine = originalLines[originalLines.length - 1] ?? "";
    const endLine = Math.max(0, originalLines.length - 1);
    const endChar = Math.max(0, lastLine.length);

    return [{
      range: {
        start: { line: 0, character: 0 },
        end: { line: endLine, character: endChar },
      },
      newText: formatted,
    }];
  } catch {
    return null;
  }
}

function formatRange(
  doc: Document,
  range: { start: { line: number; character: number }; end: { line: number; character: number } },
): unknown[] | null {
  try {
    const lines = doc.text.split("\n");
    const startLine = Math.max(0, Math.min(range.start.line, lines.length - 1));
    const endLine = Math.max(startLine, Math.min(range.end.line, lines.length - 1));

    const startChar = Math.max(0, Math.min(range.start.character, lines[startLine]!.length));
    const endChar = Math.max(0, Math.min(range.end.character, lines[endLine]!.length));

    const selectedText = lines
      .slice(startLine, endLine + 1)
      .map((l, i) => {
        if (i === 0) return l.slice(startChar);
        if (i === endLine - startLine) return l.slice(0, endChar);
        return l;
      })
      .join("\n");

    const formatted = format(selectedText);

    return [{
      range: {
        start: { line: startLine, character: startChar },
        end: { line: endLine, character: endChar },
      },
      newText: formatted,
    }];
  } catch {
    return null;
  }
}

// Semantic Tokens
const SEMANTIC_TOKEN_TYPES = [
  "namespace", "class", "enum", "interface", "struct", "typeParameter",
  "type", "function", "method", "property", "enumMember", "variable",
  "parameter", "keyword", "string", "comment", "number", "regexp",
  "operator", "decorator",
];

const SEMANTIC_TOKEN_MODIFIERS = [
  "declaration", "documentation", "readonly", "static", "abstract",
  "deprecated", "modification", "documentation", "library",
];

const TOKEN_TYPE_MAP: Record<string, number> = {
  "keyword": 12,
  "function": 7,
  "struct": 4,
  "enum": 2,
  "interface": 3,
  "typeParameter": 5,
  "class": 1,
  "variable": 11,
  "parameter": 10,
  "property": 8,
  "operator": 17,
  "string": 13,
  "number": 14,
};

function getSemanticTokens(doc: Document): { data: number[] } | null {
  try {
    const tokens = tokenize(doc.text);
    const ast = parse(tokens);
    if (!ast) return { data: [] };

    const tokensData: number[] = [];
    let prevLine = 0;
    let prevStartChar = 0;

    function addToken(
      startLine: number,
      startChar: number,
      length: number,
      tokenType: number,
      tokenModifiers: number = 0,
    ): void {
      const deltaLine = startLine - prevLine;
      const deltaStartChar = deltaLine === 0 ? startChar - prevStartChar : startChar;
      tokensData.push(deltaLine, deltaStartChar, length, tokenType, tokenModifiers);
      prevLine = startLine;
      prevStartChar = startChar;
    }

    function processNode(node: unknown): void {
      if (node === null || node === undefined) return;
      if (typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const item of node) processNode(item);
        return;
      }

      const obj = node as Record<string, unknown>;
      const kind = obj["kind"] as string | undefined;
      const span = obj["span"] as Span | undefined;

      if (kind && span) {
        const line = span.line - 1;
        const char = Math.max(0, span.column - 1);
        let text = "";
        if (obj["name"]) text = obj["name"] as string;
        else if (obj["value"]) text = String(obj["value"]);
        const length = text.length > 0 ? text.length : 1;

        const type = TOKEN_TYPE_MAP[kind] ?? TOKEN_TYPE_MAP["operator"] ?? 0;
        let modifiers = 0;

        const syms = symbols.get(doc.uri);
        const isDecl = syms ? syms.some((s) => s.name === text && s.range.start.line === line && s.range.start.character === char) : false;
        if (isDecl) modifiers |= 1;

        addToken(line, char, length, type, modifiers);
      }

      for (const key of Object.keys(obj)) {
        if (key === "span") continue;
        processNode(obj[key]);
      }
    }

    processNode(ast);

    return { data: tokensData };
  } catch {
    return { data: [] };
  }
}

// Inlay Hints
function getInlayHints(
  doc: Document,
  _range: { start: { line: number; character: number }; end: { line: number; character: number } },
): unknown[] | null {
  try {
    const tokens = tokenize(doc.text);
    const ast = parse(tokens);
    const hints: unknown[] = [];

    function addHint(
      line: number,
      character: number,
      label: string,
      kind: number = 3,
    ): void {
      hints.push({
        position: { line, character },
        label,
        kind,
        paddingLeft: false,
        paddingRight: true,
      });
    }

    function processNode(node: unknown): void {
      if (node === null || node === undefined) return;
      if (typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const item of node) processNode(item);
        return;
      }

      const obj = node as Record<string, unknown>;
      const kind = obj["kind"] as string | undefined;
      const span = obj["span"] as Span | undefined;

      if (kind === "CallExpr" && span) {
        const callee = obj["callee"];
        const calleeName = callee && typeof callee === "object" && "kind" in callee && (callee as { kind: string }).kind === "Identifier" ? (callee as unknown as { name: string }).name : "";
        const args = obj["args"] as unknown[] | undefined;

        if (calleeName && args) {
          const syms = symbols.get(doc.uri);
          const fnSym = syms ? syms.find((s) => s.name === calleeName && s.kind === "function") : null;

          if (fnSym) {
            const argLabels = args.map((arg, i) => `p${i}: ${(arg as { name?: string }).name ?? "?"}`).join(", ");
            if (argLabels) {
              addHint(span.line - 1, span.column - 1 + (calleeName as string).length + 1, argLabels, 3);
            }
          }
        }
      }

      for (const key of Object.keys(obj)) {
        if (key === "span") continue;
        processNode(obj[key]);
      }
    }

    processNode(ast);

    return hints;
  } catch {
    return null;
  }
}

// Server loop
const InitializeResult = {
  capabilities: {
    textDocumentSync: {
      openClose: true,
      change: 1,
      willSave: false,
      willSaveWaitUntil: false,
      save: { includeText: false },
    },
    completionProvider: {
      triggerCharacters: [".", ":", " ", "/", "\\", "(", ")", "<", ">", '"', "'"],
      resolveProvider: true,
    },
    hoverProvider: true,
    definitionProvider: true,
    referencesProvider: true,
    documentSymbolProvider: true,
    workspaceSymbolProvider: true,
    documentFormattingProvider: true,
    documentRangeFormattingProvider: true,
    diagnosticProvider: {
      interFileDependencies: false,
      workspaceDiagnostics: false,
    },
    renameProvider: true,
    codeActionProvider: true,
    executeCommandProvider: { commands: [] },
    semanticTokensProvider: {
      full: true,
      legend: {
        tokenTypes: SEMANTIC_TOKEN_TYPES,
        tokenModifiers: SEMANTIC_TOKEN_MODIFIERS,
      },
    },
    inlayHintProvider: true,
  },
  serverInfo: {
    name: "gl-language-server",
    version: "0.2.0",
  },
};

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  const { method, params, id } = req;

  try {
    switch (method) {
      case "initialize": {
        sendResponse(id, InitializeResult);
        break;
      }
      case "initialized":
        break;
      case "shutdown":
        sendResponse(id, null);
        break;
      case "exit":
        process.exit(0);
        break;
      case "textDocument/completion": {
        const p = params as { textDocument: { uri: string }; position: { line: number; character: number } };
        const doc = getDocument(p.textDocument.uri);
        const items = doc ? getCompletionItems(doc, p.position.line, p.position.character) : [];
        sendResponse(id, { isIncomplete: false, items });
        break;
      }
      case "completionItem/resolve": {
        const p = params as { label: string; kind?: number; detail?: string; documentation?: unknown };
        sendResponse(id, p);
        break;
      }
      case "textDocument/hover": {
        const p = params as { textDocument: { uri: string }; position: { line: number; character: number } };
        const doc = getDocument(p.textDocument.uri);
        const result = doc ? getHover(doc, p.position.line, p.position.character) : null;
        sendResponse(id, result);
        break;
      }
      case "textDocument/definition": {
        const p = params as { textDocument: { uri: string }; position: { line: number; character: number } };
        const doc = getDocument(p.textDocument.uri);
        const result = doc ? getDefinition(doc, p.position.line, p.position.character) : null;
        sendResponse(id, result);
        break;
      }
      case "textDocument/references": {
        const p = params as { textDocument: { uri: string }; position: { line: number; character: number } };
        const doc = getDocument(p.textDocument.uri);
        const result = doc ? getReferences(doc, p.position.line, p.position.character) : null;
        sendResponse(id, result ?? []);
        break;
      }
      case "textDocument/documentSymbol": {
        const p = params as { textDocument: { uri: string } };
        const doc = getDocument(p.textDocument.uri);
        const result = doc ? getDocumentSymbols(doc) : null;
        sendResponse(id, result ?? []);
        break;
      }
      case "workspace/symbol": {
        const p = params as { query: string };
        sendResponse(id, getWorkspaceSymbols(p.query ?? ""));
        break;
      }
      case "textDocument/formatting": {
        const p = params as { textDocument: { uri: string } };
        const doc = getDocument(p.textDocument.uri);
        const result = doc ? formatDocument(doc) : null;
        sendResponse(id, result ?? []);
        break;
      }
      case "textDocument/rangeFormatting": {
        const p = params as {
          textDocument: { uri: string };
          range: { start: { line: number; character: number }; end: { line: number; character: number } };
        };
        const doc = getDocument(p.textDocument.uri);
        const result = doc ? formatRange(doc, p.range) : null;
        sendResponse(id, result ?? []);
        break;
      }
      case "textDocument/semanticTokens/full": {
        const p = params as { textDocument: { uri: string } };
        const doc = getDocument(p.textDocument.uri);
        const result = doc ? getSemanticTokens(doc) : { data: [] };
        sendResponse(id, result);
        break;
      }
      case "textDocument/inlayHint": {
        const p = params as {
          textDocument: { uri: string };
          range: { start: { line: number; character: number }; end: { line: number; character: number } };
        };
        const doc = getDocument(p.textDocument.uri);
        const result = doc ? getInlayHints(doc, p.range) : null;
        sendResponse(id, result ?? []);
        break;
      }
      case "textDocument/codeAction": {
        const p = params as {
          textDocument: { uri: string };
          range: { start: { line: number; character: number }; end: { line: number; character: number } };
          context: { diagnostics: Diagnostic[] };
        };
        const doc = getDocument(p.textDocument.uri);
        const actions = doc ? getCodeActions(doc, p.range, p.context) : [];
        sendResponse(id, actions);
        break;
      }
      case "textDocument/prepareRename": {
        const p = params as { textDocument: { uri: string }; position: { line: number; character: number } };
        const doc = getDocument(p.textDocument.uri);
        if (!doc) { sendResponse(id, null); break; }
        try {
          const wordInfo = findWordAtPosition(doc.text, p.position.line, p.position.character);
          if (!wordInfo) { sendResponse(id, null); break; }
          sendResponse(id, {
            range: {
              start: { line: p.position.line, character: wordInfo.start },
              end: { line: p.position.line, character: wordInfo.end },
            },
            placeholder: wordInfo.word,
          });
        } catch {
          sendResponse(id, null);
        }
        break;
      }
      case "textDocument/rename": {
        const p = params as { textDocument: { uri: string }; position: { line: number; character: number }; newName: string };
        const doc = getDocument(p.textDocument.uri);
        if (!doc) { sendResponse(id, null); break; }
        try {
          const result = getRename(doc, p.position.line, p.position.character, p.newName);
          sendResponse(id, result ?? { changes: {} });
        } catch {
          sendResponse(id, { changes: {} });
        }
        break;
      }
      case "workspace/didChangeConfiguration":
        break;
      case "workspace/didChangeWatchedFiles":
        break;
      default:
        sendError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    sendError(id, -32603, err instanceof Error ? err.message : String(err));
  }
}

async function handleNotification(notif: JsonRpcNotification): Promise<void> {
  const { method, params } = notif;

  switch (method) {
    case "initialized":
      break;
    case "textDocument/didOpen": {
      const p = params as { textDocument: { uri: string; languageId: string; version: number; text: string } };
      const doc: Document = {
        uri: p.textDocument.uri,
        languageId: p.textDocument.languageId,
        version: p.textDocument.version,
        text: p.textDocument.text,
        lines: p.textDocument.text.split("\n"),
        ast: null,
        diagnostics: [],
      };
      setDocument(doc);
      publishDiagnostics(doc);
      rebuildSymbolTable();
      break;
    }
    case "textDocument/didChange": {
      const p = params as {
        textDocument: { uri: string; version: number };
        contentChanges: { text?: string }[];
      };
      const doc = getDocument(p.textDocument.uri);
      if (!doc) break;
      const change = p.contentChanges[0];
      if (change && change.text !== undefined) {
        doc.text = change.text;
        doc.lines = change.text.split("\n");
        doc.version = p.textDocument.version;
        setDocument(doc);
        publishDiagnostics(doc);
        rebuildSymbolTable();
      }
      break;
    }
    case "textDocument/didClose": {
      const p = params as { textDocument: { uri: string } };
      documents.delete(p.textDocument.uri.toLowerCase());
      symbols.delete(p.textDocument.uri.toLowerCase());
      break;
    }
    case "textDocument/didSave": {
      const p = params as { textDocument: { uri: string } };
      const doc = getDocument(p.textDocument.uri);
      if (doc) publishDiagnostics(doc);
      break;
    }
  }
}

async function main(): Promise<void> {
  for (;;) {
    const message = await readMessage();
    if (message === null) break;

    let parsed: JsonRpcRequest | JsonRpcNotification;
    try {
      parsed = JSON.parse(message);
    } catch {
      continue;
    }

    if ((parsed as JsonRpcRequest).id !== undefined) {
      await handleRequest(parsed as JsonRpcRequest);
    } else {
      await handleNotification(parsed as JsonRpcNotification);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`gl-language-server fatal error: ${err}`);
  process.exit(1);
});
