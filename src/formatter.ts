import { tokenize } from "./lexer";
import { parse } from "./parser";
import {
  Statement,
  Expression,
  Type,
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
  switch (t.kind) {
    case "scalar":
      return t.name;
    case "vector": {
      const prefix = VEC_TYPE_MAP[t.element] || "vec";
      return `${prefix}${t.size}`;
    }
    case "struct":
      return t.name;
    case "sampler":
      return t.name;
    case "array":
      return `[${formatType(t.element)}; ${t.size}]`;
    case "quaternion":
      return "quat";
    case "matrix": {
      const m = t;
      const prefix = MAT_PREFIX_MAP[m.element] || "";
      if (m.rows === m.columns) {
        return `${prefix}mat${m.rows}`;
      }
      return `${prefix}mat${m.columns}x${m.rows}`;
    }
    case "opaque":
      return `opaque ${t.name}`;
    case "anonymousStruct":
      return `{ ${t.fields.map(f => `${f.name}: ${formatType(f.type)}`).join(", ")} }`;
    default:
      throw new Error(`Cannot format type ${t.kind}`);
  }
}

function formatLiteral(expr: Extract<Expression, { kind: "Literal" }>): string {
  const { value, literalKind } = expr;
  if (literalKind === "bool") return value ? "true" : "false";
  if (literalKind === "int") return `${typeof value === "number" ? value : Number(value)}`;
  if (literalKind === "float") {
    const f = typeof value === "number" ? value : Number(value);
    if (Number.isInteger(f)) return `${f}.0`;
    return String(f);
  }
  if (literalKind === "char") {
    return `'${typeof value === "string" ? value : String(value)}'`;
  }
  if (literalKind === "color") {
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
  switch (expr.kind) {
    case "Identifier":
      return expr.name;
    case "Literal":
      return formatLiteral(expr);
    case "BinaryExpr":
      return `(${formatExpression(expr.left)} ${expr.operator} ${formatExpression(expr.right)})`;
    case "UnaryExpr":
      return `(${expr.operator}${formatExpression(expr.operand)})`;
    case "CallExpr": {
      const args = expr.args.map(formatExpression).join(", ");
      return `${formatExpression(expr.callee)}(${args})`;
    }
    case "MemberExpr":
      return `${formatExpression(expr.object)}.${expr.property}`;
    case "SwizzleExpr": {
      const swizzle = expr.components.join("");
      return `${formatExpression(expr.object)}.${swizzle}`;
    }
    case "IndexExpr":
      return `${formatExpression(expr.object)}[${formatExpression(expr.index)}]`;
    case "StructLiteral": {
      const fields = expr.fields
        .map((f) => {
          if (f.name === null) return `..${formatExpression(f.value)}`;
          return `${f.name} = ${formatExpression(f.value)}`;
        })
        .join(", ");
      return `{ ${fields} }`;
    }
    case "ArrayLiteral": {
      const elements = expr.elements.map(formatExpression).join(", ");
      return `[${elements}]`;
    }
    case "CompoundAssignExpr": {
      return `${formatExpression(expr.target)} ${expr.operator} ${formatExpression(expr.value)}`;
    }
    case "UpdateExpr": {
      const op = expr.operator;
      return expr.prefix ? `${op}${formatExpression(expr.operand)}` : `${formatExpression(expr.operand)}${op}`;
    }
    case "ConditionalExpr": {
      return `${formatExpression(expr.test)} ? ${formatExpression(expr.consequent)} : ${formatExpression(expr.alternate)}`;
    }
    case "NullCoalescingExpr": {
      return `${formatExpression(expr.left)} ?? ${formatExpression(expr.right)}`;
    }
    case "MatchExpr": {
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
    case "BlockExpr": {
      const stmts = expr.block.statements
        .map((s) => formatStatement(s, 0).trim())
        .join(" ");
      return `{ ${stmts} }`;
    }
  }
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
  switch (stmt.kind) {
    case "StructDecl": {
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
    case "BindingDecl": {
      return `${pad}@binding(${stmt.binding}) uniform ${stmt.name}: ${formatType(stmt.type)};`;
    }
    case "ImportDecl": {
      return `${pad}import "${stmt.path}";`;
    }
    case "FnDecl": {
      const params = stmt.params.map((p) => `${formatType(p.type)} ${p.name}`).join(", ");
      const lines = [`${pad}fn ${stmt.name}(${params}): ${formatType(stmt.returnType)} {`];
      for (const s of stmt.body.statements) {
        lines.push(formatStatement(s, indent + 1));
      }
      lines.push(`${pad}}`);
      return lines.join("\n");
    }
    case "VarDecl": {
      let init = "";
      if (stmt.initializer) {
        init = ` = ${formatExpression(stmt.initializer)}`;
      }
      const mut = stmt.mutable ? "mut " : "";
      return `${pad}let ${mut}${stmt.name}: ${formatType(stmt.type)}${init};`;
    }
    case "ReturnStmt": {
      if (stmt.value) {
        return `${pad}return ${formatExpression(stmt.value)};`;
      }
      return `${pad}return;`;
    }
    case "ExpressionStmt": {
      return `${pad}${formatExpression(stmt.expression)};`;
    }
    case "Block": {
      const lines = [`${pad}{`];
      for (const s of stmt.statements) {
        lines.push(formatStatement(s, indent + 1));
      }
      lines.push(`${pad}}`);
      return lines.join("\n");
    }
    case "IfStmt": {
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
    case "WhileStmt": {
      const lines = [`${pad}while (${formatExpression(stmt.condition)}) {`];
      for (const s of stmt.body.statements) {
        lines.push(formatStatement(s, indent + 1));
      }
      lines.push(`${pad}}`);
      return lines.join("\n");
    }
    case "ForStmt": {
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
    case "DoWhileStmt": {
      const lines = [`${pad}do {`];
      for (const s of stmt.body.statements) {
        lines.push(formatStatement(s, indent + 1));
      }
      lines.push(`${pad}} while (${formatExpression(stmt.condition)});`);
      return lines.join("\n");
    }
    case "LoopStmt": {
      const lines = [`${pad}loop {`];
      for (const s of stmt.body.statements) {
        lines.push(formatStatement(s, indent + 1));
      }
      lines.push(`${pad}}`);
      return lines.join("\n");
    }
    case "BreakStmt": {
      return `${pad}break;`;
    }
    case "ContinueStmt": {
      return `${pad}continue;`;
    }
    case "PanicStmt": {
      if (stmt.message) {
        return `${pad}panic ${formatExpression(stmt.message)};`;
      }
      return `${pad}panic;`;
    }
    case "UnreachableStmt": {
      return `${pad}unreachable;`;
    }
    case "DiscardStmt": {
      return `${pad}discard;`;
    }
    case "TypeAlias":
    case "NewtypeDecl":
    case "OpaqueDecl":
      return "";
  }
  return "";
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
