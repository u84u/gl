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
  ArrayLiteral,
} from "./types";

export interface Diagnostic {
  file: string;
  span: Span;
  message: string;
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
  switch (t.kind) {
    case "abstractInt": return "abstract int";
    case "abstractFloat": return "abstract float";
    case "scalar": return t.name;
    case "vector": return `vec${t.size}`;
    case "matrix": return `mat${t.rows}x${t.columns}`;
    case "struct": return t.name;
    case "enum": return `enum ${t.name}`;
    case "sampler": return t.name;
    case "array": return `${typeName(t.element)}[${t.size}]`;
    case "quaternion": return "quat";
    case "tuple": return `(${t.elements.map(typeName).join(", ")})`;
    case "option": return `Option<${typeName(t.element)}>`;
    case "result": return `Result<${typeName(t.ok)}, ${typeName(t.err)}>`;
    case "alias": return t.name;
    case "opaque": return `opaque ${t.name}`;
    case "anonymousStruct": return `{ ${t.fields.map(f => `${f.name}: ${typeName(f.type)}`).join(", ")} }`;
    case "union": return t.members.map(typeName).join(" | ");
  }
}

/**
 * Checks whether a type is a sampler type.
 *
 * @param t - The type to check.
 * @returns true if the type is a sampler, false otherwise.
 */
function isSamplerType(t: Type): boolean {
  return t.kind === "sampler";
}

/**
 * Checks whether a type (or any nested type within it) contains a sampler.
 *
 * @param t - The type to check.
 * @returns true if a sampler is found anywhere in the type structure.
 */
function containsSampler(t: Type): boolean {
  if (isSamplerType(t)) return true;
  if (t.kind === "array") return containsSampler(t.element);
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
  if (abstractType.kind === "abstractInt") {
    if (targetType.kind === "scalar") {
      return targetType;
    }
    if (targetType.kind === "vector") {
      return { kind: "scalar", name: targetType.element === "bool" ? "i32" : targetType.element };
    }
    throw new Error(`Cannot concretize abstract int to ${typeName(targetType)}`);
  }
  if (abstractType.kind === "abstractFloat") {
    if (targetType.kind === "scalar" && targetType.name !== "bool" && targetType.name !== "i32" && targetType.name !== "u32" && targetType.name !== "i64" && targetType.name !== "u64") {
      return targetType;
    }
    if (targetType.kind === "vector" && targetType.element !== "bool" && targetType.element !== "i32" && targetType.element !== "u32" && targetType.element !== "i64" && targetType.element !== "u64") {
      return { kind: "scalar", name: targetType.element };
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
  expectedType: Type
): { expr: Expression; type: Type } | null {
  const type = typeOf(ctx, expr);
  if ((type.kind === "abstractInt" || type.kind === "abstractFloat") &&
      expectedType.kind !== "abstractInt" && expectedType.kind !== "abstractFloat") {
    let concretized: Type;
    try {
      concretized = concretize(type, expectedType);
    } catch {
      return null;
    }
    return { expr, type: concretized };
  }
  // Array concretization: concretize array elements against expected element type
  if (type.kind === "array" && expectedType.kind === "array" &&
      (type.element.kind === "abstractInt" || type.element.kind === "abstractFloat") &&
      expectedType.element.kind !== "abstractInt" && expectedType.element.kind !== "abstractFloat") {
    const arr = expr as ArrayLiteral;
    const newElements = arr.elements.map((e) => {
      const result = concretify(ctx, e, expectedType.element);
      return result ? result.expr : e;
    });
    const concretizedType: Type = { kind: "array", element: expectedType.element, size: type.size };
    return { expr: { ...arr, elements: newElements } as ArrayLiteral, type: concretizedType };
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
  if (expr.kind === "Identifier") {
    const sym = lookup(ctx, expr.name);
    if (!sym) {
      ctx.diagnostics.push({
        file: ctx.file,
        span: expr.span,
        message: `Undeclared identifier '${expr.name}'`,
      });
      return { kind: "scalar", name: "f32" };
    }
    return sym.type;
  }
  if (expr.kind === "Literal") {
    if (expr.literalKind === "bool") return { kind: "scalar", name: "bool" };
    if (expr.literalKind === "int") return { kind: "abstractInt" };
    if (expr.literalKind === "float") return { kind: "abstractFloat" };
    if (expr.literalKind === "char") return { kind: "scalar", name: "i32" };
    if (expr.literalKind === "color") return { kind: "scalar", name: "u32" };
    return { kind: "scalar", name: "f32" };
  }
  if (expr.kind === "BinaryExpr") {
    const left = typeOf(ctx, expr.left);
    const right = typeOf(ctx, expr.right);
    return checkBinaryOp(ctx, left, right, expr.operator, expr.span);
  }
  if (expr.kind === "UnaryExpr") {
    const operand = typeOf(ctx, expr.operand);
    return checkUnaryOp(ctx, operand, expr.operator, expr.span);
  }
  if (expr.kind === "CallExpr") {
    const callee = expr.callee;
    if (callee.kind !== "Identifier") {
      ctx.diagnostics.push({
        file: ctx.file,
        span: expr.span,
        message: "Cannot call non-identifier expression",
      });
      return { kind: "scalar", name: "f32" };
    }
    const sym = lookup(ctx, callee.name);
    if (!sym) {
      const builtin = checkBuiltinCall(ctx, callee.name, expr.args, expr.span);
      if (builtin) return builtin;
      ctx.diagnostics.push({
        file: ctx.file,
        span: expr.span,
        message: `Undeclared function '${callee.name}'`,
      });
      return { kind: "scalar", name: "f32" };
    }
    if (sym.kind !== "function") {
      ctx.diagnostics.push({
        file: ctx.file,
        span: expr.span,
        message: `Not a function: ${callee.name}`,
      });
      return { kind: "scalar", name: "f32" };
    }
    const fnDecl = ctx.functions.get(callee.name);
    if (!fnDecl) {
      ctx.diagnostics.push({
        file: ctx.file,
        span: expr.span,
        message: `Function '${callee.name}' not found`,
      });
      return { kind: "scalar", name: "f32" };
    }
    return checkUserCall(ctx, fnDecl, expr.args, expr.span);
  }
  if (expr.kind === "MemberExpr") {
    const objectType = typeOf(ctx, expr.object);
    if (objectType.kind === "struct") {
      const structDecl = ctx.structs.get(objectType.name);
      if (!structDecl) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: expr.span,
          message: `Unknown struct '${objectType.name}'`,
        });
        return { kind: "scalar", name: "f32" };
      }
      const field = structDecl.fields.find((f) => f.name === expr.property);
      if (!field) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: expr.span,
          message: `Struct '${objectType.name}' has no field '${expr.property}'`,
        });
        return { kind: "scalar", name: "f32" };
      }
      return field.type;
    }
    if (objectType.kind === "vector") {
      if (expr.property.length === 1 && SWIZZLE_VALID.has(expr.property)) {
      return { kind: "scalar", name: objectType.element! };
      }
    }
    if (expr.property.length >= 1 && expr.property.length <= 4) {
      const allValid = expr.property.split("").every((c) => SWIZZLE_VALID.has(c));
      if (allValid) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: expr.span,
          message: `Cannot swizzle non-vector type ${typeName(objectType)}`,
        });
        return { kind: "scalar", name: "f32" };
      }
    }
    ctx.diagnostics.push({
      file: ctx.file,
      span: expr.span,
      message: `Cannot access field '${expr.property}' on non-struct type ${typeName(objectType)}`,
    });
    return { kind: "scalar", name: "f32" };
  }
  if (expr.kind === "SwizzleExpr") {
    const objectType = typeOf(ctx, expr.object);
    if (objectType.kind !== "vector") {
      ctx.diagnostics.push({
        file: ctx.file,
        span: expr.span,
        message: `Cannot swizzle non-vector type ${typeName(objectType)}`,
      });
      return { kind: "scalar", name: "f32" };
    }
    const components = expr.components;
    const allValid = components.every((c) => SWIZZLE_VALID.has(c));
    if (!allValid) {
      ctx.diagnostics.push({
        file: ctx.file,
        span: expr.span,
        message: `Cannot access field '${components.join("")}' on non-struct type ${typeName(objectType)}`,
      });
      return { kind: "scalar", name: "f32" };
    }
    // Check for mixing xyzw and rgba components
    const xyzw = new Set("xyzw");
    const rgba = new Set("rgba");
    const usesXYZW = components.some((c) => xyzw.has(c));
    const usesRGBA = components.some((c) => rgba.has(c));
    if (usesXYZW && usesRGBA) {
      ctx.diagnostics.push({
        file: ctx.file,
        span: expr.span,
        message: "Cannot mix xyzw and rgba swizzle components",
      });
      return { kind: "scalar", name: "f32" };
    }
    // Check swizzle length against vector size
    if (components.length > objectType.size) {
      ctx.diagnostics.push({
        file: ctx.file,
        span: expr.span,
        message: `Swizzle of length ${components.length} on ${typeName(objectType)}`,
      });
      return { kind: "scalar", name: "f32" };
    }
    if (components.length === 1) {
      return { kind: "scalar", name: objectType.element! };
    }
    return { kind: "vector", element: objectType.element!, size: components.length as 2 | 3 | 4 };
  }
  if (expr.kind === "IndexExpr") {
    const objectType = typeOf(ctx, expr.object);
    const indexType = typeOf(ctx, expr.index);
    if (!(indexType.kind === "scalar" && indexType.name === "i32") && indexType.kind !== "abstractInt") {
      ctx.diagnostics.push({
        file: ctx.file,
        span: expr.index.span,
        message: `Array index must be i32, got ${typeName(indexType)}`,
      });
    }
    if (objectType.kind === "array") {
      return objectType.element;
    }
    if (objectType.kind === "vector") {
      return { kind: "scalar", name: objectType.element! };
    }
    ctx.diagnostics.push({
      file: ctx.file,
      span: expr.span,
      message: `Cannot index non-array type ${typeName(objectType)}`,
    });
    return { kind: "scalar", name: "f32" };
  }
  if (expr.kind === "StructLiteral") {
    const structDecl = ctx.structs.get(expr.typeName);
    if (!structDecl) {
      ctx.diagnostics.push({
        file: ctx.file,
        span: expr.span,
        message: `Unknown struct '${expr.typeName}'`,
      });
      return { kind: "scalar", name: "f32" };
    }
    const declaredFields = new Map(structDecl.fields.map((f) => [f.name, f.type]));
    const seenFields = new Set<string>();
    for (const field of expr.fields) {
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
          message: `Struct '${expr.typeName}' has no field '${field.name}'`,
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
          span: expr.span,
          message: `Missing field '${name}' in struct literal for '${expr.typeName}'`,
        });
      }
    }
    return { kind: "struct", name: expr.typeName };
  }
  if (expr.kind === "ArrayLiteral") {
    const elements = expr.elements;
    if (elements.length === 0) {
      ctx.diagnostics.push({
        file: ctx.file,
        span: expr.span,
        message: "Array literal must have at least one element",
      });
      return { kind: "scalar", name: "f32" };
    }
    // Infer element type from the first element
    const firstType = typeOf(ctx, elements[0]!);
    // All elements must match the first element's type
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
  }
  if (expr.kind === "CompoundAssignExpr") {
    const targetType = typeOf(ctx, expr.target);
    const concretized = concretify(ctx, expr.value, targetType);
    const valueType = concretized ? concretized.type : typeOf(ctx, expr.value);
    const arithOps = new Set(["+=", "-=", "*=", "/=", "%="]);
    const bitwiseOps = new Set(["&=", "|=", "^=", "<<=", ">>="]);
    if (arithOps.has(expr.operator)) {
      if (!concretized || typesDiffer(targetType, valueType)) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: expr.span,
          message: `Compound assignment '${expr.operator}' requires same-type operands, got ${typeName(targetType)} and ${typeName(valueType)}`,
        });
      }
      return targetType;
    }
    if (bitwiseOps.has(expr.operator)) {
      if ((targetType.kind === "scalar" && (targetType.name === "i32" || targetType.name === "u32" || targetType.name === "i64" || targetType.name === "u64")) ||
          (targetType.kind === "vector" && (targetType.element === "i32" || targetType.element === "u32" || targetType.element === "i64" || targetType.element === "u64"))) {
        return targetType;
      }
      ctx.diagnostics.push({
        file: ctx.file,
        span: expr.span,
        message: `Bitwise compound assignment '${expr.operator}' requires integer operands`,
      });
      return targetType;
    }
    return targetType;
  }
  if (expr.kind === "UpdateExpr") {
    const operandType = typeOf(ctx, expr.operand);
    if ((operandType.kind === "scalar" && (operandType.name === "i32" || operandType.name === "u32" || operandType.name === "i64" || operandType.name === "u64" || operandType.name === "f32" || operandType.name === "f64")) ||
        operandType.kind === "vector") {
      return operandType;
    }
    ctx.diagnostics.push({
      file: ctx.file,
      span: expr.span,
      message: `Increment/decrement requires numeric operand, got ${typeName(operandType)}`,
    });
    return operandType;
  }
  if (expr.kind === "ConditionalExpr") {
    const testType = typeOf(ctx, expr.test);
    if (testType.kind !== "scalar" || testType.name !== "bool") {
      ctx.diagnostics.push({
        file: ctx.file,
        span: expr.test.span,
        message: `Ternary condition must be bool, got ${typeName(testType)}`,
      });
    }
    const consequentType = typeOf(ctx, expr.consequent);
    const alternateType = typeOf(ctx, expr.alternate);
    if (typesDiffer(consequentType, alternateType)) {
      ctx.diagnostics.push({
        file: ctx.file,
        span: expr.span,
        message: `Ternary branches must have same type, got ${typeName(consequentType)} and ${typeName(alternateType)}`,
      });
    }
    return consequentType;
  }
  if (expr.kind === "NullCoalescingExpr") {
    const leftType = typeOf(ctx, expr.left);
    const rightType = typeOf(ctx, expr.right);
    if (typesDiffer(leftType, rightType)) {
      ctx.diagnostics.push({
        file: ctx.file,
        span: expr.span,
        message: `Null coalescing branches must have same type, got ${typeName(leftType)} and ${typeName(rightType)}`,
      });
    }
    return leftType;
  }
  if (expr.kind === "MatchExpr") {
    let resultType: Type | null = null;
    for (const arm of expr.arms) {
      if (arm.guard) {
        const guardType = typeOf(ctx, arm.guard);
        if (guardType.kind !== "scalar" || guardType.name !== "bool") {
          ctx.diagnostics.push({
            file: ctx.file,
            span: arm.guard.span,
            message: `Match guard must be bool, got ${typeName(guardType)}`,
          });
        }
      }
      const lastStmt = arm.body.statements[arm.body.statements.length - 1];
      if (lastStmt && lastStmt.kind === "ExpressionStmt") {
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
  }
  if (expr.kind === "BlockExpr") {
    const lastStmt = expr.block.statements[expr.block.statements.length - 1];
    if (lastStmt && lastStmt.kind === "ExpressionStmt") {
      return typeOf(ctx, lastStmt.expression);
    }
    // Type check all statements for side effects
    for (const stmt of expr.block.statements) {
      typeCheckStatement(ctx, stmt);
    }
    return { kind: "scalar", name: "f32" };
  }
  return { kind: "scalar", name: "f32" };
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
      return a.name !== (b as Extract<Type, { kind: "scalar" }>).name;
    case "vector":
      return a.size !== (b as Extract<Type, { kind: "vector" }>).size ||
        a.element !== (b as Extract<Type, { kind: "vector" }>).element;
    case "matrix": {
      const am = a as Extract<Type, { kind: "matrix" }>;
      const bm = b as Extract<Type, { kind: "matrix" }>;
      return am.rows !== bm.rows || am.columns !== bm.columns || am.element !== bm.element;
    }
    case "struct":
      return a.name !== (b as Extract<Type, { kind: "struct" }>).name;
    case "sampler":
      return a.name !== (b as Extract<Type, { kind: "sampler" }>).name;
    case "array": {
      const am = a as Extract<Type, { kind: "array" }>;
      const bm = b as Extract<Type, { kind: "array" }>;
      return am.size !== bm.size || typesDiffer(am.element, bm.element);
    }
    case "quaternion":
      return false;
    default:
      return false;
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
  if (lt.kind === "abstractInt" || lt.kind === "abstractFloat") {
    if (rt.kind !== "abstractInt" && rt.kind !== "abstractFloat") {
      lt = concretize(lt, rt);
    }
  }
  if (rt.kind === "abstractInt" || rt.kind === "abstractFloat") {
    if (lt.kind !== "abstractInt" && lt.kind !== "abstractFloat") {
      rt = concretize(rt, lt);
    }
  }

  if (ARITH_OPS.has(operator)) {
    // Concretize abstract literals against each other or concrete types
    if (lt.kind === "abstractInt" || lt.kind === "abstractFloat") {
      if (rt.kind !== "abstractInt" && rt.kind !== "abstractFloat") {
        lt = concretize(lt, rt);
      }
    }
    if (rt.kind === "abstractInt" || rt.kind === "abstractFloat") {
      if (lt.kind !== "abstractInt" && lt.kind !== "abstractFloat") {
        rt = concretize(rt, lt);
      }
    }

    // Both abstract int
    if (lt.kind === "abstractInt" && rt.kind === "abstractInt") {
      return { kind: "abstractInt" };
    }
    // Both abstract float
    if (lt.kind === "abstractFloat" && rt.kind === "abstractFloat") {
      return { kind: "abstractFloat" };
    }

    // Vector + scalar broadcast
    if (lt.kind === "vector" || rt.kind === "vector") {
      const vec = (lt.kind === "vector" ? lt : rt) as Extract<Type, { kind: "vector" }>;
      const scalar = (lt.kind === "vector" ? rt : lt) as Extract<Type, { kind: "scalar" }>;
      if (scalar.name === vec.element) {
        return vec;
      }
    }

    // Same concrete scalar type
    if (lt.kind === "scalar" && rt.kind === "scalar" && lt.name === rt.name) {
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
    // Both abstract int
    if (lt.kind === "abstractInt" && rt.kind === "abstractInt") {
      return { kind: "abstractInt" };
    }
    const isInt = (t: Type) => t.kind === "scalar" && INT_TYPES.has(t.name);
    const isIntVec = (t: Type) => t.kind === "vector" && INT_TYPES.has(t.element);
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
    if (lt.kind !== "scalar" || lt.name !== "bool" || rt.kind !== "scalar" || rt.name !== "bool") {
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
    if (operand.kind === "abstractInt" || operand.kind === "abstractFloat") {
      return operand;
    }
    if ((operand.kind === "scalar" && (operand.name === "i32" || operand.name === "f32" || operand.name === "i64" || operand.name === "f64" || operand.name === "f16" || operand.name === "bf16" || operand.name === "i8" || operand.name === "u8" || operand.name === "i16" || operand.name === "u16")) ||
        operand.kind === "vector") {
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
    if (operand.kind === "scalar" && operand.name === "bool") {
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
    if (operand.kind === "abstractInt") {
      return { kind: "abstractInt" };
    }
    if (operand.kind === "scalar" && INT_TYPES.has(operand.name)) {
      return operand;
    }
    if (operand.kind === "vector" && INT_TYPES.has(operand.element!)) {
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
    { params: [{ kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }, { kind: "scalar", name: "f64" }], result: { kind: "matrix", element: "f64", rows: 4, columns: 4 } },
  ],
  imat2: [
    { params: [{ kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }], result: { kind: "matrix", element: "i32", rows: 2, columns: 2 } },
  ],
  imat3: [
    { params: [{ kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }], result: { kind: "matrix", element: "i32", rows: 3, columns: 3 } },
  ],
  imat4: [
    { params: [{ kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }, { kind: "scalar", name: "i32" }], result: { kind: "matrix", element: "i32", rows: 4, columns: 4 } },
  ],
  umat2: [
    { params: [{ kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }], result: { kind: "matrix", element: "u32", rows: 2, columns: 2 } },
  ],
  umat3: [
    { params: [{ kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }], result: { kind: "matrix", element: "u32", rows: 3, columns: 3 } },
  ],
  umat4: [
    { params: [{ kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }, { kind: "scalar", name: "u32" }], result: { kind: "matrix", element: "u32", rows: 4, columns: 4 } },
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
    if (stmt.kind === "StructDecl") {
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
    if (stmt.kind === "FnDecl") {
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
    if (stmt.kind === "BindingDecl") {
      if (bindings.has(stmt.binding)) {
        diagnostics.push({
          file,
          span: stmt.span,
          message: `Duplicate binding slot ${stmt.binding}`,
        });
      }
      bindings.set(stmt.binding, stmt);
    }
    if (stmt.kind === "EnumDecl") {
      // Enum declarations collected in global scope above
    }
    if (stmt.kind === "TypeAlias") {
      // Type aliases collected in global scope above
    }
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
    if (stmt.kind === "FnDecl") {
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
  switch (stmt.kind) {
    case "VarDecl": {
      if (containsSampler(stmt.type)) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: stmt.span,
          message: `Sampler type '${typeName(stmt.type)}' can only appear in a binding declaration`,
        });
      }
      let initType: Type | null = null;
      if (stmt.initializer) {
        if (stmt.initializer.kind === "StructLiteral" && !stmt.initializer.typeName &&
            stmt.type.kind === "struct") {
          stmt.initializer.typeName = stmt.type.name;
        }
        const concretized = concretify(ctx, stmt.initializer, stmt.type);
        if (!concretized) {
          ctx.diagnostics.push({
            file: ctx.file,
            span: stmt.span,
            message: `Variable '${stmt.name}' cannot be initialized with a value of type ${typeName(stmt.type)}`,
          });
        } else {
          initType = concretized.type;
          if (typesDiffer(initType, stmt.type)) {
            ctx.diagnostics.push({
              file: ctx.file,
              span: stmt.span,
              message: `Variable '${stmt.name}' expects ${typeName(stmt.type)}, got ${typeName(initType)}`,
            });
          }
        }
      }
      define(ctx, { name: stmt.name, type: stmt.type, kind: "variable", span: stmt.span });
      break;
    }
    case "ReturnStmt": {
      if (stmt.value) {
        if (stmt.value.kind === "StructLiteral" && !stmt.value.typeName &&
            ctx.currentFnReturnType?.kind === "struct") {
          stmt.value.typeName = ctx.currentFnReturnType.name;
        }
        const concretized = concretify(ctx, stmt.value, ctx.currentFnReturnType!);
        if (!concretized) {
          ctx.diagnostics.push({
            file: ctx.file,
            span: stmt.span,
            message: `Return value cannot be converted to ${typeName(ctx.currentFnReturnType!)}`,
          });
        } else if (ctx.currentFnReturnType && typesDiffer(concretized.type, ctx.currentFnReturnType)) {
          ctx.diagnostics.push({
            file: ctx.file,
            span: stmt.span,
            message: `Return type ${typeName(concretized.type)} does not match function return type ${typeName(ctx.currentFnReturnType)}`,
          });
        }
      } else if (ctx.currentFnReturnType) {
        ctx.diagnostics.push({
          file: ctx.file,
          span: stmt.span,
          message: `Missing return value; function expects ${typeName(ctx.currentFnReturnType)}`,
        });
      }
      break;
    }
    case "ExpressionStmt": {
      typeOf(ctx, stmt.expression);
      break;
    }
    case "Block": {
      typeCheckBlock(ctx, stmt);
      break;
    }
    case "IfStmt": {
      const condType = typeOf(ctx, stmt.condition);
      if (condType.kind !== "scalar" || condType.name !== "bool") {
        ctx.diagnostics.push({
          file: ctx.file,
          span: stmt.span,
          message: `If condition must be bool, got ${typeName(condType)}`,
        });
      }
      typeCheckBlock(ctx, stmt.thenBranch);
      if (stmt.elseBranch) {
        typeCheckBlock(ctx, stmt.elseBranch);
      }
      break;
    }
    case "WhileStmt": {
      const condType = typeOf(ctx, stmt.condition);
      if (condType.kind !== "scalar" || condType.name !== "bool") {
        ctx.diagnostics.push({
          file: ctx.file,
          span: stmt.span,
          message: `While condition must be bool, got ${typeName(condType)}`,
        });
      }
      typeCheckBlock(ctx, stmt.body);
      break;
    }
    case "ForStmt": {
      if (stmt.range) {
        const startType = typeOf(ctx, stmt.range.start);
        typeOf(ctx, stmt.range.end);
        if (stmt.body.statements.length > 0) {
          const blockScope = makeScope(ctx.scope);
          blockScope.symbols.set("", { name: "", type: startType, kind: "variable", span: stmt.span });
          const prevScope = ctx.scope;
          ctx.scope = blockScope;
          typeCheckBlock(ctx, stmt.body);
          ctx.scope = prevScope;
        }
      } else {
        if (stmt.init) {
          if (stmt.init.kind === "VarDecl") {
            typeCheckStatement(ctx, stmt.init);
          } else if (stmt.init.kind === "ExpressionStmt") {
            typeOf(ctx, stmt.init.expression);
          }
        }
        if (stmt.condition) {
          const condType = typeOf(ctx, stmt.condition);
          if (condType.kind !== "scalar" || condType.name !== "bool") {
            ctx.diagnostics.push({
              file: ctx.file,
              span: stmt.span,
              message: `For condition must be bool, got ${typeName(condType)}`,
            });
          }
        }
        if (stmt.increment) {
          typeOf(ctx, stmt.increment);
        }
        typeCheckBlock(ctx, stmt.body);
      }
      break;
    }
    case "DoWhileStmt": {
      typeCheckBlock(ctx, stmt.body);
      const condType = typeOf(ctx, stmt.condition);
      if (condType.kind !== "scalar" || condType.name !== "bool") {
        ctx.diagnostics.push({
          file: ctx.file,
          span: stmt.span,
          message: `Do-while condition must be bool, got ${typeName(condType)}`,
        });
      }
      break;
    }
    case "LoopStmt": {
      typeCheckBlock(ctx, stmt.body);
      break;
    }
    case "BreakStmt":
    case "ContinueStmt":
      break;
    case "PanicStmt": {
      if (stmt.message) {
        typeOf(ctx, stmt.message);
      }
      break;
    }
    case "UnreachableStmt":
      break;
    case "DiscardStmt":
      break;
    case "StructDecl":
    case "FnDecl":
    case "BindingDecl":
    case "EnumDecl":
    case "ImplBlock":
    case "TraitDecl":
    case "TypeAlias":
    case "NewtypeDecl":
    case "OpaqueDecl":
      // Already collected at program level or handled separately
      break;
  }
}
