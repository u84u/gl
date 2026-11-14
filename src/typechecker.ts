import {
  Program,
  Statement,
  Expression,
  Type,
  Span,
  StructDecl,
  FnDecl,
  BindingDecl,
  Block,
  // Type guards
  isScalar,
  isVector,
  isMatrix,
  isStructType,
  isSampler,
  isArray,
  isAbstractInt,
  isAbstractFloat,
  // Statement guards
  isStructDecl,
  isFnDecl,
  isVarDecl,
  isBindingDecl,
  isExpressionStmt,
  // Expression guards (only ones used outside visitor)
  isIdentifier,
  isLiteralOfKind,
  isArrayLiteral,
  // Visitor
  visitStatement,
  visitExpression,
  assertNever,
} from "./types";

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export interface Diagnostic {
  file: string;
  code?: string;
  severity?: DiagnosticSeverity;
  message: string;
  span: Span;
  related?: Diagnostic[];
  help?: string;
}

/**
 * Builds a structured diagnostic with defaults for code and severity.
 *
 * @param file - The source file identity.
 * @param span - The primary source location.
 * @param message - The human-readable message.
 * @param options - Optional code, severity, related locations, and help text.
 * @returns A structured Diagnostic.
 */
export function diagnostic(
  file: string,
  span: Span,
  message: string,
  options?: {
    code?: string;
    severity?: DiagnosticSeverity;
    related?: Diagnostic[];
    help?: string;
  },
): Diagnostic {
  return {
    file,
    span,
    message,
    code: options?.code,
    severity: options?.severity ?? "error",
    related: options?.related,
    help: options?.help,
  };
}

export interface Symbol {
  name: string;
  type: Type;
  kind: "variable" | "function" | "struct" | "binding";
  span: Span;
}

interface Scope {
  symbols: Map<string, Symbol>;
  parent: Scope | null;
}

interface TypeCheckContext {
  file: string;
  scope: Scope;
  diagnostics: Diagnostic[];
  structs: Map<string, StructDecl>;
  functions: Map<string, FnDecl>;
  bindings: Map<number, BindingDecl>;
  currentFnReturnType: Type | null;
}

/**
 * Creates a new scope with the given parent scope.
 *
 * @param parent - The parent scope, or null for a global scope.
 * @returns A new Scope object.
 */
function makeScope(parent: Scope | null): Scope {
  return { symbols: new Map(), parent };
}

// Operator category sets used by checkBinaryOp — defined at module scope to
// avoid reallocation on every call.
const ARITH_OPS = new Set(["+", "-", "*", "/", "%"]);
const CMP_OPS = new Set(["<", "<=", ">", ">=", "==", "!="]);
const LOGIC_OPS = new Set(["&&", "||", "and", "or"]);
const BITWISE_OPS = new Set(["&", "|", "^", "<<", ">>"]);
const SPACESHIP_OPS = new Set(["<=>"]);
const INT_TYPES = new Set(["i32", "u32", "i64", "u64", "i8", "u8", "i16", "u16"]);
const SWIZZLE_VALID = new Set("xyzwrgba");

// Compound assignment operator categories — module scope to avoid reallocation.
const COMPOUND_ARITH_OPS = new Set(["+=", "-=", "*=", "/=", "%="]);
const COMPOUND_BITWISE_OPS = new Set(["&=", "|=", "^=", "<<=", ">>="]);

/**
 * Looks up a symbol by name, searching the current scope and its parents.
 *
 * @param ctx - The type-checking context.
 * @param name - The symbol name to look up.
 * @returns The found Symbol, or null if not found.
 */
function lookup(ctx: TypeCheckContext, name: string): Symbol | null {
  let scope: Scope | null = ctx.scope;
  while (scope) {
    const sym = scope.symbols.get(name);
    if (sym) return sym;
    scope = scope.parent;
  }
  return null;
}

/**
 * Defines a symbol in the current scope.
 *
 * @param ctx - The type-checking context.
 * @param symbol - The symbol to define.
 */
function define(ctx: TypeCheckContext, symbol: Symbol): void {
  ctx.scope.symbols.set(symbol.name, symbol);
}

/**
 * Converts a Type to a human-readable string for error messages.
 *
 * @param t - The type to format.
 * @returns A string representation of the type.
 */
function typeName(t: Type): string {
  if (isAbstractInt(t)) return "abstract int";
  if (isAbstractFloat(t)) return "abstract float";
  if (isScalar(t)) return t.name;
  if (isVector(t)) return `vec${t.size}`;
  if (isMatrix(t)) return `mat${t.rows}x${t.columns}`;
  if (t.kind === "quaternion") return "quat";
  if (isStructType(t)) return t.name;
  if (t.kind === "enum") return `enum ${t.name}`;
  if (isSampler(t)) return t.name;
  if (isArray(t)) return `${typeName(t.element)}[${t.size}]`;
  if (t.kind === "tuple") return `(${t.elements.map(typeName).join(", ")})`;
  if (t.kind === "option") return `Option<${typeName(t.element)}>`;
  if (t.kind === "result") return `Result<${typeName(t.ok)}, ${typeName(t.err)}>`;
  if (t.kind === "alias") return t.name;
  if (t.kind === "opaque") return `opaque ${t.name}`;
  if (t.kind === "anonymousStruct") return `{ ${t.fields.map(f => `${f.name}: ${typeName(f.type)}`).join(", ")} }`;
  if (t.kind === "union") return t.members.map(typeName).join(" | ");
  return "unknown";
}

/**
 * Checks whether a type (or any nested type within it) contains a sampler.
 *
 * @param t - The type to check.
 * @returns true if a sampler is found anywhere in the type structure.
 */
function containsSampler(t: Type): boolean {
  if (isSampler(t)) return true;
  if (isArray(t)) return containsSampler(t.element);
  return false;
}

/**
 * Concretizes an abstract type against a target type.
 *
 * @param abstractType - The abstract type (abstractInt or abstractFloat).
 * @param targetType - The target type to concretize against.
 * @returns The concretized Type.
 * @throws Error if the abstract type cannot be concretized to the target.
 */
function concretize(abstractType: Type, targetType: Type): Type {
  if (isAbstractInt(abstractType)) {
    if (isScalar(targetType)) {
      return targetType;
    }
    if (isVector(targetType)) {
      const v = targetType as Extract<Type, { kind: "vector" }>;
      return { kind: "scalar", name: v.element === "bool" ? "i32" : v.element };
    }
    throw new Error(`Cannot concretize abstract int to ${typeName(targetType)}`);
  }
  if (isAbstractFloat(abstractType)) {
    if (
      isScalar(targetType) &&
      targetType.name !== "bool" &&
      targetType.name !== "i32" &&
      targetType.name !== "u32" &&
      targetType.name !== "i64" &&
      targetType.name !== "u64"
    ) {
      return targetType;
    }
    if (
      isVector(targetType) &&
      targetType.element !== "bool" &&
      targetType.element !== "i32" &&
      targetType.element !== "u32" &&
      targetType.element !== "i64" &&
      targetType.element !== "u64"
    ) {
      const v = targetType as Extract<Type, { kind: "vector" }>;
      return { kind: "scalar", name: v.element };
    }
    throw new Error(`Cannot concretize abstract float to ${typeName(targetType)}`);
  }
  return abstractType;
}

/**
 * Concretifies an expression against an expected type, resolving abstract
 * literals (abstractInt/abstractFloat) to concrete types where possible.
 *
 * @param ctx - The type-checking context.
 * @param expr - The expression to concretify.
 * @param expectedType - The expected type to concretify against.
 * @returns The concretified expression and its type, or null if concretification fails.
 */
function concretify(
  ctx: TypeCheckContext,
  expr: Expression,
  expectedType: Type,
): { expr: Expression; type: Type } | null {
  const type = typeOf(ctx, expr);
  if (
    (isAbstractInt(type) || isAbstractFloat(type)) &&
    !isAbstractInt(expectedType) &&
    !isAbstractFloat(expectedType)
  ) {
    let concretized: Type;
    try {
      concretized = concretize(type, expectedType);
    } catch {
      return null;
    }
    return { expr, type: concretized };
  }
  // Array concretization: concretize array elements against expected element type
  if (isArray(type) && isArray(expectedType) &&
      (isAbstractInt(type.element) || isAbstractFloat(type.element)) &&
      !isAbstractInt(expectedType.element) &&
      !isAbstractFloat(expectedType.element)) {
    if (!isArrayLiteral(expr)) {
      return { expr, type };
    }
    const newElements = expr.elements.map((e) => {
      const result = concretify(ctx, e, expectedType.element);
      return result ? result.expr : e;
    });
    const concretizedType: Type = { kind: "array", element: expectedType.element, size: type.size };
    return { expr: { ...expr, elements: newElements }, type: concretizedType };
  }
  return { expr, type };
}

/**
 * Infers the type of an expression within the given type-checking context.
 *
 * @param ctx - The type-checking context (scope, diagnostics, etc.).
 * @param expr - The expression to infer the type of.
 * @returns The inferred Type, or a default error type ({ kind: "scalar", name: "f32" }) on failure.
 */
function typeOf(ctx: TypeCheckContext, expr: Expression): Type {
  return visitExpression(expr, {
    visitIdentifier: (node) => {
      const sym = lookup(ctx, node.name);
      if (!sym) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: node.span,
          message: `Undeclared identifier '${node.name}'`,
        });
        return { kind: "scalar", name: "f32" };
      }
      return sym.type;
    },
    visitLiteral: (node) => {
      if (isLiteralOfKind(node, "bool")) return { kind: "scalar", name: "bool" };
      if (isLiteralOfKind(node, "int")) return { kind: "abstractInt" };
      if (isLiteralOfKind(node, "float")) return { kind: "abstractFloat" };
      if (isLiteralOfKind(node, "char")) return { kind: "scalar", name: "i32" };
      if (isLiteralOfKind(node, "color")) return { kind: "scalar", name: "u32" };
      return { kind: "scalar", name: "f32" };
    },
    visitBinaryExpr: (node) => {
      const left = typeOf(ctx, node.left);
      const right = typeOf(ctx, node.right);
      return checkBinaryOp(ctx, left, right, node.operator, node.span);
    },
    visitUnaryExpr: (node) => {
      const operand = typeOf(ctx, node.operand);
      return checkUnaryOp(ctx, operand, node.operator, node.span);
    },
    visitCallExpr: (node) => {
      const callee = node.callee;
      if (!isIdentifier(callee)) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: node.span,
          message: "Cannot call non-identifier expression",
        });
        return { kind: "scalar", name: "f32" };
      }
      const sym = lookup(ctx, callee.name);
      if (!sym) {
        const builtin = checkBuiltinCall(ctx, callee.name, node.args, node.span);
        if (builtin) return builtin;
        ctx.diagnostics.push({
          file: ctx.file,
          span: node.span,
          message: `Undeclared function '${callee.name}'`,
        });
        return { kind: "scalar", name: "f32" };
      }
      if (sym.kind !== "function") {
        ctx.diagnostics.push({
          file: ctx.file,
          span: node.span,
          message: `Not a function: ${callee.name}`,
        });
        return { kind: "scalar", name: "f32" };
      }
      const fnDecl = ctx.functions.get(callee.name);
      if (!fnDecl) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: node.span,
          message: `Function '${callee.name}' not found`,
        });
        return { kind: "scalar", name: "f32" };
      }
      return checkUserCall(ctx, fnDecl, node.args, node.span);
    },
    visitMemberExpr: (node) => {
      const objectType = typeOf(ctx, node.object);
      if (isStructType(objectType)) {
        const structDecl = ctx.structs.get(objectType.name);
        if (!structDecl) {
          ctx.diagnostics.push({
            file: ctx.file,
            span: node.span,
            message: `Unknown struct '${objectType.name}'`,
          });
          return { kind: "scalar", name: "f32" };
        }
        const field = structDecl.fields.find((f) => f.name === node.property);
        if (!field) {
          ctx.diagnostics.push({
            file: ctx.file,
            span: node.span,
            message: `Struct '${objectType.name}' has no field '${node.property}'`,
          });
          return { kind: "scalar", name: "f32" };
        }
        return field.type;
      }
      if (isVector(objectType)) {
        if (node.property.length === 1 && SWIZZLE_VALID.has(node.property)) {
          return { kind: "scalar", name: objectType.element };
        }
      }
      if (node.property.length >= 1 && node.property.length <= 4) {
        const allValid = node.property.split("").every((c) => SWIZZLE_VALID.has(c));
        if (allValid) {
          ctx.diagnostics.push({
            file: ctx.file,
            span: node.span,
            message: `Cannot swizzle non-vector type ${typeName(objectType)}`,
          });
          return { kind: "scalar", name: "f32" };
        }
      }
      ctx.diagnostics.push({
        file: ctx.file,
        span: node.span,
        message: `Cannot access field '${node.property}' on non-struct type ${typeName(objectType)}`,
      });
      return { kind: "scalar", name: "f32" };
    },
    visitSwizzleExpr: (node) => {
      const objectType = typeOf(ctx, node.object);
      if (!isVector(objectType)) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: node.span,
          message: `Cannot swizzle non-vector type ${typeName(objectType)}`,
        });
        return { kind: "scalar", name: "f32" };
      }
      const components = node.components;
      const allValid = components.every((c) => SWIZZLE_VALID.has(c));
      if (!allValid) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: node.span,
          message: `Cannot access field '${components.join("")}' on non-struct type ${typeName(objectType)}`,
        });
        return { kind: "scalar", name: "f32" };
      }
      const xyzw = new Set("xyzw");
      const rgba = new Set("rgba");
      const usesXYZW = components.some((c) => xyzw.has(c));
      const usesRGBA = components.some((c) => rgba.has(c));
      if (usesXYZW && usesRGBA) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: node.span,
          message: "Cannot mix xyzw and rgba swizzle components",
        });
        return { kind: "scalar", name: "f32" };
      }
      if (components.length > objectType.size) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: node.span,
          message: `Swizzle of length ${components.length} on ${typeName(objectType)}`,
        });
        return { kind: "scalar", name: "f32" };
      }
      if (components.length === 1) {
        return { kind: "scalar", name: objectType.element };
      }
      if (components.length < 2 || components.length > objectType.size) {
        return { kind: "scalar", name: objectType.element };
      }
      return { kind: "vector", element: objectType.element, size: components.length as 2 | 3 | 4 };
    },
    visitIndexExpr: (node) => {
      const objectType = typeOf(ctx, node.object);
      const indexType = typeOf(ctx, node.index);
      if (!(isScalar(indexType) && indexType.name === "i32") && !isAbstractInt(indexType)) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: node.index.span,
          message: `Array index must be i32, got ${typeName(indexType)}`,
        });
      }
      if (isArray(objectType)) {
        return objectType.element;
      }
      if (isVector(objectType)) {
        return { kind: "scalar", name: objectType.element };
      }
      ctx.diagnostics.push({
        file: ctx.file,
        span: node.span,
        message: `Cannot index non-array type ${typeName(objectType)}`,
      });
      return { kind: "scalar", name: "f32" };
    },
    visitStructLiteral: (node) => {
      const structDecl = ctx.structs.get(node.typeName);
      if (!structDecl) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: node.span,
          message: `Unknown struct '${node.typeName}'`,
        });
        return { kind: "scalar", name: "f32" };
      }
      const declaredFields = new Map(structDecl.fields.map((f) => [f.name, f.type]));
      const seenFields = new Set<string>();
      for (const field of node.fields) {
        if (field.name === null) continue; // spread, skip field validation
        if (seenFields.has(field.name)) {
          ctx.diagnostics.push({
            file: ctx.file,
            span: field.value.span,
            message: `Duplicate field '${field.name}' in struct literal`,
          });
          continue;
        }
        seenFields.add(field.name);
        const expected = declaredFields.get(field.name);
        if (!expected) {
          ctx.diagnostics.push({
            file: ctx.file,
            span: field.value.span,
            message: `Struct '${node.typeName}' has no field '${field.name}'`,
          });
          continue;
        }
        const concretized = concretify(ctx, field.value, expected);
        if (!concretized) {
          ctx.diagnostics.push({
            file: ctx.file,
            span: field.value.span,
            message: `Cannot convert field '${field.name}' to ${typeName(expected)}`,
          });
          continue;
        }
        if (typesDiffer(concretized.type, expected)) {
          ctx.diagnostics.push({
            file: ctx.file,
            span: field.value.span,
            message: `Field '${field.name}' expects ${typeName(expected)}, got ${typeName(concretized.type)}`,
          });
        }
      }
      for (const [name] of declaredFields) {
        if (!seenFields.has(name)) {
          ctx.diagnostics.push({
            file: ctx.file,
            span: node.span,
            message: `Missing field '${name}' in struct literal for '${node.typeName}'`,
          });
        }
      }
      return { kind: "struct", name: node.typeName };
    },
    visitArrayLiteral: (node) => {
      const elements = node.elements;
      if (elements.length === 0) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: node.span,
          message: "Array literal must have at least one element",
        });
        return { kind: "scalar", name: "f32" };
      }
      const firstType = typeOf(ctx, elements[0]!);
      for (let i = 1; i < elements.length; i++) {
        const elemType = typeOf(ctx, elements[i]!);
        if (typesDiffer(elemType, firstType)) {
          ctx.diagnostics.push({
            file: ctx.file,
            span: elements[i]!.span,
            message: `Array literal element ${i} expects ${typeName(firstType)}, got ${typeName(elemType)}`,
          });
        }
      }
      return { kind: "array", element: firstType, size: elements.length };
    },
    visitCompoundAssignExpr: (node) => {
      const targetType = typeOf(ctx, node.target);
      const concretized = concretify(ctx, node.value, targetType);
      const valueType = concretized ? concretized.type : typeOf(ctx, node.value);
      if (COMPOUND_ARITH_OPS.has(node.operator)) {
        if (!concretized || typesDiffer(targetType, valueType)) {
          ctx.diagnostics.push({
            file: ctx.file,
            span: node.span,
            message: `Compound assignment '${node.operator}' requires same-type operands, got ${typeName(targetType)} and ${typeName(valueType)}`,
          });
        }
        return targetType;
      }
      if (COMPOUND_BITWISE_OPS.has(node.operator)) {
        if (
          (isScalar(targetType) && INT_TYPES.has(targetType.name)) ||
          (isVector(targetType) && INT_TYPES.has(targetType.element))
        ) {
          return targetType;
        }
        ctx.diagnostics.push({
          file: ctx.file,
          span: node.span,
          message: `Bitwise compound assignment '${node.operator}' requires integer operands`,
        });
        return targetType;
      }
      return targetType;
    },
    visitUpdateExpr: (node) => {
      const operandType = typeOf(ctx, node.operand);
      if (
        (isScalar(operandType) && (INT_TYPES.has(operandType.name) || operandType.name === "f32" || operandType.name === "f64")) ||
        isVector(operandType)
      ) {
        return operandType;
      }
      ctx.diagnostics.push({
        file: ctx.file,
        span: node.span,
        message: `Increment/decrement requires numeric operand, got ${typeName(operandType)}`,
      });
      return operandType;
    },
    visitConditionalExpr: (node) => {
      const testType = typeOf(ctx, node.test);
      if (!isScalar(testType) || testType.name !== "bool") {
        ctx.diagnostics.push({
          file: ctx.file,
          span: node.test.span,
          message: `Ternary condition must be bool, got ${typeName(testType)}`,
        });
      }
      const consequentType = typeOf(ctx, node.consequent);
      const alternateType = typeOf(ctx, node.alternate);
      if (typesDiffer(consequentType, alternateType)) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: node.span,
          message: `Ternary branches must have same type, got ${typeName(consequentType)} and ${typeName(alternateType)}`,
        });
      }
      return consequentType;
    },
    visitNullCoalescingExpr: (node) => {
      const leftType = typeOf(ctx, node.left);
      const rightType = typeOf(ctx, node.right);
      if (typesDiffer(leftType, rightType)) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: node.span,
          message: `Null coalescing branches must have same type, got ${typeName(leftType)} and ${typeName(rightType)}`,
        });
      }
      return leftType;
    },
    visitMatchExpr: (node) => {
      let resultType: Type | null = null;
      for (const arm of node.arms) {
        if (arm.guard) {
          const guardType = typeOf(ctx, arm.guard);
          if (!isScalar(guardType) || guardType.name !== "bool") {
            ctx.diagnostics.push({
              file: ctx.file,
              span: arm.guard.span,
              message: `Match guard must be bool, got ${typeName(guardType)}`,
            });
          }
        }
        const lastStmt = arm.body.statements[arm.body.statements.length - 1];
        if (lastStmt && isExpressionStmt(lastStmt)) {
          const armType = typeOf(ctx, lastStmt.expression);
          if (resultType && typesDiffer(resultType, armType)) {
            ctx.diagnostics.push({
              file: ctx.file,
              span: arm.span,
              message: `Match arms must have same result type, got ${typeName(resultType)} and ${typeName(armType)}`,
            });
          }
          resultType = armType;
        }
      }
      return resultType ?? { kind: "scalar", name: "f32" };
    },
    visitBlockExpr: (node) => {
      const lastStmt = node.block.statements[node.block.statements.length - 1];
      if (lastStmt && isExpressionStmt(lastStmt)) {
        return typeOf(ctx, lastStmt.expression);
      }
      for (const stmt of node.block.statements) {
        typeCheckStatement(ctx, stmt);
      }
      return { kind: "scalar", name: "f32" };
    },
  });
}

/**
 * Determines whether two types differ.
 *
 * @param a - The first type to compare.
 * @param b - The second type to compare.
 * @returns true if the types differ, false otherwise.
 */
function typesDiffer(a: Type, b: Type): boolean {
  if (a.kind !== b.kind) return true;
  switch (a.kind) {
    case "scalar":
      return (a as Extract<Type, { kind: "scalar" }>).name !== (b as Extract<Type, { kind: "scalar" }>).name;
    case "vector":
      return (a as Extract<Type, { kind: "vector" }>).size !== (b as Extract<Type, { kind: "vector" }>).size ||
        (a as Extract<Type, { kind: "vector" }>).element !== (b as Extract<Type, { kind: "vector" }>).element;
    case "matrix":
      return (a as Extract<Type, { kind: "matrix" }>).rows !== (b as Extract<Type, { kind: "matrix" }>).rows ||
        (a as Extract<Type, { kind: "matrix" }>).columns !== (b as Extract<Type, { kind: "matrix" }>).columns ||
        (a as Extract<Type, { kind: "matrix" }>).element !== (b as Extract<Type, { kind: "matrix" }>).element;
    case "struct":
      return (a as Extract<Type, { kind: "struct" }>).name !== (b as Extract<Type, { kind: "struct" }>).name;
    case "sampler":
      return (a as Extract<Type, { kind: "sampler" }>).name !== (b as Extract<Type, { kind: "sampler" }>).name;
    case "array":
      return (a as Extract<Type, { kind: "array" }>).size !== (b as Extract<Type, { kind: "array" }>).size ||
        typesDiffer((a as Extract<Type, { kind: "array" }>).element, (b as Extract<Type, { kind: "array" }>).element);
    case "quaternion":
      return false;
    case "abstractInt":
    case "abstractFloat":
      return false;
    default:
      return assertNever(a as never);
  }
}

/**
 * Type-checks a binary operation and returns its result type.
 *
 * @param ctx - The type-checking context.
 * @param left - The type of the left operand.
 * @param right - The type of the right operand.
 * @param operator - The binary operator string.
 * @param span - The source span for diagnostic reporting.
 * @returns The result type of the binary operation.
 */
function checkBinaryOp(
  ctx: TypeCheckContext,
  left: Type,
  right: Type,
  operator: string,
  span: Span
): Type {
  let lt = left;
  let rt = right;

  // Concretize abstract literals against each other
  if (isAbstractInt(lt) || isAbstractFloat(lt)) {
    if (!isAbstractInt(rt) && !isAbstractFloat(rt)) {
      lt = concretize(lt, rt);
    }
  }
  if (isAbstractInt(rt) || isAbstractFloat(rt)) {
    if (!isAbstractInt(lt) && !isAbstractFloat(lt)) {
      rt = concretize(rt, lt);
    }
  }

  if (ARITH_OPS.has(operator)) {
    if (isAbstractInt(lt) || isAbstractFloat(lt)) {
      if (!isAbstractInt(rt) && !isAbstractFloat(rt)) {
        lt = concretize(lt, rt);
      }
    }
    if (isAbstractInt(rt) || isAbstractFloat(rt)) {
      if (!isAbstractInt(lt) && !isAbstractFloat(lt)) {
        rt = concretize(rt, lt);
      }
    }

    if (isAbstractInt(lt) && isAbstractInt(rt)) {
      return { kind: "abstractInt" };
    }
    if (isAbstractFloat(lt) && isAbstractFloat(rt)) {
      return { kind: "abstractFloat" };
    }

    if (isVector(lt) || isVector(rt)) {
      const vec = isVector(lt) ? lt : rt;
      const scalar = isVector(lt) ? rt : lt;
      const v = vec as Extract<Type, { kind: "vector" }>;
      if (isScalar(scalar) && scalar.name === v.element) {
        return vec;
      }
    }

    if (isScalar(lt) && isScalar(rt) && lt.name === rt.name) {
      return lt;
    }

    ctx.diagnostics.push({
      file: ctx.file,
      span,
      message: `Operator '${operator}' not supported between ${typeName(lt)} and ${typeName(rt)}`,
    });
    return { kind: "scalar", name: "f32" };
  }

  if (CMP_OPS.has(operator)) {
    if (typesDiffer(lt, rt)) {
      ctx.diagnostics.push({
        file: ctx.file,
        span,
        message: `Operator '${operator}' requires same-type operands, got ${typeName(lt)} and ${typeName(rt)}`,
      });
    }
    return { kind: "scalar", name: "bool" };
  }

  if (SPACESHIP_OPS.has(operator)) {
    if (typesDiffer(lt, rt)) {
      ctx.diagnostics.push({
        file: ctx.file,
        span,
        message: `Operator '${operator}' requires same-type operands, got ${typeName(lt)} and ${typeName(rt)}`,
      });
    }
    return { kind: "scalar", name: "i32" };
  }

  if (BITWISE_OPS.has(operator)) {
    if (isAbstractInt(lt) && isAbstractInt(rt)) {
      return { kind: "abstractInt" };
    }
    const isInt = (t: Type) => isScalar(t) && INT_TYPES.has(t.name);
    const isIntVec = (t: Type) => isVector(t) && INT_TYPES.has(t.element);
    if ((isInt(lt) && isInt(rt)) || (isIntVec(lt) && isIntVec(rt))) {
      return lt;
    }
    ctx.diagnostics.push({
      file: ctx.file,
      span,
      message: `Bitwise operator '${operator}' requires integer operands, got ${typeName(lt)} and ${typeName(rt)}`,
    });
    return { kind: "scalar", name: "f32" };
  }

  if (LOGIC_OPS.has(operator)) {
    if (!isScalar(lt) || lt.name !== "bool" || !isScalar(rt) || rt.name !== "bool") {
      ctx.diagnostics.push({
        file: ctx.file,
        span,
        message: `Operator '${operator}' requires bool operands`,
      });
    }
    return { kind: "scalar", name: "bool" };
  }

  ctx.diagnostics.push({
    file: ctx.file,
    span,
    message: `Unknown operator '${operator}'`,
  });
  return { kind: "scalar", name: "f32" };
}

/**
 * Type-checks a unary operation and returns its result type.
 *
 * @param ctx - The type-checking context.
 * @param operand - The type of the operand.
 * @param operator - The unary operator string.
 * @param span - The source span for diagnostic reporting.
 * @returns The result type of the unary operation.
 */
function checkUnaryOp(
  ctx: TypeCheckContext,
  operand: Type,
  operator: string,
  span: Span
): Type {
  if (operator === "-") {
    if (isAbstractInt(operand) || isAbstractFloat(operand)) {
      return operand;
    }
    if (
      (isScalar(operand) && (INT_TYPES.has(operand.name) || operand.name === "f32" || operand.name === "f64")) ||
      isVector(operand)
    ) {
      return operand;
    }
    ctx.diagnostics.push({
      file: ctx.file,
      span,
      message: `Operator '-' not supported on ${typeName(operand)}`,
    });
    return { kind: "scalar", name: "f32" };
  }
  if (operator === "!" || operator === "not") {
    if (isScalar(operand) && operand.name === "bool") {
      return { kind: "scalar", name: "bool" };
    }
    ctx.diagnostics.push({
      file: ctx.file,
      span,
      message: `Operator '${operator}' requires bool operand`,
    });
    return { kind: "scalar", name: "bool" };
  }
  if (operator === "~") {
    if (isAbstractInt(operand)) {
      return { kind: "abstractInt" };
    }
    if (isScalar(operand) && INT_TYPES.has(operand.name)) {
      return operand;
    }
    if (isVector(operand) && INT_TYPES.has(operand.element)) {
      return operand;
    }
    ctx.diagnostics.push({
      file: ctx.file,
      span,
      message: `Operator '~' requires integer operand, got ${typeName(operand)}`,
    });
    return { kind: "scalar", name: "f32" };
  }
  ctx.diagnostics.push({
    file: ctx.file,
    span,
    message: `Unknown unary operator '${operator}'`,
  });
  return { kind: "scalar", name: "f32" };
}

const BUILTIN_SIGNATURES: Record<string, { params: Type[]; result: Type }[]> = {
  vec4: [
    { params: [{ kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }], result: { kind: "vector", element: "f32", size: 4 } },
    { params: [{ kind: "vector", element: "f32", size: 3 }, { kind: "scalar", name: "f32" }], result: { kind: "vector", element: "f32", size: 4 } },
    { params: [{ kind: "scalar", name: "f32" }, { kind: "vector", element: "f32", size: 3 }], result: { kind: "vector", element: "f32", size: 4 } },
    { params: [{ kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }], result: { kind: "vector", element: "i32", size: 4 } },
    { params: [{ kind: "vector", element: "i32", size: 3 }, { kind: "scalar", name: "i32" }], result: { kind: "vector", element: "i32", size: 4 } },
    { params: [{ kind: "scalar", name: "i32" }, { kind: "vector", element: "i32", size: 3 }], result: { kind: "vector", element: "i32", size: 4 } },
  ],
  ivec4: [
    { params: [{ kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }], result: { kind: "vector", element: "i32", size: 4 } },
    { params: [{ kind: "vector", element: "i32", size: 3 }, { kind: "scalar", name: "i32" }], result: { kind: "vector", element: "i32", size: 4 } },
    { params: [{ kind: "scalar", name: "i32" }, { kind: "vector", element: "i32", size: 3 }], result: { kind: "vector", element: "i32", size: 4 } },
  ],
  uvec4: [
    { params: [{ kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }], result: { kind: "vector", element: "u32", size: 4 } },
    { params: [{ kind: "vector", element: "u32", size: 3 }, { kind: "scalar", name: "u32" }], result: { kind: "vector", element: "u32", size: 4 } },
    { params: [{ kind: "scalar", name: "u32" }, { kind: "vector", element: "u32", size: 3 }], result: { kind: "vector", element: "u32", size: 4 } },
  ],
  bvec4: [
    { params: [{ kind: "scalar", name: "bool" }, { kind: "scalar", name: "bool" }, { kind: "scalar", name: "bool" }, { kind: "scalar", name: "bool" }], result: { kind: "vector", element: "bool", size: 4 } },
    { params: [{ kind: "vector", element: "bool", size: 3 }, { kind: "scalar", name: "bool" }], result: { kind: "vector", element: "bool", size: 4 } },
    { params: [{ kind: "scalar", name: "bool" }, { kind: "vector", element: "bool", size: 3 }], result: { kind: "vector", element: "bool", size: 4 } },
  ],
  dvec4: [
    { params: [{ kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }], result: { kind: "vector", element: "f64", size: 4 } },
    { params: [{ kind: "vector", element: "f64", size: 3 }, { kind: "scalar", name: "f64" }], result: { kind: "vector", element: "f64", size: 4 } },
    { params: [{ kind: "scalar", name: "f64" }, { kind: "vector", element: "f64", size: 3 }], result: { kind: "vector", element: "f64", size: 4 } },
  ],
  vec3: [
    { params: [{ kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }], result: { kind: "vector", element: "f32", size: 3 } },
    { params: [{ kind: "vector", element: "f32", size: 2 }, { kind: "scalar", name: "f32" }], result: { kind: "vector", element: "f32", size: 3 } },
    { params: [{ kind: "scalar", name: "f32" }, { kind: "vector", element: "f32", size: 2 }], result: { kind: "vector", element: "f32", size: 3 } },
    { params: [{ kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }], result: { kind: "vector", element: "i32", size: 3 } },
    { params: [{ kind: "vector", element: "i32", size: 2 }, { kind: "scalar", name: "i32" }], result: { kind: "vector", element: "i32", size: 3 } },
    { params: [{ kind: "scalar", name: "i32" }, { kind: "vector", element: "i32", size: 2 }], result: { kind: "vector", element: "i32", size: 3 } },
  ],
  ivec3: [
    { params: [{ kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }], result: { kind: "vector", element: "i32", size: 3 } },
    { params: [{ kind: "vector", element: "i32", size: 2 }, { kind: "scalar", name: "i32" }], result: { kind: "vector", element: "i32", size: 3 } },
    { params: [{ kind: "scalar", name: "i32" }, { kind: "vector", element: "i32", size: 2 }], result: { kind: "vector", element: "i32", size: 3 } },
  ],
  uvec3: [
    { params: [{ kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }], result: { kind: "vector", element: "u32", size: 3 } },
    { params: [{ kind: "vector", element: "u32", size: 2 }, { kind: "scalar", name: "u32" }], result: { kind: "vector", element: "u32", size: 3 } },
    { params: [{ kind: "scalar", name: "u32" }, { kind: "vector", element: "u32", size: 2 }], result: { kind: "vector", element: "u32", size: 3 } },
  ],
  bvec3: [
    { params: [{ kind: "scalar", name: "bool" }, { kind: "scalar", name: "bool" }, { kind: "scalar", name: "bool" }], result: { kind: "vector", element: "bool", size: 3 } },
    { params: [{ kind: "vector", element: "bool", size: 2 }, { kind: "scalar", name: "bool" }], result: { kind: "vector", element: "bool", size: 3 } },
    { params: [{ kind: "scalar", name: "bool" }, { kind: "vector", element: "bool", size: 2 }], result: { kind: "vector", element: "bool", size: 3 } },
  ],
  dvec3: [
    { params: [{ kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }], result: { kind: "vector", element: "f64", size: 3 } },
    { params: [{ kind: "vector", element: "f64", size: 2 }, { kind: "scalar", name: "f64" }], result: { kind: "vector", element: "f64", size: 3 } },
    { params: [{ kind: "scalar", name: "f64" }, { kind: "vector", element: "f64", size: 2 }], result: { kind: "vector", element: "f64", size: 3 } },
  ],
  uvec2: [
    { params: [{ kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }], result: { kind: "vector", element: "u32", size: 2 } },
  ],
  bvec2: [
    { params: [{ kind: "scalar", name: "bool" }, { kind: "scalar", name: "bool" }], result: { kind: "vector", element: "bool", size: 2 } },
  ],
  dvec2: [
    { params: [{ kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }], result: { kind: "vector", element: "f64", size: 2 } },
  ],
  vec2: [
    { params: [{ kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }], result: { kind: "vector", element: "f32", size: 2 } },
    { params: [{ kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }], result: { kind: "vector", element: "i32", size: 2 } },
  ],
  f32: [
    { params: [{ kind: "abstractInt" }], result: { kind: "scalar", name: "f32" } },
    { params: [{ kind: "abstractFloat" }], result: { kind: "scalar", name: "f32" } },
  ],
  i32: [
    { params: [{ kind: "abstractInt" }], result: { kind: "scalar", name: "i32" } },
  ],
  dot: [
    { params: [{ kind: "vector", element: "f32", size: 2 }, { kind: "vector", element: "f32", size: 2 }], result: { kind: "scalar", name: "f32" } },
    { params: [{ kind: "vector", element: "f32", size: 3 }, { kind: "vector", element: "f32", size: 3 }], result: { kind: "scalar", name: "f32" } },
    { params: [{ kind: "vector", element: "f32", size: 4 }, { kind: "vector", element: "f32", size: 4 }], result: { kind: "scalar", name: "f32" } },
  ],
  cross: [
    { params: [{ kind: "vector", element: "f32", size: 3 }, { kind: "vector", element: "f32", size: 3 }], result: { kind: "vector", element: "f32", size: 3 } },
  ],
  normalize: [
    { params: [{ kind: "vector", element: "f32", size: 2 }], result: { kind: "vector", element: "f32", size: 2 } },
    { params: [{ kind: "vector", element: "f32", size: 3 }], result: { kind: "vector", element: "f32", size: 3 } },
    { params: [{ kind: "vector", element: "f32", size: 4 }], result: { kind: "vector", element: "f32", size: 4 } },
  ],
  length: [
    { params: [{ kind: "vector", element: "f32", size: 2 }], result: { kind: "scalar", name: "f32" } },
    { params: [{ kind: "vector", element: "f32", size: 3 }], result: { kind: "scalar", name: "f32" } },
    { params: [{ kind: "vector", element: "f32", size: 4 }], result: { kind: "scalar", name: "f32" } },
  ],
  mix: [
    { params: [{ kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }], result: { kind: "scalar", name: "f32" } },
    { params: [{ kind: "vector", element: "f32", size: 2 }, { kind: "vector", element: "f32", size: 2 }, { kind: "scalar", name: "f32" }], result: { kind: "vector", element: "f32", size: 2 } },
    { params: [{ kind: "vector", element: "f32", size: 3 }, { kind: "vector", element: "f32", size: 3 }, { kind: "scalar", name: "f32" }], result: { kind: "vector", element: "f32", size: 3 } },
    { params: [{ kind: "vector", element: "f32", size: 4 }, { kind: "vector", element: "f32", size: 4 }, { kind: "scalar", name: "f32" }], result: { kind: "vector", element: "f32", size: 4 } },
  ],
  clamp: [
    { params: [{ kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }], result: { kind: "scalar", name: "f32" } },
    { params: [{ kind: "vector", element: "f32", size: 2 }, { kind: "vector", element: "f32", size: 2 }, { kind: "vector", element: "f32", size: 2 }], result: { kind: "vector", element: "f32", size: 2 } },
    { params: [{ kind: "vector", element: "f32", size: 3 }, { kind: "vector", element: "f32", size: 3 }, { kind: "vector", element: "f32", size: 3 }], result: { kind: "vector", element: "f32", size: 3 } },
    { params: [{ kind: "vector", element: "f32", size: 4 }, { kind: "vector", element: "f32", size: 4 }, { kind: "vector", element: "f32", size: 4 }], result: { kind: "vector", element: "f32", size: 4 } },
  ],
  min: [
    { params: [{ kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }], result: { kind: "scalar", name: "f32" } },
  ],
  max: [
    { params: [{ kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }], result: { kind: "scalar", name: "f32" } },
  ],
  abs: [
    { params: [{ kind: "scalar", name: "f32" }], result: { kind: "scalar", name: "f32" } },
  ],
  sin: [
    { params: [{ kind: "scalar", name: "f32" }], result: { kind: "scalar", name: "f32" } },
  ],
  cos: [
    { params: [{ kind: "scalar", name: "f32" }], result: { kind: "scalar", name: "f32" } },
  ],
  pow: [
    { params: [{ kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }], result: { kind: "scalar", name: "f32" } },
  ],
  sqrt: [
    { params: [{ kind: "scalar", name: "f32" }], result: { kind: "scalar", name: "f32" } },
  ],
  floor: [
    { params: [{ kind: "scalar", name: "f32" }], result: { kind: "scalar", name: "f32" } },
  ],
  fract: [
    { params: [{ kind: "scalar", name: "f32" }], result: { kind: "scalar", name: "f32" } },
  ],
  texture: [
    { params: [{ kind: "sampler", name: "sampler2D" }, { kind: "vector", element: "f32", size: 2 }], result: { kind: "vector", element: "f32", size: 4 } },
    { params: [{ kind: "sampler", name: "sampler3D" }, { kind: "vector", element: "f32", size: 3 }], result: { kind: "vector", element: "f32", size: 4 } },
    { params: [{ kind: "sampler", name: "samplerCube" }, { kind: "vector", element: "f32", size: 3 }], result: { kind: "vector", element: "f32", size: 4 } },
  ],
  mat2: [
    { params: [{ kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }], result: { kind: "matrix", element: "f32", rows: 2, columns: 2 } },
    { params: [{ kind: "vector", element: "f32", size: 2 }, { kind: "vector", element: "f32", size: 2 }], result: { kind: "matrix", element: "f32", rows: 2, columns: 2 } },
  ],
  mat3: [
    { params: [{ kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }], result: { kind: "matrix", element: "f32", rows: 3, columns: 3 } },
    { params: [{ kind: "vector", element: "f32", size: 3 }, { kind: "vector", element: "f32", size: 3 }, { kind: "vector", element: "f32", size: 3 }], result: { kind: "matrix", element: "f32", rows: 3, columns: 3 } },
  ],
  mat4: [
    { params: [{ kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }], result: { kind: "matrix", element: "f32", rows: 4, columns: 4 } },
    { params: [{ kind: "vector", element: "f32", size: 4 }, { kind: "vector", element: "f32", size: 4 }, { kind: "vector", element: "f32", size: 4 }, { kind: "vector", element: "f32", size: 4 }], result: { kind: "matrix", element: "f32", rows: 4, columns: 4 } },
  ],
  dmat2: [
    { params: [{ kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }], result: { kind: "matrix", element: "f64", rows: 2, columns: 2 } },
  ],
  dmat3: [
    { params: [{ kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }], result: { kind: "matrix", element: "f64", rows: 3, columns: 3 } },
  ],
  dmat4: [
    { params: [{ kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }], result: { kind: "matrix", element: "f64", rows: 4, columns: 4 } },
  ],
  imat2: [
    { params: [{ kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }], result: { kind: "matrix", element: "i32", rows: 2, columns: 2 } },
  ],
  imat3: [
    { params: [{ kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }], result: { kind: "matrix", element: "i32", rows: 3, columns: 3 } },
  ],
  imat4: [
    { params: [{ kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }], result: { kind: "matrix", element: "i32", rows: 4, columns: 4 } },
  ],
  umat2: [
    { params: [{ kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }], result: { kind: "matrix", element: "u32", rows: 2, columns: 2 } },
  ],
  umat3: [
    { params: [{ kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }], result: { kind: "matrix", element: "u32", rows: 3, columns: 3 } },
  ],
  umat4: [
    { params: [{ kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }], result: { kind: "matrix", element: "u32", rows: 4, columns: 4 } },
  ],
  quat: [
    { params: [{ kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }, { kind: "scalar", name: "f32" }], result: { kind: "quaternion" } },
  ],
  deg: [
    { params: [{ kind: "scalar", name: "f32" }], result: { kind: "scalar", name: "f32" } },
  ],
  rad: [
    { params: [{ kind: "scalar", name: "f32" }], result: { kind: "scalar", name: "f32" } },
  ],
  rotateLeft: [
    { params: [{ kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }], result: { kind: "scalar", name: "i32" } },
    { params: [{ kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }], result: { kind: "scalar", name: "u32" } },
  ],
  rotateRight: [
    { params: [{ kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }], result: { kind: "scalar", name: "i32" } },
    { params: [{ kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }], result: { kind: "scalar", name: "u32" } },
  ],
  bitCount: [
    { params: [{ kind: "scalar", name: "i32" }], result: { kind: "scalar", name: "i32" } },
    { params: [{ kind: "scalar", name: "u32" }], result: { kind: "scalar", name: "u32" } },
  ],
  extract: [
    { params: [{ kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }], result: { kind: "scalar", name: "i32" } },
  ],
  insert: [
    { params: [{ kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }], result: { kind: "scalar", name: "i32" } },
  ],
  reverse: [
    { params: [{ kind: "scalar", name: "i32" }], result: { kind: "scalar", name: "i32" } },
    { params: [{ kind: "scalar", name: "u32" }], result: { kind: "scalar", name: "u32" } },
  ],
};

/**
 * Attempts to match call arguments against a single function signature,
 * concretifying abstract literals where possible.
 *
 * @param args - The call argument expressions.
 * @param ctx - The type-checking context.
 * @param sig - The signature to match against.
 * @returns The matched argument types if successful, or null if the signature does not match.
 */
function matchArgsAgainstSignature(args: Expression[], ctx: TypeCheckContext, sig: { params: Type[]; result: Type }): { ok: boolean; types: Type[] } | null {
  if (args.length !== sig.params.length) return null;
  const types: Type[] = [];
  for (let i = 0; i < args.length; i++) {
    const expected = sig.params[i]!;
    const concretized = concretify(ctx, args[i]!, expected);
    if (!concretized) return null;
    types.push(concretized.type);
    if (typesDiffer(concretized.type, expected)) {
      return null;
    }
  }
  return { ok: true, types };
}

/**
 * Type-checks a call to a built-in function.
 *
 * @param ctx - The type-checking context.
 * @param name - The built-in function name.
 * @param args - The call arguments.
 * @param span - The source span for diagnostic reporting.
 * @returns The result type if the built-in call matches a signature, or null if not found.
 */
function checkBuiltinCall(
  ctx: TypeCheckContext,
  name: string,
  args: Expression[],
  span: Span
): Type | null {
  const sigs = BUILTIN_SIGNATURES[name];
  if (!sigs) return null;

  for (const sig of sigs) {
    const matched = matchArgsAgainstSignature(args, ctx, sig);
    if (matched) return sig.result;
  }

  const paramList = sigs.map((s) => s.params.map(typeName).join(", ")).join(" | ");
  ctx.diagnostics.push({
    file: ctx.file,
    span,
    message: `No matching built-in '${name}(${args.map(() => "?").join(", ")})'; expected signatures: ${paramList}`,
  });
  return { kind: "scalar", name: "f32" };
}

/**
 * Type-checks a call to a user-defined function.
 *
 * @param ctx - The type-checking context.
 * @param fn - The function declaration being called.
 * @param args - The call arguments.
 * @param span - The source span for diagnostic reporting.
 * @returns The function's return type.
 */
function checkUserCall(
  ctx: TypeCheckContext,
  fn: FnDecl,
  args: Expression[],
  span: Span
): Type {
  if (args.length !== fn.params.length) {
    ctx.diagnostics.push({
      file: ctx.file,
      span,
      message: `Function '${fn.name}' expects ${fn.params.length} arguments, got ${args.length}`,
    });
    return fn.returnType;
  }
  for (let i = 0; i < args.length; i++) {
    const param = fn.params[i]!;
    const arg = args[i]!;
    const concretized = concretify(ctx, arg, param.type);
    if (!concretized) {
      ctx.diagnostics.push({
        file: ctx.file,
        span: arg.span,
        message: `Argument ${i + 1} to '${fn.name}' cannot be converted to ${typeName(param.type)}`,
      });
      continue;
    }
    if (typesDiffer(concretized.type, param.type)) {
      ctx.diagnostics.push({
        file: ctx.file,
        span: arg.span,
        message: `Argument ${i + 1} to '${fn.name}' expects ${typeName(param.type)}, got ${typeName(concretized.type)}`,
      });
    }
  }
  return fn.returnType;
}

/**
 * Type-checks a parsed program and returns diagnostics.
 *
 * @param program - The parsed Program AST to type-check.
 * @param file - The source file name (used in diagnostic messages).
 * @returns An object containing the collected diagnostics.
 */
export function typeCheck(program: Program, file: string): { diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const structs = new Map<string, StructDecl>();
  const functions = new Map<string, FnDecl>();
  const bindings = new Map<number, BindingDecl>();

  // First pass: collect struct, function, and binding declarations
  for (const stmt of program.statements) {
    if (isStructDecl(stmt)) {
      if (structs.has(stmt.name)) {
        diagnostics.push({
          file,
          span: stmt.span,
          message: `Duplicate struct definition '${stmt.name}'`,
        });
      }
      structs.set(stmt.name, stmt);
      for (const field of stmt.fields) {
        if (containsSampler(field.type)) {
          diagnostics.push({
            file,
            span: stmt.span,
            message: `Struct field '${field.name}' cannot have sampler type '${typeName(field.type)}'`,
          });
        }
      }
    }
    if (isFnDecl(stmt)) {
      if (functions.has(stmt.name)) {
        diagnostics.push({
          file,
          span: stmt.span,
          message: `Duplicate function definition '${stmt.name}'`,
        });
      }
      functions.set(stmt.name, stmt);
      for (const param of stmt.params) {
        if (containsSampler(param.type)) {
          diagnostics.push({
            file,
            span: stmt.span,
            message: `Function parameter '${param.name}' cannot have sampler type '${typeName(param.type)}'`,
          });
        }
      }
      if (containsSampler(stmt.returnType)) {
        diagnostics.push({
          file,
          span: stmt.span,
          message: `Function '${stmt.name}' cannot return sampler type '${typeName(stmt.returnType)}'`,
        });
      }
    }
    if (isBindingDecl(stmt)) {
      if (bindings.has(stmt.binding)) {
        diagnostics.push({
          file,
          span: stmt.span,
          message: `Duplicate binding slot ${stmt.binding}`,
        });
      }
      bindings.set(stmt.binding, stmt);
    }
    // EnumDecl, TypeAlias, ImplBlock, TraitDecl, NewtypeDecl, OpaqueDecl
    // are collected in the global scope below
  }

  const globalScope = makeScope(null);

  // Define structs, functions, and bindings in global scope
  for (const [name, decl] of structs) {
    defineGlobal(globalScope, { name, type: { kind: "struct", name: decl.name }, kind: "struct", span: decl.span });
  }
  for (const [name, decl] of functions) {
    defineGlobal(globalScope, { name, type: decl.returnType, kind: "function", span: decl.span });
  }
  for (const [, decl] of bindings) {
    if (decl.name) {
      defineGlobal(globalScope, { name: decl.name, type: decl.type, kind: "binding", span: decl.span });
    }
  }
  // Define enums, aliases, impls, traits in global scope
  for (const stmt of program.statements) {
    if (stmt.kind === "EnumDecl") {
      defineGlobal(globalScope, { name: stmt.name, type: { kind: "enum", name: stmt.name }, kind: "struct", span: stmt.span });
    }
    if (stmt.kind === "TypeAlias") {
      defineGlobal(globalScope, { name: stmt.name, type: stmt.type, kind: "struct", span: stmt.span });
    }
    if (stmt.kind === "NewtypeDecl") {
      defineGlobal(globalScope, { name: stmt.name, type: stmt.innerType, kind: "struct", span: stmt.span });
    }
    if (stmt.kind === "OpaqueDecl") {
      defineGlobal(globalScope, { name: stmt.name, type: { kind: "opaque", name: stmt.name }, kind: "struct", span: stmt.span });
    }
  }

  const ctx: TypeCheckContext = {
    file,
    scope: globalScope,
    diagnostics,
    structs,
    functions,
    bindings,
    currentFnReturnType: null,
  };

  // Type check each function body
  for (const stmt of program.statements) {
    if (isFnDecl(stmt)) {
      typeCheckFunction(ctx, stmt);
    }
  }

  return { diagnostics };
}

/**
 * Defines a symbol in the global scope.
 *
 * @param scope - The scope to define the symbol in.
 * @param symbol - The symbol to define.
 */
function defineGlobal(scope: Scope, symbol: Symbol): void {
  scope.symbols.set(symbol.name, symbol);
}

/**
 * Type-checks a function declaration, creating a new scope for its parameters
 * and body.
 *
 * @param ctx - The type-checking context.
 * @param fn - The function declaration to type-check.
 */
function typeCheckFunction(ctx: TypeCheckContext, fn: FnDecl): void {
  const fnScope = makeScope(ctx.scope);
  const prevScope = ctx.scope;
  const prevReturn = ctx.currentFnReturnType;
  ctx.scope = fnScope;
  ctx.currentFnReturnType = fn.returnType;

  // Stage-specific entry-point signature validation for `main`.
  if (fn.name === "main" && fn.stage) {
    if (fn.params.length > 0) {
      ctx.diagnostics.push({
        file: ctx.file,
        span: fn.span,
        message: `main for stage '${fn.stage}' must take no parameters`,
        severity: "error",
      });
    }
    if (fn.stage === "fragment") {
      if (!isVector(fn.returnType) || fn.returnType.size !== 4) {
        if (!(isStructType(fn.returnType))) {
          ctx.diagnostics.push({
            file: ctx.file,
            span: fn.span,
            message: `fragment main must return vec4 or a struct, got ${typeName(fn.returnType)}`,
            severity: "error",
          });
        }
      }
    } else if (fn.stage === "vertex") {
      if (!isVector(fn.returnType) || fn.returnType.size !== 4) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: fn.span,
          message: `vertex main must return vec4 (position), got ${typeName(fn.returnType)}`,
          severity: "error",
        });
      }
    } else if (fn.stage === "compute") {
      // Compute main does not return a meaningful value to the pipeline.
    }
  }

  for (const param of fn.params) {
    define(ctx, {
      name: param.name,
      type: param.type,
      kind: "variable",
      span: { line: 0, column: 0 },
    });
  }

  typeCheckBlock(ctx, fn.body);

  ctx.scope = prevScope;
  ctx.currentFnReturnType = prevReturn;
}

/**
 * Type-checks all statements within a block, creating a new child scope.
 *
 * @param ctx - The type-checking context.
 * @param block - The block whose statements to type-check.
 */
function typeCheckBlock(ctx: TypeCheckContext, block: Block): void {
  const blockScope = makeScope(ctx.scope);
  const prevScope = ctx.scope;
  ctx.scope = blockScope;
  for (const stmt of block.statements) {
    typeCheckStatement(ctx, stmt);
  }
  ctx.scope = prevScope;
}

/**
 * Type-checks a single statement within the given context.
 *
 * @param ctx - The type-checking context.
 * @param stmt - The statement to type-check.
 */
function typeCheckStatement(ctx: TypeCheckContext, stmt: Statement): void {
  visitStatement(stmt, {
    visitVarDecl: (node) => {
      if (containsSampler(node.type)) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: node.span,
          message: `Sampler type '${typeName(node.type)}' can only appear in a binding declaration`,
        });
      }
      let initType: Type | null = null;
      if (node.initializer) {
        if (node.initializer.kind === "StructLiteral" && !node.initializer.typeName &&
            isStructType(node.type)) {
          node.initializer.typeName = node.type.name;
        }
        const concretized = concretify(ctx, node.initializer, node.type);
        if (!concretized) {
          ctx.diagnostics.push({
            file: ctx.file,
            span: node.span,
            message: `Variable '${node.name}' cannot be initialized with a value of type ${typeName(node.type)}`,
          });
        } else {
          initType = concretized.type;
          if (typesDiffer(initType, node.type)) {
            ctx.diagnostics.push({
              file: ctx.file,
              span: node.span,
              message: `Variable '${node.name}' expects ${typeName(node.type)}, got ${typeName(initType)}`,
            });
          }
        }
      }
      define(ctx, { name: node.name, type: node.type, kind: "variable", span: node.span });
    },
    visitReturnStmt: (node) => {
      if (node.value) {
        if (node.value.kind === "StructLiteral" && !node.value.typeName &&
            isStructType(ctx.currentFnReturnType!)) {
          node.value.typeName = ctx.currentFnReturnType!.name;
        }
        const concretized = concretify(ctx, node.value, ctx.currentFnReturnType!);
        if (!concretized) {
          ctx.diagnostics.push({
            file: ctx.file,
            span: node.span,
            message: `Return value cannot be converted to ${typeName(ctx.currentFnReturnType!)}`,
          });
        } else if (ctx.currentFnReturnType && typesDiffer(concretized.type, ctx.currentFnReturnType)) {
          ctx.diagnostics.push({
            file: ctx.file,
            span: node.span,
            message: `Return type ${typeName(concretized.type)} does not match function return type ${typeName(ctx.currentFnReturnType)}`,
          });
        }
      } else if (ctx.currentFnReturnType) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: node.span,
          message: `Missing return value; function expects ${typeName(ctx.currentFnReturnType)}`,
        });
      }
    },
    visitExpressionStmt: (node) => {
      typeOf(ctx, node.expression);
    },
    visitBlock: (node) => {
      typeCheckBlock(ctx, node);
    },
    visitIfStmt: (node) => {
      const condType = typeOf(ctx, node.condition);
      if (!isScalar(condType) || condType.name !== "bool") {
        ctx.diagnostics.push({
          file: ctx.file,
          span: stmt.span,
          message: `If condition must be bool, got ${typeName(condType)}`,
        });
      }
      typeCheckBlock(ctx, node.thenBranch);
      if (node.elseBranch) {
        typeCheckBlock(ctx, node.elseBranch);
      }
    },
    visitWhileStmt: (node) => {
      const condType = typeOf(ctx, node.condition);
      if (!isScalar(condType) || condType.name !== "bool") {
        ctx.diagnostics.push({
          file: ctx.file,
          span: stmt.span,
          message: `While condition must be bool, got ${typeName(condType)}`,
        });
      }
      typeCheckBlock(ctx, node.body);
    },
    visitForStmt: (node) => {
      if (node.range) {
        const startType = typeOf(ctx, node.range.start);
        typeOf(ctx, node.range.end);
        if (node.body.statements.length > 0) {
          const blockScope = makeScope(ctx.scope);
          blockScope.symbols.set("", { name: "", type: startType, kind: "variable", span: node.span });
          const prevScope = ctx.scope;
          ctx.scope = blockScope;
          typeCheckBlock(ctx, node.body);
          ctx.scope = prevScope;
        }
      } else {
        if (node.init) {
          if (isVarDecl(node.init)) {
            typeCheckStatement(ctx, node.init);
          } else if (isExpressionStmt(node.init)) {
            typeOf(ctx, node.init.expression);
          }
        }
        if (node.condition) {
          const condType = typeOf(ctx, node.condition);
          if (!isScalar(condType) || condType.name !== "bool") {
            ctx.diagnostics.push({
              file: ctx.file,
              span: stmt.span,
              message: `For condition must be bool, got ${typeName(condType)}`,
            });
          }
        }
        if (node.increment) {
          typeOf(ctx, node.increment);
        }
        typeCheckBlock(ctx, node.body);
      }
    },
    visitDoWhileStmt: (node) => {
      typeCheckBlock(ctx, node.body);
      const condType = typeOf(ctx, node.condition);
      if (!isScalar(condType) || condType.name !== "bool") {
        ctx.diagnostics.push({
          file: ctx.file,
          span: stmt.span,
          message: `Do-while condition must be bool, got ${typeName(condType)}`,
        });
      }
    },
    visitLoopStmt: (node) => {
      typeCheckBlock(ctx, node.body);
    },
    visitBreakStmt: () => {},
    visitContinueStmt: () => {},
    visitPanicStmt: (node) => {
      if (node.message) {
        typeOf(ctx, node.message);
      }
    },
    visitUnreachableStmt: () => {},
    visitDiscardStmt: () => {},
    visitStructDecl: () => {},
    visitFnDecl: () => {},
    visitBindingDecl: () => {},
    visitEnumDecl: () => {},
    visitImplBlock: () => {},
    visitTraitDecl: () => {},
    visitTypeAlias: () => {},
    visitNewtypeDecl: () => {},
    visitOpaqueDecl: () => {},
    visitImportDecl: () => {},
  });
}
