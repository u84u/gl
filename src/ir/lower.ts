import {
  // Type guards (used as values)
  isScalar, isVector, isMatrix, isStructType, isSampler, isArray,
  isTuple, isOption, isResult, isAlias, isOpaque, isAnonymousStruct, isUnion,
  isAbstractInt, isAbstractFloat,
  // Statement guards
  isStructDecl, isFnDecl, isVarDecl, isReturnStmt, isExpressionStmt,
  isBlock, isIfStmt, isWhileStmt, isForStmt, isDoWhileStmt, isLoopStmt,
  isBreakStmt, isContinueStmt, isDiscardStmt, isPanicStmt,
  isUnreachableStmt, isBindingDecl, isEnumDecl,
  isTypeAlias, isNewtypeDecl, isOpaqueDecl, isTraitDecl, isImplBlock,
  // Expression guards
  isIdentifier, isLiteralOfKind, isBinaryExpr, isUnaryExpr, isCallExpr,
  isMemberExpr, isSwizzleExpr, isIndexExpr, isStructLiteral, isArrayLiteral,
  isCompoundAssignExpr, isUpdateExpr, isConditionalExpr, isNullCoalescingExpr,
  isMatchExpr, isBlockExpr,
  // Pattern guards
  isLiteralPattern, isBindingPattern, isWildcardPattern,
  // AST node types used in type annotations
  Program, Type, Expression, Statement, StructDecl, BindingDecl, EnumDecl, FnDecl,
  Block, VarDecl, ExpressionStmt, MatchArm, Pattern,
  TypeAlias, NewtypeDecl, OpaqueDecl, TraitDecl, ImplBlock,
  assertNever,
} from "../types";
import {
  IRModule, IRType, IRExpression, IRStatement, IRVarDecl, IRExpressionStmt,
  IRBlock, IRForRange, IRMatchArm, IRPattern, IRStructDecl, IRBindingDecl,
  IREnumDecl, IRFnDecl, IREntryPoint, IRScalarName, IRTypeAlias,
  IRNewtypeDecl, IROpaqueDecl, IRTraitDecl, IRImplBlock, IRSpan,
} from "./shader-ir";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function spanOf(s: { span?: { line: number; column: number } }): IRSpan | undefined {
  return s.span;
}

/* ------------------------------------------------------------------ */
/* Type lowering                                                      */
/* ------------------------------------------------------------------ */

function lowerType(t: Type, span?: IRSpan): IRType {
  const base = (kind: IRSTypeKind, extra: Record<string, unknown>): IRType =>
    ({ ...extra, kind, ...(span ? { span } : {} ) } as IRType);

  if (isScalar(t)) {
    return base("scalar", { name: t.name as IRScalarName });
  }
  if (isVector(t)) {
    return base("vector", { element: t.element as IRScalarName, size: t.size });
  }
  if (isMatrix(t)) {
    return base("matrix", {
      element: t.element as IRScalarName,
      rows: t.rows,
      columns: t.columns,
    });
  }
  if (isArray(t)) {
    return base("array", { element: lowerType(t.element), size: t.size });
  }
  if (isStructType(t)) {
    return base("struct", { name: t.name });
  }
  if (isSampler(t)) {
    return base("sampler", { name: t.name });
  }
  if (isAlias(t)) {
    return base("alias", { name: t.name });
  }
  if (isOpaque(t)) {
    return base("opaque", { name: t.name });
  }
  if (isAnonymousStruct(t)) {
    return base("anonymousStruct", {
      fields: t.fields.map((f) => ({ name: f.name, type: lowerType(f.type) })),
    });
  }
  if (isUnion(t)) {
    return base("union", { members: t.members.map((el) => lowerType(el)) });
  }
  if (isOption(t)) {
    return base("option", { element: lowerType(t.element) });
  }
  if (isResult(t)) {
    return base("result", { ok: lowerType(t.ok), err: lowerType(t.err) });
  }
  if (isTuple(t)) {
    return { kind: "tuple", elements: t.elements.map((el) => lowerType(el)), span };
  }
  if (isAbstractInt(t)) {
    return base("scalar", { name: "abstractInt" as IRScalarName });
  }
  if (isAbstractFloat(t)) {
    return base("scalar", { name: "abstractFloat" as IRScalarName });
  }
  if (t.kind === "enum") {
    return base("struct", { name: t.name });
  }
  if (t.kind === "quaternion") {
    return base("scalar", { name: "f32" });
  }
  return assertNever(t as never);
}

type IRSTypeKind =
  | "scalar" | "vector" | "matrix" | "array" | "struct" | "sampler"
  | "alias" | "opaque" | "anonymousStruct" | "union" | "option"
  | "result" | "tuple";

/* ------------------------------------------------------------------ */
/* Expression lowering                                                */
/* ------------------------------------------------------------------ */

function lowerExpression(e: Expression): IRExpression {
  if (isIdentifier(e)) {
    return { kind: "identifier", name: e.name, span: spanOf(e) };
  }
  if (isLiteralOfKind(e, "bool")) {
    return { kind: "literal", literalKind: "bool", value: e.value, span: spanOf(e) };
  }
  if (isLiteralOfKind(e, "int")) {
    return { kind: "literal", literalKind: "int", value: e.value, span: spanOf(e) };
  }
  if (isLiteralOfKind(e, "float")) {
    return { kind: "literal", literalKind: "float", value: e.value, span: spanOf(e) };
  }
  if (isLiteralOfKind(e, "char")) {
    return { kind: "literal", literalKind: "char", value: e.value, span: spanOf(e) };
  }
  if (isLiteralOfKind(e, "color")) {
    return { kind: "literal", literalKind: "color", value: e.value, span: spanOf(e) };
  }
  if (isBinaryExpr(e)) {
    return {
      kind: "binary",
      operator: e.operator,
      left: lowerExpression(e.left),
      right: lowerExpression(e.right),
      span: spanOf(e),
    };
  }
  if (isUnaryExpr(e)) {
    return { kind: "unary", operator: e.operator, operand: lowerExpression(e.operand), span: spanOf(e) };
  }
  if (isCallExpr(e)) {
    const callee =
      e.callee.kind === "Identifier" ? e.callee.name : "unknown";
    return { kind: "call", callee, args: e.args.map(lowerExpression), span: spanOf(e) };
  }
  if (isMemberExpr(e)) {
    return { kind: "member", object: lowerExpression(e.object), property: e.property, span: spanOf(e) };
  }
  if (isSwizzleExpr(e)) {
    return { kind: "swizzle", object: lowerExpression(e.object), components: e.components, span: spanOf(e) };
  }
  if (isIndexExpr(e)) {
    return { kind: "index", object: lowerExpression(e.object), index: lowerExpression(e.index), span: spanOf(e) };
  }
  if (isStructLiteral(e)) {
    return {
      kind: "structLiteral",
      typeName: e.typeName,
      fields: e.fields.map((f) => ({ name: f.name, value: lowerExpression(f.value) })),
      span: spanOf(e),
    };
  }
  if (isArrayLiteral(e)) {
    return { kind: "arrayLiteral", elements: e.elements.map(lowerExpression), span: spanOf(e) };
  }
  if (isCompoundAssignExpr(e)) {
    return {
      kind: "compoundAssign",
      operator: e.operator,
      target: lowerExpression(e.target),
      value: lowerExpression(e.value),
      span: spanOf(e),
    };
  }
  if (isUpdateExpr(e)) {
    return { kind: "update", operator: e.operator, operand: lowerExpression(e.operand), prefix: e.prefix, span: spanOf(e) };
  }
  if (isConditionalExpr(e)) {
    return {
      kind: "conditional",
      test: lowerExpression(e.test),
      consequent: lowerExpression(e.consequent),
      alternate: lowerExpression(e.alternate),
      span: spanOf(e),
    };
  }
  if (isNullCoalescingExpr(e)) {
    return { kind: "nullCoalescing", left: lowerExpression(e.left), right: lowerExpression(e.right), span: spanOf(e) };
  }
  if (isMatchExpr(e)) {
    return {
      kind: "match",
      subject: lowerExpression(e.subject),
      arms: e.arms.map(lowerMatchArm),
      span: spanOf(e),
    };
  }
  if (isBlockExpr(e)) {
    return { kind: "blockExpr", block: lowerBlock(e.block), span: spanOf(e) };
  }
  return assertNever(e as never);
}

function lowerMatchArm(arm: MatchArm): IRMatchArm {
  return {
    pattern: lowerPattern(arm.pattern),
    guard: arm.guard ? lowerExpression(arm.guard) : null,
    body: lowerBlock(arm.body),
    span: spanOf(arm),
  };
}

function lowerPattern(p: Pattern): IRPattern {
  if (isLiteralPattern(p)) {
    return { kind: "literal", value: p.value, span: spanOf(p) };
  }
  if (isBindingPattern(p)) {
    return { kind: "binding", binding: p.binding, span: spanOf(p) };
  }
  if (isWildcardPattern(p)) {
    return { kind: "wildcard", span: spanOf(p) };
  }
  return assertNever(p as never);
}

/* ------------------------------------------------------------------ */
/* Statement lowering                                                 */
/* ------------------------------------------------------------------ */

function lowerBlock(b: Block): IRBlock {
  return { kind: "block", statements: b.statements.map(lowerStatement), span: spanOf(b) };
}

function lowerStatement(s: Statement): IRStatement {
  if (isVarDecl(s)) {
    return {
      kind: "varDecl",
      name: s.name,
      type: lowerType(s.type),
      initializer: s.initializer ? lowerExpression(s.initializer) : null,
      mutable: s.mutable,
      span: spanOf(s),
    };
  }
  if (isReturnStmt(s)) {
    return { kind: "return", value: s.value ? lowerExpression(s.value) : null, span: spanOf(s) };
  }
  if (isExpressionStmt(s)) {
    return { kind: "expressionStmt", expression: lowerExpression(s.expression), span: spanOf(s) };
  }
  if (isBlock(s)) {
    return lowerBlock(s);
  }
  if (isIfStmt(s)) {
    return {
      kind: "if",
      condition: lowerExpression(s.condition),
      thenBranch: lowerBlock(s.thenBranch),
      elseBranch: s.elseBranch ? lowerBlock(s.elseBranch) : null,
      span: spanOf(s),
    };
  }
  if (isWhileStmt(s)) {
    return { kind: "while", condition: lowerExpression(s.condition), body: lowerBlock(s.body), span: spanOf(s) };
  }
  if (isForStmt(s)) {
    return {
      kind: "for",
      init: s.init ? lowerInit(s.init) : null,
      condition: s.condition ? lowerExpression(s.condition) : null,
      increment: s.increment ? lowerExpression(s.increment) : null,
      range: s.range ? lowerForRange(s.range) : null,
      body: lowerBlock(s.body),
      span: spanOf(s),
    };
  }
  if (isDoWhileStmt(s)) {
    return { kind: "doWhile", body: lowerBlock(s.body), condition: lowerExpression(s.condition), span: spanOf(s) };
  }
  if (isLoopStmt(s)) {
    return { kind: "loop", body: lowerBlock(s.body), label: s.label, span: spanOf(s) };
  }
  if (isBreakStmt(s)) {
    return { kind: "break", label: s.label, span: spanOf(s) };
  }
  if (isContinueStmt(s)) {
    return { kind: "continue", label: s.label, span: spanOf(s) };
  }
  if (isDiscardStmt(s)) {
    return { kind: "discard", span: spanOf(s) };
  }
  if (isPanicStmt(s)) {
    return { kind: "panic", message: s.message ? lowerExpression(s.message) : null, span: spanOf(s) };
  }
  if (isUnreachableStmt(s)) {
    return { kind: "unreachable", span: spanOf(s) };
  }
  return assertNever(s as never);
}

function lowerInit(init: VarDecl | ExpressionStmt): IRVarDecl | IRExpressionStmt {
  if (isVarDecl(init)) {
    return {
      kind: "varDecl",
      name: init.name,
      type: lowerType(init.type),
      initializer: init.initializer ? lowerExpression(init.initializer) : null,
      mutable: init.mutable,
      span: spanOf(init),
    };
  }
  return { kind: "expressionStmt", expression: lowerExpression(init.expression), span: spanOf(init) };
}

function lowerForRange(range: { variable: string; start: Expression; end: Expression; inclusive: boolean }): IRForRange {
  return {
    variable: range.variable,
    start: lowerExpression(range.start),
    end: lowerExpression(range.end),
    inclusive: range.inclusive,
    span: { line: 1, column: 1 },
  };
}

/* ------------------------------------------------------------------ */
/* Declaration lowering                                               */
/* ------------------------------------------------------------------ */

function lowerStructDecl(s: StructDecl): IRStructDecl {
  return {
    kind: "struct",
    name: s.name,
    fields: s.fields.map((f) => ({ name: f.name, type: lowerType(f.type) })),
    span: spanOf(s),
  };
}

function lowerBindingDecl(b: BindingDecl): IRBindingDecl {
  return { kind: "binding", binding: b.binding, name: b.name, type: lowerType(b.type), span: spanOf(b) };
}

function lowerEnumDecl(e: EnumDecl): IREnumDecl {
  return {
    kind: "enum",
    name: e.name,
    variants: e.variants.map((v) => ({
      name: v.name,
      type: v.type ? lowerType(v.type) : null,
      span: v.span,
    })),
    span: spanOf(e),
  };
}

function lowerFnDecl(f: FnDecl): IRFnDecl {
  return {
    kind: "fn",
    name: f.name,
    stage: f.stage ?? "fragment",
    params: f.params.map((p) => ({ name: p.name, type: lowerType(p.type) })),
    returnType: lowerType(f.returnType),
    body: lowerBlock(f.body),
    span: spanOf(f),
  };
}

function lowerTypeAlias(t: TypeAlias): IRTypeAlias {
  return { kind: "typeAlias", name: t.name, type: lowerType(t.type), span: spanOf(t) };
}

function lowerNewtype(n: NewtypeDecl): IRNewtypeDecl {
  return { kind: "newtype", name: n.name, innerType: lowerType(n.innerType), span: spanOf(n) };
}

function lowerOpaque(o: OpaqueDecl): IROpaqueDecl {
  return { kind: "opaqueDecl", name: o.name, span: spanOf(o) };
}

function lowerTrait(t: TraitDecl): IRTraitDecl {
  return {
    kind: "trait",
    name: t.name,
    bounds: t.bounds,
    methods: t.methods.map((m) => ({
      name: m.name,
      params: m.params.map((p) => ({ name: p.name, type: lowerType(p.type) })),
      returnType: lowerType(m.returnType),
    })),
    span: spanOf(t),
  };
}

function lowerImplBlock(i: ImplBlock): IRImplBlock {
  return {
    kind: "implBlock",
    trait: i.trait,
    type: lowerType(i.type),
    methods: i.methods.map(lowerFnDecl),
    span: spanOf(i),
  };
}

/* ------------------------------------------------------------------ */
/* Program lowering                                                   */
/* ------------------------------------------------------------------ */

export function lowerProgram(ast: Program, sourceId: string): IRModule {
  const functions: IRFnDecl[] = [];
  const structs: IRStructDecl[] = [];
  const enums: IREnumDecl[] = [];
  const bindings: IRBindingDecl[] = [];
  const typeAliases: IRTypeAlias[] = [];
  const newtypes: IRNewtypeDecl[] = [];
  const opaques: IROpaqueDecl[] = [];
  const traits: IRTraitDecl[] = [];
  const impls: IRImplBlock[] = [];
  const entryPoints: IREntryPoint[] = [];

  for (const stmt of ast.statements) {
    if (isFnDecl(stmt)) {
      const fn = lowerFnDecl(stmt);
      functions.push(fn);
      if (stmt.name === "main") {
        entryPoints.push({ stage: fn.stage, name: "main", fn });
      }
    } else if (isStructDecl(stmt)) {
      structs.push(lowerStructDecl(stmt));
    } else if (isEnumDecl(stmt)) {
      enums.push(lowerEnumDecl(stmt));
    } else if (isBindingDecl(stmt)) {
      bindings.push(lowerBindingDecl(stmt));
    } else if (isTypeAlias(stmt)) {
      typeAliases.push(lowerTypeAlias(stmt));
    } else if (isNewtypeDecl(stmt)) {
      newtypes.push(lowerNewtype(stmt));
    } else if (isOpaqueDecl(stmt)) {
      opaques.push(lowerOpaque(stmt));
    } else if (isTraitDecl(stmt)) {
      traits.push(lowerTrait(stmt));
    } else if (isImplBlock(stmt)) {
      impls.push(lowerImplBlock(stmt));
    }
  }

  return {
    functions,
    structs,
    enums,
    bindings,
    typeAliases,
    newtypes,
    opaques,
    traits,
    impls,
    entryPoints,
    sourceId,
    span: spanOf(ast),
  };
}
