import { tokenize } from "./lexer";
import { parse } from "./parser";
import {
  Statement,
  Expression,
  Type,
  // Type guards
  isScalar,
  isVector,
  isMatrix,
  isStructType,
  isSampler,
  isArray,
  isLiteral,
  isLiteralOfKind,
  isIdentifier,
  isBinaryExpr,
  isUnaryExpr,
  isCallExpr,
  isMemberExpr,
  isSwizzleExpr,
  isIndexExpr,
  isStructLiteral,
  isArrayLiteral,
  isCompoundAssignExpr,
  isUpdateExpr,
  isConditionalExpr,
  isNullCoalescingExpr,
  isMatchExpr,
  isBlockExpr,
  // Statement guards
  isStructDecl,
  isBindingDecl,
  isImportDecl,
  isFnDecl,
  isVarDecl,
  isReturnStmt,
  isExpressionStmt,
  isBlock,
  isIfStmt,
  isWhileStmt,
  isForStmt,
  isDoWhileStmt,
  isLoopStmt,
  isBreakStmt,
  isContinueStmt,
  isPanicStmt,
  isUnreachableStmt,
  isDiscardStmt,
  isTypeAlias,
  isNewtypeDecl,
  isOpaqueDecl,
  isEnumDecl,
  isTraitDecl,
  isImplBlock,
  assertNever,
} from "./types";

// Vector type prefix map shared between formatter and codegen.
const VEC_TYPE_MAP: Record<string, string> = {
  f32: "vec",
  f16: "vec",
  f64: "dvec",
  bf16: "vec",
  i32: "ivec",
  i8: "ivec",
  i16: "ivec",
  i64: "ivec",
  u32: "uvec",
  u8: "uvec",
  u16: "uvec",
  u64: "uvec",
  bool: "bvec",
};

// Matrix type prefix map shared between formatter and codegen.
const MAT_PREFIX_MAP: Record<string, string> = {
  f32: "",
  f64: "d",
  i32: "i",
  u32: "u",
  f16: "",
  bf16: "",
  i8: "i",
  u8: "u",
  i16: "i",
  u16: "i",
  i64: "i",
  u64: "u",
  bool: "b",
};

/**
 * Converts a gl type to its source-format string representation.
 *
 * @param t - The gl type to format.
 * @returns The formatted type string.
 */
function formatType(t: Type): string {
  if (isScalar(t)) return t.name;
  if (isVector(t)) {
    const prefix = VEC_TYPE_MAP[t.element] || "vec";
    return `${prefix}${t.size}`;
  }
  if (isStructType(t)) return t.name;
  if (isSampler(t)) return t.name;
  if (isArray(t)) return `[${formatType(t.element)}; ${t.size}]`;
  if (t.kind === "quaternion") return "quat";
  if (isMatrix(t)) {
    const prefix = MAT_PREFIX_MAP[t.element] || "";
    if (t.rows === t.columns) {
      return `${prefix}mat${t.rows}`;
    }
    return `${prefix}mat${t.columns}x${t.rows}`;
  }
  if (t.kind === "opaque") return `opaque ${t.name}`;
  if (t.kind === "anonymousStruct") {
    return `{ ${t.fields.map(f => `${f.name}: ${formatType(f.type)}`).join(", ")} }`;
  }
  throw new Error(`Cannot format type ${t.kind}`);
}

function formatLiteral(expr: Extract<Expression, { kind: "Literal" }>): string {
  const { value } = expr;
  if (isLiteralOfKind(expr, "bool")) return value ? "true" : "false";
  if (isLiteralOfKind(expr, "int")) return `${typeof value === "number" ? value : Number(value)}`;
  if (isLiteralOfKind(expr, "float")) {
    const f = typeof value === "number" ? value : Number(value);
    if (Number.isInteger(f)) return `${f}.0`;
    return String(f);
  }
  if (isLiteralOfKind(expr, "char")) {
    return `'${typeof value === "string" ? value : String(value)}'`;
  }
  if (isLiteralOfKind(expr, "color")) {
    return `#${typeof value === "string" ? value : String(value)}`;
  }
  return String(value);
}

/**
 * Emits formatted source code for an expression.
 *
 * @param expr - The expression to format.
 * @returns The formatted expression string.
 */
function formatExpression(expr: Expression): string {
  if (isIdentifier(expr)) {
    return expr.name;
  }
  if (isLiteral(expr)) {
    return formatLiteral(expr);
  }
  if (isBinaryExpr(expr)) {
    return `(${formatExpression(expr.left)} ${expr.operator} ${formatExpression(expr.right)})`;
  }
  if (isUnaryExpr(expr)) {
    return `(${expr.operator}${formatExpression(expr.operand)})`;
  }
  if (isCallExpr(expr)) {
    const args = expr.args.map(formatExpression).join(", ");
    return `${formatExpression(expr.callee)}(${args})`;
  }
  if (isMemberExpr(expr)) {
    return `${formatExpression(expr.object)}.${expr.property}`;
  }
  if (isSwizzleExpr(expr)) {
    const swizzle = expr.components.join("");
    return `${formatExpression(expr.object)}.${swizzle}`;
  }
  if (isIndexExpr(expr)) {
    return `${formatExpression(expr.object)}[${formatExpression(expr.index)}]`;
  }
  if (isStructLiteral(expr)) {
    const fields = expr.fields
      .map((f) => {
        if (f.name === null) return `..${formatExpression(f.value)}`;
        return `${f.name} = ${formatExpression(f.value)}`;
      })
      .join(", ");
    return `{ ${fields} }`;
  }
  if (isArrayLiteral(expr)) {
    const elements = expr.elements.map(formatExpression).join(", ");
    return `[${elements}]`;
  }
  if (isCompoundAssignExpr(expr)) {
    return `${formatExpression(expr.target)} ${expr.operator} ${formatExpression(expr.value)}`;
  }
  if (isUpdateExpr(expr)) {
    const op = expr.operator;
    return expr.prefix ? `${op}${formatExpression(expr.operand)}` : `${formatExpression(expr.operand)}${op}`;
  }
  if (isConditionalExpr(expr)) {
    return `${formatExpression(expr.test)} ? ${formatExpression(expr.consequent)} : ${formatExpression(expr.alternate)}`;
  }
  if (isNullCoalescingExpr(expr)) {
    return `${formatExpression(expr.left)} ?? ${formatExpression(expr.right)}`;
  }
  if (isMatchExpr(expr)) {
    const arms = expr.arms.map((arm) => {
      const guard = arm.guard ? ` if ${formatExpression(arm.guard)}` : "";
      let patternStr = "";
      if (arm.pattern.kind === "literal" && arm.pattern.value !== null) {
        patternStr = String(arm.pattern.value);
      } else if (arm.pattern.kind === "binding" && arm.pattern.binding) {
        patternStr = arm.pattern.binding;
      } else if (arm.pattern.kind === "wildcard") {
        patternStr = "_";
      }
      const bodyStr = arm.body.statements
        .map((s) => formatStatement(s, 0).trim())
        .join(" ");
      return `${patternStr}${guard} => { ${bodyStr} }`;
    }).join(", ");
    return `match ${formatExpression(expr.subject)} { ${arms} }`;
  }
  if (isBlockExpr(expr)) {
    const stmts = expr.block.statements
      .map((s) => formatStatement(s, 0).trim())
      .join(" ");
    return `{ ${stmts} }`;
  }
  throw new Error("Cannot format expression");
}

/**
 * Emits formatted source code for a statement.
 *
 * @param stmt - The statement to format.
 * @param indent - The indentation level (number of 2-space indent units).
 * @returns The formatted statement string.
 */
function formatStatement(stmt: Statement, indent: number): string {
  const pad = "  ".repeat(indent);
  if (isStructDecl(stmt)) {
    const lines = [`${pad}struct ${stmt.name} {`];
    for (let i = 0; i < stmt.fields.length; i++) {
      const field = stmt.fields[i];
      if (!field) continue;
      const comma = i < stmt.fields.length - 1 ? "," : "";
      lines.push(`${pad}  ${formatType(field.type)} ${field.name}${comma}`);
    }
    lines.push(`${pad}}`);
    return lines.join("\n");
  }
  if (isBindingDecl(stmt)) {
    return `${pad}@binding(${stmt.binding}) uniform ${stmt.name}: ${formatType(stmt.type)};`;
  }
  if (isImportDecl(stmt)) {
    return `${pad}import "${stmt.path}";`;
  }
  if (isFnDecl(stmt)) {
    const params = stmt.params.map((p) => `${formatType(p.type)} ${p.name}`).join(", ");
    const lines = [`${pad}fn ${stmt.name}(${params}): ${formatType(stmt.returnType)} {`];
    for (const s of stmt.body.statements) {
      lines.push(formatStatement(s, indent + 1));
    }
    lines.push(`${pad}}`);
    return lines.join("\n");
  }
  if (isVarDecl(stmt)) {
    let init = "";
    if (stmt.initializer) {
      init = ` = ${formatExpression(stmt.initializer)}`;
    }
    const mut = stmt.mutable ? "mut " : "";
    return `${pad}let ${mut}${stmt.name}: ${formatType(stmt.type)}${init};`;
  }
  if (isReturnStmt(stmt)) {
    if (stmt.value) {
      return `${pad}return ${formatExpression(stmt.value)};`;
    }
    return `${pad}return;`;
  }
  if (isExpressionStmt(stmt)) {
    return `${pad}${formatExpression(stmt.expression)};`;
  }
  if (isBlock(stmt)) {
    const lines = [`${pad}{`];
    for (const s of stmt.statements) {
      lines.push(formatStatement(s, indent + 1));
    }
    lines.push(`${pad}}`);
    return lines.join("\n");
  }
  if (isIfStmt(stmt)) {
    const lines = [`${pad}if (${formatExpression(stmt.condition)}) {`];
    for (const s of stmt.thenBranch.statements) {
      lines.push(formatStatement(s, indent + 1));
    }
    lines.push(`${pad}}`);
    if (stmt.elseBranch) {
      lines.push(`${pad}else {`);
      for (const s of stmt.elseBranch.statements) {
        lines.push(formatStatement(s, indent + 1));
      }
      lines.push(`${pad}}`);
    }
    return lines.join("\n");
  }
  if (isWhileStmt(stmt)) {
    const lines = [`${pad}while (${formatExpression(stmt.condition)}) {`];
    for (const s of stmt.body.statements) {
      lines.push(formatStatement(s, indent + 1));
    }
    lines.push(`${pad}}`);
    return lines.join("\n");
  }
  if (isForStmt(stmt)) {
    if (stmt.range) {
      const rangeOp = stmt.range.inclusive ? "..=" : "..";
      const lines = [`${pad}for __loop_var in ${formatExpression(stmt.range.start)}${rangeOp}${formatExpression(stmt.range.end)} {`];
      for (const s of stmt.body.statements) {
        lines.push(formatStatement(s, indent + 1));
      }
      lines.push(`${pad}}`);
      return lines.join("\n");
    }
    const initStr = stmt.init
      ? stmt.init.kind === "VarDecl"
        ? `let mut ${stmt.init.name}: ${formatType(stmt.init.type)} = ${formatExpression(stmt.init.initializer!)}`
        : stmt.init.kind === "ExpressionStmt"
          ? formatExpression(stmt.init.expression)
          : ""
      : "";
    const condStr = stmt.condition ? formatExpression(stmt.condition) : "";
    const incrStr = stmt.increment ? formatExpression(stmt.increment) : "";
    const lines = [`${pad}for (${initStr}; ${condStr}; ${incrStr}) {`];
    for (const s of stmt.body.statements) {
      lines.push(formatStatement(s, indent + 1));
    }
    lines.push(`${pad}}`);
    return lines.join("\n");
  }
  if (isDoWhileStmt(stmt)) {
    const lines = [`${pad}do {`];
    for (const s of stmt.body.statements) {
      lines.push(formatStatement(s, indent + 1));
    }
    lines.push(`${pad}} while (${formatExpression(stmt.condition)});`);
    return lines.join("\n");
  }
  if (isLoopStmt(stmt)) {
    const lines = [`${pad}loop {`];
    for (const s of stmt.body.statements) {
      lines.push(formatStatement(s, indent + 1));
    }
    lines.push(`${pad}}`);
    return lines.join("\n");
  }
  if (isBreakStmt(stmt)) {
    return `${pad}break;`;
  }
  if (isContinueStmt(stmt)) {
    return `${pad}continue;`;
  }
  if (isPanicStmt(stmt)) {
    if (stmt.message) {
      return `${pad}panic ${formatExpression(stmt.message)};`;
    }
    return `${pad}panic;`;
  }
  if (isUnreachableStmt(stmt)) {
    return `${pad}unreachable;`;
  }
  if (isDiscardStmt(stmt)) {
    return `${pad}discard;`;
  }
  if (isTypeAlias(stmt)) {
    return `${pad}type ${stmt.name} = ${formatType(stmt.type)};`;
  }
  if (isNewtypeDecl(stmt)) {
    return `${pad}struct ${stmt.name}(${formatType(stmt.innerType)});`;
  }
  if (isOpaqueDecl(stmt)) {
    return `${pad}opaque ${stmt.name};`;
  }
  if (isEnumDecl(stmt)) {
    const variants = stmt.variants.map((v) =>
      v.type ? `${v.name}(${formatType(v.type)})` : v.name
    ).join(", ");
    return `${pad}enum ${stmt.name} { ${variants} };`;
  }
  if (isTraitDecl(stmt)) {
    return `${pad}trait ${stmt.name} { ... };`;
  }
  if (isImplBlock(stmt)) {
    return `${pad}impl ${stmt.type} for ${stmt.trait} { ... };`;
  }
  return assertNever(stmt);
}

/**
 * Formats gl source code by parsing and re-emitting it with consistent style.
 *
 * @param source - The gl source code to format.
 * @returns The formatted source code string.
 */
export function format(source: string): string {
  const tokens = tokenize(source);
  const ast = parse(tokens);

  const lines: string[] = [];
  for (const stmt of ast.statements) {
    lines.push(formatStatement(stmt, 0));
  }

  return lines.join("\n\n") + "\n";
}
