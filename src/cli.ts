import { compile } from "./index";
import { format } from "./formatter";
import { version } from "../package.json";

/**
 * CLI entry point for the gl shader compiler.
 * Parses command-line arguments and drives compile/format/check operations.
 */
const args = process.argv.slice(2);
let inputFile = "";
let target: "glsl" | "wgsl" = "glsl";
let outputFile: string | null = null;
let formatMode = false;
let checkMode = false;
let showVersion = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (!arg) continue;
  if (arg.startsWith("--target=")) {
    const t = arg.slice("--target=".length);
    if (t === "glsl" || t === "wgsl") target = t;
  } else if (arg === "--target" || arg === "-t") {
    i++;
    if (i < args.length) {
      const t = args[i];
      if (t === "glsl" || t === "wgsl") target = t;
    }
  } else if (arg.startsWith("--output=")) {
    outputFile = arg.slice("--output=".length);
  } else if (arg === "--output" || arg === "-o") {
    i++;
    if (i < args.length) {
      outputFile = args[i] ?? null;
    }
  } else if (arg === "--format" || arg === "-f") {
    formatMode = true;
  } else if (arg === "--check") {
    checkMode = true;
  } else if (arg === "--version" || arg === "-v") {
    showVersion = true;
  } else if (!arg.startsWith("--")) {
    inputFile = arg;
  }
}

if (showVersion) {
  console.log(`gl v${version}`);
  process.exit(0);
}

if (!inputFile) {
  console.error("Usage: gl <input.gl> [--target=glsl|wgsl] [--output=<file>] [--format] [--check]");
  process.exit(1);
}

const fs = await import("fs");

const source = fs.readFileSync(inputFile, "utf-8");

try {
  if (formatMode) {
    const formatted = format(source);
    if (outputFile) {
      fs.writeFileSync(outputFile, formatted);
    } else {
      process.stdout.write(formatted);
    }
    process.exit(0);
  }

  const { code, diagnostics } = compile({ source, target, file: inputFile });

  for (const d of diagnostics) {
    const lines = source.split("\n");
    const startLine = Math.max(0, d.span.line - 3);
    const endLine = Math.min(lines.length, d.span.line + 2);
    const lineNumWidth = String(endLine).length;
    console.error(`${d.file}:${d.span.line}:${d.span.column}: error: ${d.message}`);
    for (let i = startLine; i < endLine; i++) {
      const lineNum = String(i + 1).padStart(lineNumWidth, " ");
      const marker = i + 1 === d.span.line ? ">" : " ";
      const line = lines[i];
      console.error(` ${marker} ${lineNum} | ${line}`);
      if (i + 1 === d.span.line) {
        const colPad = " ".repeat(lineNumWidth + 4 + Math.max(0, d.span.column - 1));
        console.error(` ${colPad}^`);
      }
    }
    console.error("");
  }

  if (diagnostics.length > 0) {
    process.exit(1);
  }

  if (checkMode) {
    process.exit(0);
  }

  if (!code) {
    console.error(`Error: codegen failed for target ${target}`);
    process.exit(1);
  }

  if (outputFile) {
    fs.writeFileSync(outputFile, code);
  } else {
    process.stdout.write(code);
  }
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
