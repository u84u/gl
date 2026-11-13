import type {
  ArrayLiteral,
  Block,
  BlockExpr,
  BindingDecl,
  BreakStmt,
  ContinueStmt,
  DiscardStmt,
  DoWhileStmt,
  EnumDecl,
  Expression,
  ExpressionStmt,
  Field,
  FnDecl,
  ForStmt,
  IfStmt,
  ImportDecl,
  Literal,
  LoopStmt,
  MatchArm,
  MatchExpr,
  MemberExpr,
  Param,
  PanicStmt,
  Pattern,
  Program,
  ReturnStmt,
  Statement,
  StructDecl,
  StructLiteral,
  TraitDecl,
  Type,
  TypeAlias,
  UnreachableStmt,
  VarDecl,
  WhileStmt,
} from "./types";

const DEFAULT_SPAN = { line: 1, column: 1 } as const;

/* ------------------------------------------------------------------ */
/* Span                                                                 */
/* ------------------------------------------------------------------ */

export function span(line = 1, column = 1): { line: number; column: number } {
  return { line, column };
}

/* ------------------------------------------------------------------ */
/* Type builders                                                        */
/* ------------------------------------------------------------------ */

export function scalarType(
  name: Extract<Type, { kind: "scalar" }>["name"],
): Type {
  return { kind: "scalar", name };
}

export function i8(): Type { return scalarType("i8"); }
export function u8(): Type { return scalarType("u8"); }
export function i16(): Type { return scalarType("i16"); }
export function u16(): Type { return scalarType("u16"); }
export function i32(): Type { return scalarType("i32"); }
export function u32(): Type { return scalarType("u32"); }
export function i64(): Type { return scalarType("i64"); }
export function u64(): Type { return scalarType("u64"); }
export function f16(): Type { return scalarType("f16"); }
export function f32(): Type { return scalarType("f32"); }
export function f64(): Type { return scalarType("f64"); }
export function bf16(): Type { return scalarType("bf16"); }
export function boolType(): Type { return scalarType("bool"); }

export function vectorType(
  element: string,
  size: 2 | 3 | 4,
): Type {
  return { kind: "vector", element, size } as Type;
}

export function vec2(element = "f32"): Type {
  return vectorType(element, 2);
}
export function vec3(element = "f32"): Type {
  return vectorType(element, 3);
}
export function vec4(element = "f32"): Type {
  return vectorType(element, 4);
}
export function ivec2(): Type { return vectorType("i32", 2); }
export function ivec3(): Type { return vectorType("i32", 3); }
export function ivec4(): Type { return vectorType("i32", 4); }
export function uvec2(): Type { return vectorType("u32", 2); }
export function uvec3(): Type { return vectorType("u32", 3); }
export function uvec4(): Type { return vectorType("u32", 4); }
export function bvec2(): Type { return vectorType("bool", 2); }
export function bvec3(): Type { return vectorType("bool", 3); }
export function bvec4(): Type { return vectorType("bool", 4); }
export function dvec2(): Type { return vectorType("f64", 2); }
export function dvec3(): Type { return vectorType("f64", 3); }
export function dvec4(): Type { return vectorType("f64", 4); }

export function matrixType(
  element: string,
  rows: 2 | 3 | 4,
  columns: 2 | 3 | 4,
): Type {
  return { kind: "matrix", element, rows, columns } as Type;
}

export function mat2(): Type { return matrixType("f32", 2, 2); }
export function mat3(): Type { return matrixType("f32", 3, 3); }
export function mat4(): Type { return matrixType("f32", 4, 4); }
export function mat2x3(): Type { return matrixType("f32", 2, 3); }
export function mat3x2(): Type { return matrixType("f32", 3, 2); }
export function dmat3(): Type { return matrixType("f64", 3, 3); }

export function quatType(): Type {
  return { kind: "quaternion" };
}

export function structType(name: string): Type {
  return { kind: "struct", name };
}

export function enumType(name: string): Type {
  return { kind: "enum", name };
}

export function samplerType(
  name: Extract<Type, { kind: "sampler" }>["name"],
): Type {
  return { kind: "sampler", name };
}

export function sampler2D(): Type { return samplerType("sampler2D"); }
export function sampler3D(): Type { return samplerType("sampler3D"); }
export function samplerCube(): Type { return samplerType("samplerCube"); }

export function arrayType(element: Type, size: number): Type {
  return { kind: "array", element, size };
}

export function tupleType(elements: Type[]): Type {
  return { kind: "tuple", elements };
}

export function optionType(element: Type): Type {
  return { kind: "option", element };
}

export function resultType(ok: Type, err: Type): Type {
  return { kind: "result", ok, err };
}

export function aliasType(name: string): Type {
  return { kind: "alias", name };
}

export function opaqueType(name: string): Type {
  return { kind: "opaque", name };
}

export function anonymousStructType(fields: Field[]): Type {
  return { kind: "anonymousStruct", fields };
}

export function unionType(members: Type[]): Type {
  return { kind: "union", members };
}

/* ------------------------------------------------------------------ */
/* Field / Param builders                                               */
/* ------------------------------------------------------------------ */

export function field(name: string, type: Type): Field {
  return { name, type };
}

export function param(name: string, type: Type): Param {
  return { name, type };
}

/* ------------------------------------------------------------------ */
/* Statement builders                                                   */
/* ------------------------------------------------------------------ */

export function structDecl(name: string, fields: Field[]): StructDecl {
  return { kind: "StructDecl", name, fields, span: DEFAULT_SPAN };
}

export function enumDecl(
  name: string,
  variants: { name: string; type: Type | null }[],
): EnumDecl {
  return { kind: "EnumDecl", name, variants, span: DEFAULT_SPAN };
}

export function fnDecl(
  name: string,
  params: Param[],
  returnType: Type,
  body: Block,
): FnDecl {
  return { kind: "FnDecl", name, params, returnType, body, span: DEFAULT_SPAN };
}

export function bindingDecl(
  binding: number,
  name: string,
  type: Type,
): BindingDecl {
  return { kind: "BindingDecl", binding, name, type, span: DEFAULT_SPAN };
}

export function importDecl(path: string): ImportDecl {
  return { kind: "ImportDecl", path, span: DEFAULT_SPAN };
}

export function varDecl(
  name: string,
  type: Type,
  initializer: Expression | null = null,
  mutable = false,
): VarDecl {
  return {
    kind: "VarDecl",
    name,
    type,
    initializer,
    mutable,
    span: DEFAULT_SPAN,
  };
}

export function returnStmt(value: Expression | null = null): ReturnStmt {
  return { kind: "ReturnStmt", value, span: DEFAULT_SPAN };
}

export function expressionStmt(expression: Expression): ExpressionStmt {
  return { kind: "ExpressionStmt", expression, span: DEFAULT_SPAN };
}

export function block(statements: Statement[]): Block {
  return { kind: "Block", statements, span: DEFAULT_SPAN };
}

export function ifStmt(
  condition: Expression,
  thenBranch: Block,
  elseBranch: Block | null = null,
): IfStmt {
  return { kind: "IfStmt", condition, thenBranch, elseBranch, span: DEFAULT_SPAN };
}

export function whileStmt(condition: Expression, body: Block): WhileStmt {
  return { kind: "WhileStmt", condition, body, span: DEFAULT_SPAN };
}

export function forStmt(
  init: VarDecl | ExpressionStmt | null,
  condition: Expression | null,
  increment: Expression | null,
  body: Block,
): ForStmt {
  return {
    kind: "ForStmt",
    init,
    condition,
    increment,
    range: null,
    body,
    span: DEFAULT_SPAN,
  };
}

export function rangeForStmt(
  variable: string,
  start: Expression,
  end: Expression,
  inclusive: boolean,
  body: Block,
): ForStmt {
  return {
    kind: "ForStmt",
    init: null,
    condition: null,
    increment: null,
    range: { variable, start, end, inclusive },
    body,
    span: DEFAULT_SPAN,
  };
}

export function doWhileStmt(body: Block, condition: Expression): DoWhileStmt {
  return { kind: "DoWhileStmt", body, condition, span: DEFAULT_SPAN };
}

export function loopStmt(body: Block): LoopStmt {
  return { kind: "LoopStmt", body, label: null, span: DEFAULT_SPAN };
}

export function breakStmt(): BreakStmt {
  return { kind: "BreakStmt", label: null, span: DEFAULT_SPAN };
}

export function continueStmt(): ContinueStmt {
  return { kind: "ContinueStmt", label: null, span: DEFAULT_SPAN };
}

export function discardStmt(): DiscardStmt {
  return { kind: "DiscardStmt", span: DEFAULT_SPAN };
}

export function panicStmt(message: Expression | null = null): PanicStmt {
  return { kind: "PanicStmt", message, span: DEFAULT_SPAN };
}

export function unreachableStmt(): UnreachableStmt {
  return { kind: "UnreachableStmt", span: DEFAULT_SPAN };
}

/* ------------------------------------------------------------------ */
/* Expression builders                                                  */
/* ------------------------------------------------------------------ */

export function ident(name: string): { kind: "Identifier"; name: string; span: { line: number; column: number } } {
  return { kind: "Identifier", name, span: DEFAULT_SPAN };
}

export function int(value: number): Literal {
  return { kind: "Literal", value, literalKind: "int", span: DEFAULT_SPAN };
}

export function float(value: number): Literal {
  return { kind: "Literal", value, literalKind: "float", span: DEFAULT_SPAN };
}

export function bool(value: boolean): Literal {
  return { kind: "Literal", value, literalKind: "bool", span: DEFAULT_SPAN };
}

export function binary(left: Expression, operator: string, right: Expression): { kind: "BinaryExpr"; left: Expression; operator: string; right: Expression; span: { line: number; column: number } } {
  return { kind: "BinaryExpr", left, operator, right, span: DEFAULT_SPAN };
}

export function unary(operator: string, operand: Expression): { kind: "UnaryExpr"; operator: string; operand: Expression; span: { line: number; column: number } } {
  return { kind: "UnaryExpr", operator, operand, span: DEFAULT_SPAN };
}

export function call(callee: Expression, args: Expression[] = []): { kind: "CallExpr"; callee: Expression; args: Expression[]; span: { line: number; column: number } } {
  return { kind: "CallExpr", callee, args, span: DEFAULT_SPAN };
}

export function member(object: Expression, property: string): MemberExpr {
  return { kind: "MemberExpr", object, property, span: DEFAULT_SPAN };
}

export function swizzle(object: Expression, components: string[]): { kind: "SwizzleExpr"; object: Expression; components: string[]; span: { line: number; column: number } } {
  return { kind: "SwizzleExpr", object, components, span: DEFAULT_SPAN };
}

export function index(object: Expression, indexExpr: Expression): { kind: "IndexExpr"; object: Expression; index: Expression; span: { line: number; column: number } } {
  return { kind: "IndexExpr", object, index: indexExpr, span: DEFAULT_SPAN };
}

export function structLiteral(
  typeName: string,
  fields: { name: string | null; value: Expression }[],
): StructLiteral {
  return { kind: "StructLiteral", typeName, fields, span: DEFAULT_SPAN };
}

export function arrayLiteral(elements: Expression[] = []): ArrayLiteral {
  return { kind: "ArrayLiteral", elements, span: DEFAULT_SPAN };
}

export function compoundAssign(
  target: Expression,
  operator: "+=" | "-=" | "*=" | "/=" | "%=" | "&=" | "|=" | "^=" | "<<=" | ">>=",
  value: Expression,
): { kind: "CompoundAssignExpr"; operator: "+=" | "-=" | "*=" | "/=" | "%=" | "&=" | "|=" | "^=" | "<<=" | ">>="; target: Expression; value: Expression; span: { line: number; column: number } } {
  return { kind: "CompoundAssignExpr", operator, target, value, span: DEFAULT_SPAN };
}

export function update(
  operator: "++" | "--",
  operand: Expression,
  prefix = false,
): { kind: "UpdateExpr"; operator: "++" | "--"; operand: Expression; prefix: boolean; span: { line: number; column: number } } {
  return { kind: "UpdateExpr", operator, operand, prefix, span: DEFAULT_SPAN };
}

export function conditional(
  test: Expression,
  consequent: Expression,
  alternate: Expression,
): { kind: "ConditionalExpr"; test: Expression; consequent: Expression; alternate: Expression; span: { line: number; column: number } } {
  return { kind: "ConditionalExpr", test, consequent, alternate, span: DEFAULT_SPAN };
}

export function nullCoalescing(left: Expression, right: Expression): { kind: "NullCoalescingExpr"; left: Expression; right: Expression; span: { line: number; column: number } } {
  return { kind: "NullCoalescingExpr", left, right, span: DEFAULT_SPAN };
}

export function match(subject: Expression, arms: MatchArm[]): MatchExpr {
  return { kind: "MatchExpr", subject, arms, span: DEFAULT_SPAN };
}

export function blockExpr(block: Block): BlockExpr {
  return { kind: "BlockExpr", block, span: DEFAULT_SPAN };
}

/* ------------------------------------------------------------------ */
/* Pattern builders                                                     */
/* ------------------------------------------------------------------ */

export function literalPattern(
  value: number | string | boolean,
): Pattern {
  return { kind: "literal", binding: null, value, subPatterns: [], span: DEFAULT_SPAN };
}

export function bindingPattern(name: string): Pattern {
  return { kind: "binding", binding: name, value: null, subPatterns: [], span: DEFAULT_SPAN };
}

export function wildcardPattern(): Pattern {
  return { kind: "wildcard", binding: null, value: null, subPatterns: [], span: DEFAULT_SPAN };
}

export function arm(
  pattern: Pattern,
  body: Block,
  guard: Expression | null = null,
): MatchArm {
  return {
    pattern,
    guard,
    body,
    span: DEFAULT_SPAN,
  };
}

/* ------------------------------------------------------------------ */
/* Declaration builders (trait / impl / alias / newtype / opaque)       */
/* ------------------------------------------------------------------ */

export function typeAlias(name: string, type: Type): TypeAlias {
  return { kind: "TypeAlias", name, type, span: DEFAULT_SPAN };
}

export function newtypeDecl(name: string, innerType: Type): { kind: "NewtypeDecl"; name: string; innerType: Type; span: { line: number; column: number } } {
  return { kind: "NewtypeDecl", name, innerType, span: DEFAULT_SPAN };
}

export function opaqueDecl(name: string): { kind: "OpaqueDecl"; name: string; span: { line: number; column: number } } {
  return { kind: "OpaqueDecl", name, span: DEFAULT_SPAN };
}

export function traitDecl(
  name: string,
  bounds: string[],
  methods: { name: string; params: Param[]; returnType: Type }[],
): TraitDecl {
  return { kind: "TraitDecl", name, bounds, methods, span: DEFAULT_SPAN };
}

export function implBlock(
  trait: string | null,
  type: Type,
  methods: FnDecl[],
): { kind: "ImplBlock"; trait: string | null; type: Type; methods: FnDecl[]; span: { line: number; column: number } } {
  return { kind: "ImplBlock", trait, type, methods, span: DEFAULT_SPAN };
}

/* ------------------------------------------------------------------ */
/* Program                                                              */
/* ------------------------------------------------------------------ */

export function program(statements: Statement[]): Program {
  return { kind: "Program", statements, span: DEFAULT_SPAN };
}

/* ------------------------------------------------------------------ */
/* Convenience: main entry point                                        */
/* ------------------------------------------------------------------ */

export function mainFn(body: Block): FnDecl {
  return fnDecl("main", [], vec4(), body);
}

export function mainVec4(statements: Statement[]): FnDecl {
  return mainFn(block(statements));
}
