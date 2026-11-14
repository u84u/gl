export type IRScalarName =
  | "i8" | "u8" | "i16" | "u16" | "i32" | "u32" | "i64" | "u64"
  | "f16" | "f32" | "f64" | "bf16" | "bool"
  | "abstractInt" | "abstractFloat";

export type IRStage = "vertex" | "fragment" | "compute";

export type IRResourceKind =
  | "uniformBuffer"
  | "storageBuffer"
  | "sampledTexture"
  | "storageTexture"
  | "sampler";

/**
 * Source location used for diagnostics after lowering/raising.
 */
export type IRSpan = {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
};

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type IRType =
  | IRScalar
  | IRVector
  | IRMatrix
  | IRArray
  | IRStructRef
  | IREnumRef
  | IRQuaternion
  | IRSampler
  | IRAlias
  | IROpaque
  | IRAnonymousStruct
  | IRUnion
  | IROption
  | IRResult
  | IRTuple;

export interface IRScalar {
  kind: "scalar";
  name: IRScalarName;
  span?: IRSpan;
}

export interface IRVector {
  kind: "vector";
  element: IRScalarName;
  size: 2 | 3 | 4;
  span?: IRSpan;
}

export interface IRMatrix {
  kind: "matrix";
  element: IRScalarName;
  rows: 2 | 3 | 4;
  columns: 2 | 3 | 4;
  span?: IRSpan;
}

export interface IRArray {
  kind: "array";
  element: IRType;
  size: number;
  span?: IRSpan;
}

export interface IRStructRef {
  kind: "struct";
  name: string;
  span?: IRSpan;
}

export interface IREnumRef {
  kind: "enum";
  name: string;
  span?: IRSpan;
}

export interface IRQuaternion {
  kind: "quaternion";
  span?: IRSpan;
}

export interface IRSampler {
  kind: "sampler";
  name: string;
  span?: IRSpan;
}

export interface IRAlias {
  kind: "alias";
  name: string;
  span?: IRSpan;
}

export interface IROpaque {
  kind: "opaque";
  name: string;
  span?: IRSpan;
}

export interface IRAnonymousStruct {
  kind: "anonymousStruct";
  fields: IRField[];
  span?: IRSpan;
}

export interface IRUnion {
  kind: "union";
  members: IRType[];
  span?: IRSpan;
}

export interface IROption {
  kind: "option";
  element: IRType;
  span?: IRSpan;
}

export interface IRResult {
  kind: "result";
  ok: IRType;
  err: IRType;
  span?: IRSpan;
}

export interface IRTuple {
  kind: "tuple";
  elements: IRType[];
  span?: IRSpan;
}

export interface IRField {
  name: string;
  type: IRType;
  span?: IRSpan;
}

export type IRParam = IRField;

/* ------------------------------------------------------------------ */
/* Expressions                                                        */
/* ------------------------------------------------------------------ */

export type IRLiteralKind = "int" | "float" | "bool" | "char" | "color";

export type IRExpression =
  | IRLiteral
  | IRIdentifier
  | IRBinary
  | IRUnary
  | IRCall
  | IRMember
  | IRSwizzle
  | IRIndex
  | IRStructLiteral
  | IRArrayLiteral
  | IRCompoundAssign
  | IRUpdate
  | IRConditional
  | IRNullCoalescing
  | IRMatch
  | IRBlockExpr;

export interface IRLiteral {
  kind: "literal";
  literalKind: IRLiteralKind;
  value: string | number | boolean;
  span?: IRSpan;
}

export interface IRIdentifier {
  kind: "identifier";
  name: string;
  span?: IRSpan;
}

export interface IRBinary {
  kind: "binary";
  operator: string;
  left: IRExpression;
  right: IRExpression;
  span?: IRSpan;
}

export interface IRUnary {
  kind: "unary";
  operator: string;
  operand: IRExpression;
  span?: IRSpan;
}

export interface IRCall {
  kind: "call";
  callee: IRExpression;
  args: IRExpression[];
  span?: IRSpan;
}

export interface IRMember {
  kind: "member";
  object: IRExpression;
  property: string;
  span?: IRSpan;
}

export interface IRSwizzle {
  kind: "swizzle";
  object: IRExpression;
  components: string[];
  span?: IRSpan;
}

export interface IRIndex {
  kind: "index";
  object: IRExpression;
  index: IRExpression;
  span?: IRSpan;
}

export interface IRStructLiteral {
  kind: "structLiteral";
  typeName: string;
  fields: { name: string | null; value: IRExpression }[];
  span?: IRSpan;
}

export interface IRArrayLiteral {
  kind: "arrayLiteral";
  elements: IRExpression[];
  span?: IRSpan;
}

export interface IRCompoundAssign {
  kind: "compoundAssign";
  operator: string;
  target: IRExpression;
  value: IRExpression;
  span?: IRSpan;
}

export interface IRUpdate {
  kind: "update";
  operator: "++" | "--";
  operand: IRExpression;
  prefix: boolean;
  span?: IRSpan;
}

export interface IRConditional {
  kind: "conditional";
  test: IRExpression;
  consequent: IRExpression;
  alternate: IRExpression;
  span?: IRSpan;
}

export interface IRNullCoalescing {
  kind: "nullCoalescing";
  left: IRExpression;
  right: IRExpression;
  span?: IRSpan;
}

export interface IRMatch {
  kind: "match";
  subject: IRExpression;
  arms: IRMatchArm[];
  span?: IRSpan;
}

export interface IRMatchArm {
  pattern: IRPattern;
  guard: IRExpression | null;
  body: IRBlock;
  span?: IRSpan;
}

export type IRPattern =
  | IRLiteralPattern
  | IRBindingPattern
  | IRWildcardPattern;

export interface IRLiteralPattern {
  kind: "literal";
  value: string | number | boolean;
  span?: IRSpan;
}

export interface IRBindingPattern {
  kind: "binding";
  binding: string;
  span?: IRSpan;
}

export interface IRWildcardPattern {
  kind: "wildcard";
  span?: IRSpan;
}

export interface IRBlockExpr {
  kind: "blockExpr";
  block: IRBlock;
  span?: IRSpan;
}

/* ------------------------------------------------------------------ */
/* Statements                                                         */
/* ------------------------------------------------------------------ */

export type IRStatement =
  | IRVarDecl
  | IRReturn
  | IRExpressionStmt
  | IRBlock
  | IRIf
  | IRWhile
  | IRFor
  | IRDoWhile
  | IRLoop
  | IRBreak
  | IRContinue
  | IRDiscard
  | IRPanic
  | IRUnreachable;

export interface IRVarDecl {
  kind: "varDecl";
  name: string;
  type: IRType;
  initializer: IRExpression | null;
  mutable: boolean;
  span?: IRSpan;
}

export interface IRReturn {
  kind: "return";
  value: IRExpression | null;
  span?: IRSpan;
}

export interface IRExpressionStmt {
  kind: "expressionStmt";
  expression: IRExpression;
  span?: IRSpan;
}

export interface IRBlock {
  kind: "block";
  statements: IRModuleItem[];
  span?: IRSpan;
}

export interface IRIf {
  kind: "if";
  condition: IRExpression;
  thenBranch: IRBlock;
  elseBranch: IRBlock | null;
  span?: IRSpan;
}

export interface IRWhile {
  kind: "while";
  condition: IRExpression;
  body: IRBlock;
  span?: IRSpan;
}

export interface IRFor {
  kind: "for";
  init: IRVarDecl | IRExpressionStmt | null;
  condition: IRExpression | null;
  increment: IRExpression | null;
  range: IRForRange | null;
  body: IRBlock;
  span?: IRSpan;
}

export interface IRForRange {
  variable: string;
  start: IRExpression;
  end: IRExpression;
  inclusive: boolean;
  span?: IRSpan;
}

export interface IRDoWhile {
  kind: "doWhile";
  body: IRBlock;
  condition: IRExpression;
  span?: IRSpan;
}

export interface IRLoop {
  kind: "loop";
  body: IRBlock;
  label: string | null;
  span?: IRSpan;
}

export interface IRBreak {
  kind: "break";
  label: string | null;
  span?: IRSpan;
}

export interface IRContinue {
  kind: "continue";
  label: string | null;
  span?: IRSpan;
}

export interface IRDiscard {
  kind: "discard";
  span?: IRSpan;
}

export interface IRPanic {
  kind: "panic";
  message: IRExpression | null;
  span?: IRSpan;
}

export interface IRUnreachable {
  kind: "unreachable";
  span?: IRSpan;
}

/* ------------------------------------------------------------------ */
/* Declarations                                                       */
/* ------------------------------------------------------------------ */

export interface IRStructDecl {
  kind: "struct";
  name: string;
  fields: IRField[];
  span?: IRSpan;
}

export interface IRBindingDecl {
  kind: "binding";
  binding: number;
  name: string;
  type: IRType;
  span?: IRSpan;
}

export interface IREnumDecl {
  kind: "enum";
  name: string;
  variants: { name: string; type: IRType | null; span?: IRSpan }[];
  span?: IRSpan;
}

export interface IRFnDecl {
  kind: "fn";
  name: string;
  stage: IRStage;
  params: IRParam[];
  returnType: IRType;
  body: IRBlock;
  span?: IRSpan;
}

/* ------------------------------------------------------------------ */
/* Missing declaration kinds preserved through IR                     */
/* ------------------------------------------------------------------ */

export interface IRTypeAlias {
  kind: "typeAlias";
  name: string;
  type: IRType;
  span?: IRSpan;
}

export interface IRNewtypeDecl {
  kind: "newtype";
  name: string;
  innerType: IRType;
  span?: IRSpan;
}

export interface IROpaqueDecl {
  kind: "opaqueDecl";
  name: string;
  span?: IRSpan;
}

export interface IRTraitDecl {
  kind: "trait";
  name: string;
  bounds: string[];
  methods: { name: string; params: IRParam[]; returnType: IRType }[];
  span?: IRSpan;
}

export interface IRImplBlock {
  kind: "implBlock";
  trait: string | null;
  type: IRType;
  methods: IRFnDecl[];
  span?: IRSpan;
}

/* ------------------------------------------------------------------ */
/* Module / entry points                                              */
/* ------------------------------------------------------------------ */

export interface IREntryPoint {
  stage: IRStage;
  name: string;
  fn: IRFnDecl;
}

export interface IRSourceFile {
  id: string;
  displayName?: string;
}

export interface IRSourceAttribution {
  /** Canonical identity of the source module that declared this item. */
  sourceFile?: string;
}

export type IRModuleItem = (
  | IRStructDecl
  | IREnumDecl
  | IRFnDecl
  | IRBindingDecl
  | IRTypeAlias
  | IRNewtypeDecl
  | IROpaqueDecl
  | IRTraitDecl
  | IRImplBlock
  | IRStatement
) & IRSourceAttribution;

export interface IRModule {
  items: IRModuleItem[];
  functions: IRFnDecl[];
  structs: IRStructDecl[];
  enums: IREnumDecl[];
  bindings: IRBindingDecl[];
  typeAliases: IRTypeAlias[];
  newtypes: IRNewtypeDecl[];
  opaques: IROpaqueDecl[];
  traits: IRTraitDecl[];
  impls: IRImplBlock[];
  entryPoints: IREntryPoint[];
  sourceFiles: IRSourceFile[];
  sourceId: string;
  span?: IRSpan;
}
