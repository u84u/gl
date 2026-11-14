import {
  Program, Type, VarDecl, ExpressionStmt, LiteralKind, Span,
  Expression, MatchArm, Pattern, Block, Statement,
  StructDecl, BindingDecl, EnumDecl, FnDecl,
  TypeAlias, NewtypeDecl, OpaqueDecl, TraitDecl, ImplBlock,
  assertNever,
} from "../types";
import {
  IRModule, IRType, IRExpression, IRStatement, IRFnDecl, IRStructDecl,
  IRBindingDecl, IRVarDecl, IRExpressionStmt, IRBlock, IRForRange,
  IRMatchArm, IRPattern, IREnumDecl, IRTypeAlias, IRNewtypeDecl,
  IROpaqueDecl, IRTraitDecl, IRImplBlock, IRModuleItem, IRSpan,
} from "./shader-ir";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function spanOf(s: { span?: IRSpan }): Span | { line: number; column: number } {
  return s.span ?? { line: 1, column: 1 };
}

/* ------------------------------------------------------------------ */
/* Type raising                                                       */
/* ------------------------------------------------------------------ */

function raiseType(t: IRType): Type {
  if (t.kind === "scalar") {
    const name = t.name as string;
    if (name === "abstractInt") return { kind: "abstractInt" };
    if (name === "abstractFloat") return { kind: "abstractFloat" };
    return { kind: "scalar", name: name as Extract<Type, { kind: "scalar" }>["name"] };
  }
  if (t.kind === "enum") {
    return { kind: "enum", name: t.name };
  }
  if (t.kind === "quaternion") {
    return { kind: "quaternion" };
  }
  if (t.kind === "vector") {
    return { kind: "vector", element: t.element, size: t.size } as Type;
  }
  if (t.kind === "matrix") {
    return { kind: "matrix", element: t.element, rows: t.rows, columns: t.columns } as Type;
  }
  if (t.kind === "array") {
    return { kind: "array", element: raiseType(t.element), size: t.size };
  }
  if (t.kind === "struct") {
    return { kind: "struct", name: t.name };
  }
  if (t.kind === "sampler") {
    return { kind: "sampler", name: t.name as Extract<Type, { kind: "sampler" }>["name"] };
  }
  if (t.kind === "alias") {
    return { kind: "alias", name: t.name };
  }
  if (t.kind === "opaque") {
    return { kind: "opaque", name: t.name };
  }
  if (t.kind === "anonymousStruct") {
    return {
      kind: "anonymousStruct",
      fields: t.fields.map((f) => ({ name: f.name, type: raiseType(f.type) })),
    };
  }
  if (t.kind === "union") {
    return { kind: "union", members: t.members.map(raiseType) };
  }
  if (t.kind === "option") {
    return { kind: "option", element: raiseType(t.element) };
  }
  if (t.kind === "result") {
    return { kind: "result", ok: raiseType(t.ok), err: raiseType(t.err) };
  }
  if (t.kind === "tuple") {
    return { kind: "tuple", elements: t.elements.map(raiseType) };
  }
  return assertNever(t as never);
}

/* ------------------------------------------------------------------ */
/* Expression raising                                                 */
/* ------------------------------------------------------------------ */

function raiseExpression(e: IRExpression): Expression {
  const baseSpan = spanOf(e);
  if (e.kind === "identifier") {
    return { kind: "Identifier", name: e.name, span: baseSpan };
  }
  if (e.kind === "literal") {
    let kind: LiteralKind;
    if (e.literalKind === "int") kind = "int";
    else if (e.literalKind === "float") kind = "float";
    else if (e.literalKind === "char") kind = "char";
    else if (e.literalKind === "color") kind = "color";
    else kind = "bool";
    return {
      kind: "Literal",
      literalKind: kind,
      value: e.value,
      span: baseSpan,
    };
  }
  if (e.kind === "binary") {
    return {
      kind: "BinaryExpr",
      operator: e.operator,
      left: raiseExpression(e.left),
      right: raiseExpression(e.right),
      span: baseSpan,
    };
  }
  if (e.kind === "unary") {
    return {
      kind: "UnaryExpr",
      operator: e.operator,
      operand: raiseExpression(e.operand),
      span: baseSpan,
    };
  }
  if (e.kind === "call") {
    return {
      kind: "CallExpr",
      callee: raiseExpression(e.callee),
      args: e.args.map(raiseExpression),
      span: baseSpan,
    };
  }
  if (e.kind === "member") {
    return {
      kind: "MemberExpr",
      object: raiseExpression(e.object),
      property: e.property,
      span: baseSpan,
    };
  }
  if (e.kind === "swizzle") {
    return {
      kind: "SwizzleExpr",
      object: raiseExpression(e.object),
      components: e.components,
      span: baseSpan,
    };
  }
  if (e.kind === "index") {
    return {
      kind: "IndexExpr",
      object: raiseExpression(e.object),
      index: raiseExpression(e.index),
      span: baseSpan,
    };
  }
  if (e.kind === "structLiteral") {
    return {
      kind: "StructLiteral",
      typeName: e.typeName,
      fields: e.fields.map((f) => ({ name: f.name, value: raiseExpression(f.value) })),
      span: baseSpan,
    };
  }
  if (e.kind === "arrayLiteral") {
    return {
      kind: "ArrayLiteral",
      elements: e.elements.map(raiseExpression),
      span: baseSpan,
    };
  }
  if (e.kind === "compoundAssign") {
    return {
      kind: "CompoundAssignExpr",
      operator: e.operator as "+=" | "-=" | "*=" | "/=" | "%=" | "&=" | "|=" | "^=" | "<<=" | ">>=",
      target: raiseExpression(e.target),
      value: raiseExpression(e.value),
      span: baseSpan,
    };
  }
  if (e.kind === "update") {
    return {
      kind: "UpdateExpr",
      operator: e.operator,
      operand: raiseExpression(e.operand),
      prefix: e.prefix,
      span: baseSpan,
    };
  }
  if (e.kind === "conditional") {
    return {
      kind: "ConditionalExpr",
      test: raiseExpression(e.test),
      consequent: raiseExpression(e.consequent),
      alternate: raiseExpression(e.alternate),
      span: baseSpan,
    };
  }
  if (e.kind === "nullCoalescing") {
    return {
      kind: "NullCoalescingExpr",
      left: raiseExpression(e.left),
      right: raiseExpression(e.right),
      span: baseSpan,
    };
  }
  if (e.kind === "match") {
    return {
      kind: "MatchExpr",
      subject: raiseExpression(e.subject),
      arms: e.arms.map(raiseMatchArm),
      span: baseSpan,
    };
  }
  if (e.kind === "blockExpr") {
    return { kind: "BlockExpr", block: raiseBlock(e.block), span: baseSpan };
  }
  return assertNever(e as never);
}

function raiseMatchArm(arm: IRMatchArm): MatchArm {
  return {
    pattern: raisePattern(arm.pattern),
    guard: arm.guard ? raiseExpression(arm.guard) : null,
    body: raiseBlock(arm.body),
    span: spanOf(arm),
  };
}

function raisePattern(p: IRPattern): Pattern {
  if (p.kind === "literal") {
    return { kind: "literal", value: p.value, span: spanOf(p) };
  }
  if (p.kind === "binding") {
    return { kind: "binding", binding: p.binding, span: spanOf(p) };
  }
  if (p.kind === "wildcard") {
    return { kind: "wildcard", span: spanOf(p) };
  }
  return assertNever(p as never);
}

/* ------------------------------------------------------------------ */
/* Statement raising                                                  */
/* ------------------------------------------------------------------ */

function raiseBlock(b: IRBlock): Block {
  return { kind: "Block", statements: b.statements.map((item) => raiseStatement(item as IRModuleItem)), span: spanOf(b) };
}

function raiseStatement(s: IRModuleItem): Statement {
  if (s.kind === "struct") return raiseStructDecl(s as any);
  if (s.kind === "fn") return raiseFnDecl(s as any);
  if (s.kind === "binding") return raiseBindingDecl(s as any);
  if (s.kind === "enum") return raiseEnumDecl(s as any);
  if (s.kind === "typeAlias") return raiseTypeAlias(s as any);
  if (s.kind === "newtype") return raiseNewtype(s as any);
  if (s.kind === "opaqueDecl") return raiseOpaque(s as any);
  if (s.kind === "trait") return raiseTrait(s as any);
  if (s.kind === "implBlock") return raiseImplBlock(s as any);
  if (s.kind === "varDecl") {
    return {
      kind: "VarDecl",
      name: s.name,
      type: raiseType(s.type),
      initializer: s.initializer ? raiseExpression(s.initializer) : null,
      mutable: s.mutable,
      span: spanOf(s),
    };
  }
  if (s.kind === "return") {
    return { kind: "ReturnStmt", value: s.value ? raiseExpression(s.value) : null, span: spanOf(s) };
  }
  if (s.kind === "expressionStmt") {
    return { kind: "ExpressionStmt", expression: raiseExpression(s.expression), span: spanOf(s) };
  }
  if (s.kind === "block") {
    return raiseBlock(s);
  }
  if (s.kind === "if") {
    return {
      kind: "IfStmt",
      condition: raiseExpression(s.condition),
      thenBranch: raiseBlock(s.thenBranch),
      elseBranch: s.elseBranch ? raiseBlock(s.elseBranch) : null,
      span: spanOf(s),
    };
  }
  if (s.kind === "while") {
    return {
      kind: "WhileStmt",
      condition: raiseExpression(s.condition),
      body: raiseBlock(s.body),
      span: spanOf(s),
    };
  }
  if (s.kind === "for") {
    return {
      kind: "ForStmt",
      init: s.init ? raiseInit(s.init) : null,
      condition: s.condition ? raiseExpression(s.condition) : null,
      increment: s.increment ? raiseExpression(s.increment) : null,
      range: s.range ? raiseForRange(s.range) : null,
      body: raiseBlock(s.body),
      span: spanOf(s),
    };
  }
  if (s.kind === "doWhile") {
    return {
      kind: "DoWhileStmt",
      body: raiseBlock(s.body),
      condition: raiseExpression(s.condition),
      span: spanOf(s),
    };
  }
  if (s.kind === "loop") {
    return { kind: "LoopStmt", body: raiseBlock(s.body), label: s.label, span: spanOf(s) };
  }
  if (s.kind === "break") {
    return { kind: "BreakStmt", label: s.label, span: spanOf(s) };
  }
  if (s.kind === "continue") {
    return { kind: "ContinueStmt", label: s.label, span: spanOf(s) };
  }
  if (s.kind === "discard") {
    return { kind: "DiscardStmt", span: spanOf(s) };
  }
  if (s.kind === "panic") {
    return { kind: "PanicStmt", message: s.message ? raiseExpression(s.message) : null, span: spanOf(s) };
  }
  if (s.kind === "unreachable") {
    return { kind: "UnreachableStmt", span: spanOf(s) };
  }
  return assertNever(s as never);
}

function raiseInit(init: IRVarDecl | IRExpressionStmt): VarDecl | ExpressionStmt {
  if (init.kind === "varDecl") {
    return {
      kind: "VarDecl",
      name: init.name,
      type: raiseType(init.type),
      initializer: init.initializer ? raiseExpression(init.initializer) : null,
      mutable: init.mutable,
      span: spanOf(init),
    };
  }
  return { kind: "ExpressionStmt", expression: raiseExpression(init.expression), span: spanOf(init) };
}

function raiseForRange(range: IRForRange): { variable: string; start: Expression; end: Expression; inclusive: boolean; span?: Span } {
  return {
    variable: range.variable,
    start: raiseExpression(range.start),
    end: raiseExpression(range.end),
    inclusive: range.inclusive,
    ...(range.span ? { span: range.span } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Module raising                                                     */
/* ------------------------------------------------------------------ */

function raiseStructDecl(s: IRStructDecl): StructDecl {
  return {
    kind: "StructDecl",
    name: s.name,
    fields: s.fields.map((f) => ({ name: f.name, type: raiseType(f.type) })),
    span: spanOf(s),
  };
}

function raiseBindingDecl(b: IRBindingDecl): BindingDecl {
  return {
    kind: "BindingDecl",
    binding: b.binding,
    name: b.name,
    type: raiseType(b.type),
    span: spanOf(b),
  };
}

function raiseEnumDecl(e: IREnumDecl): EnumDecl {
  return {
    kind: "EnumDecl",
    name: e.name,
    variants: e.variants.map((v) => ({
      name: v.name,
      type: v.type ? raiseType(v.type) : null,
      span: v.span,
    })),
    span: spanOf(e),
  };
}

function raiseFnDecl(f: IRFnDecl): FnDecl {
  return {
    kind: "FnDecl",
    name: f.name,
    stage: f.stage,
    params: f.params.map((p) => ({ name: p.name, type: raiseType(p.type) })),
    returnType: raiseType(f.returnType),
    body: raiseBlock(f.body),
    span: spanOf(f),
  };
}

function raiseTypeAlias(t: IRTypeAlias): TypeAlias {
  return {
    kind: "TypeAlias",
    name: t.name,
    type: raiseType(t.type),
    span: spanOf(t),
  };
}

function raiseNewtype(n: IRNewtypeDecl): NewtypeDecl {
  return {
    kind: "NewtypeDecl",
    name: n.name,
    innerType: raiseType(n.innerType),
    span: spanOf(n),
  };
}

function raiseOpaque(o: IROpaqueDecl): OpaqueDecl {
  return {
    kind: "OpaqueDecl",
    name: o.name,
    span: spanOf(o),
  };
}

function raiseTrait(t: IRTraitDecl): TraitDecl {
  return {
    kind: "TraitDecl",
    name: t.name,
    bounds: t.bounds,
    methods: t.methods.map((m) => ({
      name: m.name,
      params: m.params.map((p) => ({ name: p.name, type: raiseType(p.type) })),
      returnType: raiseType(m.returnType),
    })),
    span: spanOf(t),
  };
}

function raiseImplBlock(i: IRImplBlock): ImplBlock {
  return {
    kind: "ImplBlock",
    trait: i.trait,
    type: raiseType(i.type),
    methods: i.methods.map(raiseFnDecl),
    span: spanOf(i),
  };
}

/* ------------------------------------------------------------------ */
/* Program raising                                                    */
/* ------------------------------------------------------------------ */

export function raiseProgram(module: IRModule): Program {
  const statements: Statement[] = [];
  for (const item of module.items) {
    switch (item.kind) {
      case "struct":
        statements.push(raiseStructDecl(item));
        break;
      case "enum":
        statements.push(raiseEnumDecl(item));
        break;
      case "fn":
        statements.push(raiseFnDecl(item));
        break;
      case "binding":
        statements.push(raiseBindingDecl(item));
        break;
      case "typeAlias":
        statements.push(raiseTypeAlias(item));
        break;
      case "newtype":
        statements.push(raiseNewtype(item));
        break;
      case "opaqueDecl":
        statements.push(raiseOpaque(item));
        break;
      case "trait":
        statements.push(raiseTrait(item));
        break;
      case "implBlock":
        statements.push(raiseImplBlock(item));
        break;
      default:
        statements.push(raiseStatement(item as IRStatement));
        break;
    }
  }
  return { kind: "Program", statements, span: spanOf(module) };
}
