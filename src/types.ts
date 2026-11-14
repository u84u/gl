import type { ShaderStage } from "./codegen/capabilities";

export type Span = {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
};

// =====================================================================
// Literal generics — value type is tied to literalKind
// =====================================================================

export type LiteralKind = "int" | "float" | "bool" | "char" | "color";

export interface LiteralValueMap {
  "int": number;
  "float": number;
  "bool": boolean;
  "char": string;
  "color": string;
}

export interface LiteralBase<K extends LiteralKind> {
  kind: "Literal";
  literalKind: K;
  value: LiteralValueMap[K];
  span: Span;
}

export type Literal = LiteralBase<LiteralKind>;

/**
 * Creates a typed literal where `value` matches `literalKind`.
 */
export function literal<K extends LiteralKind>(
  literalKind: K,
  value: LiteralValueMap[K],
  span: Span,
): LiteralBase<K> {
  return { kind: "Literal", literalKind, value, span } as LiteralBase<K>;
}

/**
 * Type guard: narrows `Expression` to a `Literal` of a specific kind.
 */
export function isLiteralOfKind<K extends LiteralKind>(
  expr: Expression,
  literalKind: K,
): expr is LiteralBase<K> {
  return expr.kind === "Literal" && expr.literalKind === literalKind;
}

/**
 * Type guard: narrows `Expression` to any `Literal`.
 */
export function isLiteral(expr: Expression): expr is Literal {
  return expr.kind === "Literal";
}

// =====================================================================
// Pattern generics — each pattern kind carries its own fields
// =====================================================================

export type PatternKind =
  | "wildcard"
  | "binding"
  | "literal"
  | "struct"
  | "tuple"
  | "array"
  | "ref"
  | "deref";

export interface PatternBase<K extends PatternKind> {
  kind: K;
  span: Span;
}

export interface WildcardPattern extends PatternBase<"wildcard"> {}

export interface BindingPattern extends PatternBase<"binding"> {
  binding: string;
}

export interface LiteralPattern extends PatternBase<"literal"> {
  value: number | string | boolean;
}

export interface StructPattern extends PatternBase<"struct"> {
  subPatterns: Pattern[];
}

export interface TuplePattern extends PatternBase<"tuple"> {
  subPatterns: Pattern[];
}

export interface ArrayPattern extends PatternBase<"array"> {
  subPatterns: Pattern[];
}

export interface RefPattern extends PatternBase<"ref"> {
  subPatterns: Pattern[];
}

export interface DerefPattern extends PatternBase<"deref"> {
  subPatterns: Pattern[];
}

export type Pattern =
  | WildcardPattern
  | BindingPattern
  | LiteralPattern
  | StructPattern
  | TuplePattern
  | ArrayPattern
  | RefPattern
  | DerefPattern;

/** Type guard: wildcard pattern */
export function isWildcardPattern(p: Pattern): p is WildcardPattern {
  return p.kind === "wildcard";
}

/** Type guard: binding pattern */
export function isBindingPattern(p: Pattern): p is BindingPattern {
  return p.kind === "binding";
}

/** Type guard: literal pattern */
export function isLiteralPattern(p: Pattern): p is LiteralPattern {
  return p.kind === "literal";
}

/** Type guard: struct pattern */
export function isStructPattern(p: Pattern): p is StructPattern {
  return p.kind === "struct";
}

/** Type guard: tuple pattern */
export function isTuplePattern(p: Pattern): p is TuplePattern {
  return p.kind === "tuple";
}

/** Type guard: array pattern */
export function isArrayPattern(p: Pattern): p is ArrayPattern {
  return p.kind === "array";
}

/** Type guard: ref pattern */
export function isRefPattern(p: Pattern): p is RefPattern {
  return p.kind === "ref";
}

/** Type guard: deref pattern */
export function isDerefPattern(p: Pattern): p is DerefPattern {
  return p.kind === "deref";
}

// =====================================================================
// Type — containers already nest Type; we add type guards below
// =====================================================================

export type Type =
  | { kind: "abstractInt" }
  | { kind: "abstractFloat" }
  | { kind: "scalar"; name: "i8" | "u8" | "i16" | "u16" | "i32" | "u32" | "i64" | "u64" | "f16" | "f32" | "f64" | "bf16" | "bool" }
  | { kind: "vector"; element: "i8" | "u8" | "i16" | "u16" | "i32" | "u32" | "i64" | "u64" | "f16" | "f32" | "f64" | "bf16" | "bool"; size: 2 | 3 | 4 }
  | { kind: "matrix"; element: "i8" | "u8" | "i16" | "u16" | "i32" | "u32" | "i64" | "u64" | "f16" | "f32" | "f64" | "bf16" | "bool"; rows: 2 | 3 | 4; columns: 2 | 3 | 4 }
  | { kind: "quaternion" }
  | { kind: "struct"; name: string }
  | { kind: "enum"; name: string }
  | { kind: "sampler"; name: "sampler2D" | "sampler3D" | "samplerCube" | "sampler2DArray" | "samplerCubeArray" | "sampler2DShadow" | "samplerCubeShadow" | "samplerBuffer" }
  | { kind: "array"; element: Type; size: number }
  | { kind: "tuple"; elements: Type[] }
  | { kind: "option"; element: Type }
  | { kind: "result"; ok: Type; err: Type }
  | { kind: "alias"; name: string }
  | { kind: "opaque"; name: string }
  | { kind: "anonymousStruct"; fields: Field[] }
  | { kind: "union"; members: Type[] };

// =====================================================================
// Type type guards — replace `as Extract<...>` casts
// =====================================================================

export function isAbstractInt(t: Type): t is Extract<Type, { kind: "abstractInt" }> {
  return t.kind === "abstractInt";
}

export function isAbstractFloat(t: Type): t is Extract<Type, { kind: "abstractFloat" }> {
  return t.kind === "abstractFloat";
}

export function isScalar(t: Type): t is Extract<Type, { kind: "scalar" }> {
  return t.kind === "scalar";
}

export function isVector(t: Type): t is Extract<Type, { kind: "vector" }> {
  return t.kind === "vector";
}

export function isMatrix(t: Type): t is Extract<Type, { kind: "matrix" }> {
  return t.kind === "matrix";
}

export function isQuaternion(t: Type): t is Extract<Type, { kind: "quaternion" }> {
  return t.kind === "quaternion";
}

export function isStructType(t: Type): t is Extract<Type, { kind: "struct" }> {
  return t.kind === "struct";
}

export function isEnumType(t: Type): t is Extract<Type, { kind: "enum" }> {
  return t.kind === "enum";
}

export function isSampler(t: Type): t is Extract<Type, { kind: "sampler" }> {
  return t.kind === "sampler";
}

export function isArray(t: Type): t is Extract<Type, { kind: "array" }> {
  return t.kind === "array";
}

export function isTuple(t: Type): t is Extract<Type, { kind: "tuple" }> {
  return t.kind === "tuple";
}

export function isOption(t: Type): t is Extract<Type, { kind: "option" }> {
  return t.kind === "option";
}

export function isResult(t: Type): t is Extract<Type, { kind: "result" }> {
  return t.kind === "result";
}

export function isAlias(t: Type): t is Extract<Type, { kind: "alias" }> {
  return t.kind === "alias";
}

export function isOpaque(t: Type): t is Extract<Type, { kind: "opaque" }> {
  return t.kind === "opaque";
}

export function isAnonymousStruct(t: Type): t is Extract<Type, { kind: "anonymousStruct" }> {
  return t.kind === "anonymousStruct";
}

export function isUnion(t: Type): t is Extract<Type, { kind: "union" }> {
  return t.kind === "union";
}

// =====================================================================
// Statement and Expression interfaces
// =====================================================================

export interface Field {
  name: string;
  type: Type;
}

export interface Param {
  name: string;
  type: Type;
}

export interface StructDecl {
  kind: "StructDecl";
  name: string;
  fields: Field[];
  span: Span;
}

export interface EnumDecl {
  kind: "EnumDecl";
  name: string;
  variants: { name: string; type: Type | null; span?: Span }[];
  span: Span;
}

export interface ImplBlock {
  kind: "ImplBlock";
  trait: string | null;
  type: Type;
  methods: FnDecl[];
  span: Span;
}

export interface TraitDecl {
  kind: "TraitDecl";
  name: string;
  bounds: string[];
  methods: { name: string; params: Param[]; returnType: Type }[];
  span: Span;
}

export interface TypeAlias {
  kind: "TypeAlias";
  name: string;
  type: Type;
  span: Span;
}

export interface NewtypeDecl {
  kind: "NewtypeDecl";
  name: string;
  innerType: Type;
  span: Span;
}

export interface OpaqueDecl {
  kind: "OpaqueDecl";
  name: string;
  span: Span;
}

export interface FnDecl {
  kind: "FnDecl";
  name: string;
  params: Param[];
  returnType: Type;
  body: Block;
  stage?: ShaderStage;
  span: Span;
}

export interface VarDecl {
  kind: "VarDecl";
  name: string;
  type: Type;
  initializer: Expression | null;
  mutable: boolean;
  span: Span;
}

export interface ReturnStmt {
  kind: "ReturnStmt";
  value: Expression | null;
  span: Span;
}

export interface ExpressionStmt {
  kind: "ExpressionStmt";
  expression: Expression;
  span: Span;
}

export interface Block {
  kind: "Block";
  statements: Statement[];
  span: Span;
}

export interface IfStmt {
  kind: "IfStmt";
  condition: Expression;
  thenBranch: Block;
  elseBranch: Block | null;
  span: Span;
}

export interface WhileStmt {
  kind: "WhileStmt";
  condition: Expression;
  body: Block;
  span: Span;
}

export interface ForStmt {
  kind: "ForStmt";
  init: VarDecl | ExpressionStmt | null;
  condition: Expression | null;
  increment: Expression | null;
  range: { variable: string; start: Expression; end: Expression; inclusive: boolean } | null;
  body: Block;
  span: Span;
}

export interface DoWhileStmt {
  kind: "DoWhileStmt";
  body: Block;
  condition: Expression;
  span: Span;
}

export interface LoopStmt {
  kind: "LoopStmt";
  body: Block;
  label: string | null;
  span: Span;
}

export interface BreakStmt {
  kind: "BreakStmt";
  label: string | null;
  span: Span;
}

export interface ContinueStmt {
  kind: "ContinueStmt";
  label: string | null;
  span: Span;
}

export interface MatchArm {
  pattern: Pattern;
  guard: Expression | null;
  body: Block;
  span: Span;
}

export interface MatchExpr {
  kind: "MatchExpr";
  subject: Expression;
  arms: MatchArm[];
  span: Span;
}

export interface PanicStmt {
  kind: "PanicStmt";
  message: Expression | null;
  span: Span;
}

export interface UnreachableStmt {
  kind: "UnreachableStmt";
  span: Span;
}

export interface DiscardStmt {
  kind: "DiscardStmt";
  span: Span;
}

export interface BindingDecl {
  kind: "BindingDecl";
  binding: number;
  name: string;
  type: Type;
  span: Span;
}

export interface ImportDecl {
  kind: "ImportDecl";
  path: string;
  span: Span;
}

export interface Identifier {
  kind: "Identifier";
  name: string;
  span: Span;
}

export interface BinaryExpr {
  kind: "BinaryExpr";
  left: Expression;
  operator: string;
  right: Expression;
  span: Span;
}

export interface UnaryExpr {
  kind: "UnaryExpr";
  operator: string;
  operand: Expression;
  span: Span;
}

export interface CallExpr {
  kind: "CallExpr";
  callee: Expression;
  args: Expression[];
  span: Span;
}

export interface MemberExpr {
  kind: "MemberExpr";
  object: Expression;
  property: string;
  span: Span;
}

export interface SwizzleExpr {
  kind: "SwizzleExpr";
  object: Expression;
  components: string[];
  span: Span;
}

export interface IndexExpr {
  kind: "IndexExpr";
  object: Expression;
  index: Expression;
  span: Span;
}

export interface StructLiteral {
  kind: "StructLiteral";
  typeName: string;
  fields: { name: string | null; value: Expression }[];
  span: Span;
}

export interface ArrayLiteral {
  kind: "ArrayLiteral";
  elements: Expression[];
  span: Span;
}

export interface CompoundAssignExpr {
  kind: "CompoundAssignExpr";
  operator: "+=" | "-=" | "*=" | "/=" | "%=" | "&=" | "|=" | "^=" | "<<=" | ">>=";
  target: Expression;
  value: Expression;
  span: Span;
}

export interface UpdateExpr {
  kind: "UpdateExpr";
  operator: "++" | "--";
  operand: Expression;
  prefix: boolean;
  span: Span;
}

export interface ConditionalExpr {
  kind: "ConditionalExpr";
  test: Expression;
  consequent: Expression;
  alternate: Expression;
  span: Span;
}

export interface NullCoalescingExpr {
  kind: "NullCoalescingExpr";
  left: Expression;
  right: Expression;
  span: Span;
}

export interface BlockExpr {
  kind: "BlockExpr";
  block: Block;
  span: Span;
}

export type Statement =
  | StructDecl
  | EnumDecl
  | ImplBlock
  | TraitDecl
  | TypeAlias
  | NewtypeDecl
  | OpaqueDecl
  | FnDecl
  | VarDecl
  | ReturnStmt
  | ExpressionStmt
  | Block
  | IfStmt
  | WhileStmt
  | ForStmt
  | DoWhileStmt
  | LoopStmt
  | BreakStmt
  | ContinueStmt
  | PanicStmt
  | UnreachableStmt
  | DiscardStmt
  | BindingDecl
  | ImportDecl;

export type Expression =
  | Identifier
  | Literal
  | BinaryExpr
  | UnaryExpr
  | CallExpr
  | MemberExpr
  | SwizzleExpr
  | IndexExpr
  | StructLiteral
  | ArrayLiteral
  | CompoundAssignExpr
  | UpdateExpr
  | ConditionalExpr
  | NullCoalescingExpr
  | MatchExpr
  | BlockExpr;

export interface Program {
  kind: "Program";
  statements: Statement[];
  span: Span;
}

// =====================================================================
// Statement type guards
// =====================================================================

export function isStructDecl(s: Statement): s is StructDecl {
  return s.kind === "StructDecl";
}

export function isEnumDecl(s: Statement): s is EnumDecl {
  return s.kind === "EnumDecl";
}

export function isImplBlock(s: Statement): s is ImplBlock {
  return s.kind === "ImplBlock";
}

export function isTraitDecl(s: Statement): s is TraitDecl {
  return s.kind === "TraitDecl";
}

export function isTypeAlias(s: Statement): s is TypeAlias {
  return s.kind === "TypeAlias";
}

export function isNewtypeDecl(s: Statement): s is NewtypeDecl {
  return s.kind === "NewtypeDecl";
}

export function isOpaqueDecl(s: Statement): s is OpaqueDecl {
  return s.kind === "OpaqueDecl";
}

export function isFnDecl(s: Statement): s is FnDecl {
  return s.kind === "FnDecl";
}

export function isVarDecl(s: Statement): s is VarDecl {
  return s.kind === "VarDecl";
}

export function isReturnStmt(s: Statement): s is ReturnStmt {
  return s.kind === "ReturnStmt";
}

export function isExpressionStmt(s: Statement): s is ExpressionStmt {
  return s.kind === "ExpressionStmt";
}

export function isBlock(s: Statement): s is Block {
  return s.kind === "Block";
}

export function isIfStmt(s: Statement): s is IfStmt {
  return s.kind === "IfStmt";
}

export function isWhileStmt(s: Statement): s is WhileStmt {
  return s.kind === "WhileStmt";
}

export function isForStmt(s: Statement): s is ForStmt {
  return s.kind === "ForStmt";
}

export function isDoWhileStmt(s: Statement): s is DoWhileStmt {
  return s.kind === "DoWhileStmt";
}

export function isLoopStmt(s: Statement): s is LoopStmt {
  return s.kind === "LoopStmt";
}

export function isBreakStmt(s: Statement): s is BreakStmt {
  return s.kind === "BreakStmt";
}

export function isContinueStmt(s: Statement): s is ContinueStmt {
  return s.kind === "ContinueStmt";
}

export function isPanicStmt(s: Statement): s is PanicStmt {
  return s.kind === "PanicStmt";
}

export function isUnreachableStmt(s: Statement): s is UnreachableStmt {
  return s.kind === "UnreachableStmt";
}

export function isDiscardStmt(s: Statement): s is DiscardStmt {
  return s.kind === "DiscardStmt";
}

export function isBindingDecl(s: Statement): s is BindingDecl {
  return s.kind === "BindingDecl";
}

export function isImportDecl(s: Statement): s is ImportDecl {
  return s.kind === "ImportDecl";
}

export function isProgram(node: unknown): node is Program {
  return (
    typeof node === "object" &&
    node !== null &&
    "kind" in node &&
    (node as { kind: unknown }).kind === "Program"
  );
}

// =====================================================================
// Expression type guards
// =====================================================================

export function isIdentifier(e: Expression): e is Identifier {
  return e.kind === "Identifier";
}

export function isBinaryExpr(e: Expression): e is BinaryExpr {
  return e.kind === "BinaryExpr";
}

export function isUnaryExpr(e: Expression): e is UnaryExpr {
  return e.kind === "UnaryExpr";
}

export function isCallExpr(e: Expression): e is CallExpr {
  return e.kind === "CallExpr";
}

export function isMemberExpr(e: Expression): e is MemberExpr {
  return e.kind === "MemberExpr";
}

export function isSwizzleExpr(e: Expression): e is SwizzleExpr {
  return e.kind === "SwizzleExpr";
}

export function isIndexExpr(e: Expression): e is IndexExpr {
  return e.kind === "IndexExpr";
}

export function isStructLiteral(e: Expression): e is StructLiteral {
  return e.kind === "StructLiteral";
}

export function isArrayLiteral(e: Expression): e is ArrayLiteral {
  return e.kind === "ArrayLiteral";
}

export function isCompoundAssignExpr(e: Expression): e is CompoundAssignExpr {
  return e.kind === "CompoundAssignExpr";
}

export function isUpdateExpr(e: Expression): e is UpdateExpr {
  return e.kind === "UpdateExpr";
}

export function isConditionalExpr(e: Expression): e is ConditionalExpr {
  return e.kind === "ConditionalExpr";
}

export function isNullCoalescingExpr(e: Expression): e is NullCoalescingExpr {
  return e.kind === "NullCoalescingExpr";
}

export function isMatchExpr(e: Expression): e is MatchExpr {
  return e.kind === "MatchExpr";
}

export function isBlockExpr(e: Expression): e is BlockExpr {
  return e.kind === "BlockExpr";
}

// =====================================================================
// Visitor interfaces — exhaustiveness-checked codegen/formatter
// =====================================================================

export interface StatementVisitor<R> {
  visitStructDecl(node: StructDecl): R;
  visitEnumDecl(node: EnumDecl): R;
  visitImplBlock(node: ImplBlock): R;
  visitTraitDecl(node: TraitDecl): R;
  visitTypeAlias(node: TypeAlias): R;
  visitNewtypeDecl(node: NewtypeDecl): R;
  visitOpaqueDecl(node: OpaqueDecl): R;
  visitFnDecl(node: FnDecl): R;
  visitVarDecl(node: VarDecl): R;
  visitReturnStmt(node: ReturnStmt): R;
  visitExpressionStmt(node: ExpressionStmt): R;
  visitBlock(node: Block): R;
  visitIfStmt(node: IfStmt): R;
  visitWhileStmt(node: WhileStmt): R;
  visitForStmt(node: ForStmt): R;
  visitDoWhileStmt(node: DoWhileStmt): R;
  visitLoopStmt(node: LoopStmt): R;
  visitBreakStmt(node: BreakStmt): R;
  visitContinueStmt(node: ContinueStmt): R;
  visitPanicStmt(node: PanicStmt): R;
  visitUnreachableStmt(node: UnreachableStmt): R;
  visitDiscardStmt(node: DiscardStmt): R;
  visitBindingDecl(node: BindingDecl): R;
  visitImportDecl(node: ImportDecl): R;
}

export interface ExpressionVisitor<R> {
  visitIdentifier(node: Identifier): R;
  visitLiteral(node: Literal): R;
  visitBinaryExpr(node: BinaryExpr): R;
  visitUnaryExpr(node: UnaryExpr): R;
  visitCallExpr(node: CallExpr): R;
  visitMemberExpr(node: MemberExpr): R;
  visitSwizzleExpr(node: SwizzleExpr): R;
  visitIndexExpr(node: IndexExpr): R;
  visitStructLiteral(node: StructLiteral): R;
  visitArrayLiteral(node: ArrayLiteral): R;
  visitCompoundAssignExpr(node: CompoundAssignExpr): R;
  visitUpdateExpr(node: UpdateExpr): R;
  visitConditionalExpr(node: ConditionalExpr): R;
  visitNullCoalescingExpr(node: NullCoalescingExpr): R;
  visitMatchExpr(node: MatchExpr): R;
  visitBlockExpr(node: BlockExpr): R;
}

/**
 * Dispatches a Statement to a visitor — exhaustive at compile time.
 * Adding a new Statement kind requires updating StatementVisitor.
 */
export function visitStatement<R>(node: Statement, visitor: StatementVisitor<R>): R {
  switch (node.kind) {
    case "StructDecl": return visitor.visitStructDecl(node);
    case "EnumDecl": return visitor.visitEnumDecl(node);
    case "ImplBlock": return visitor.visitImplBlock(node);
    case "TraitDecl": return visitor.visitTraitDecl(node);
    case "TypeAlias": return visitor.visitTypeAlias(node);
    case "NewtypeDecl": return visitor.visitNewtypeDecl(node);
    case "OpaqueDecl": return visitor.visitOpaqueDecl(node);
    case "FnDecl": return visitor.visitFnDecl(node);
    case "VarDecl": return visitor.visitVarDecl(node);
    case "ReturnStmt": return visitor.visitReturnStmt(node);
    case "ExpressionStmt": return visitor.visitExpressionStmt(node);
    case "Block": return visitor.visitBlock(node);
    case "IfStmt": return visitor.visitIfStmt(node);
    case "WhileStmt": return visitor.visitWhileStmt(node);
    case "ForStmt": return visitor.visitForStmt(node);
    case "DoWhileStmt": return visitor.visitDoWhileStmt(node);
    case "LoopStmt": return visitor.visitLoopStmt(node);
    case "BreakStmt": return visitor.visitBreakStmt(node);
    case "ContinueStmt": return visitor.visitContinueStmt(node);
    case "PanicStmt": return visitor.visitPanicStmt(node);
    case "UnreachableStmt": return visitor.visitUnreachableStmt(node);
    case "DiscardStmt": return visitor.visitDiscardStmt(node);
    case "BindingDecl": return visitor.visitBindingDecl(node);
    case "ImportDecl": return visitor.visitImportDecl(node);
  }
  return assertNever(node);
}

/**
 * Dispatches an Expression to a visitor — exhaustive at compile time.
 * Adding a new Expression kind requires updating ExpressionVisitor.
 */
export function visitExpression<R>(node: Expression, visitor: ExpressionVisitor<R>): R {
  switch (node.kind) {
    case "Identifier": return visitor.visitIdentifier(node);
    case "Literal": return visitor.visitLiteral(node);
    case "BinaryExpr": return visitor.visitBinaryExpr(node);
    case "UnaryExpr": return visitor.visitUnaryExpr(node);
    case "CallExpr": return visitor.visitCallExpr(node);
    case "MemberExpr": return visitor.visitMemberExpr(node);
    case "SwizzleExpr": return visitor.visitSwizzleExpr(node);
    case "IndexExpr": return visitor.visitIndexExpr(node);
    case "StructLiteral": return visitor.visitStructLiteral(node);
    case "ArrayLiteral": return visitor.visitArrayLiteral(node);
    case "CompoundAssignExpr": return visitor.visitCompoundAssignExpr(node);
    case "UpdateExpr": return visitor.visitUpdateExpr(node);
    case "ConditionalExpr": return visitor.visitConditionalExpr(node);
    case "NullCoalescingExpr": return visitor.visitNullCoalescingExpr(node);
    case "MatchExpr": return visitor.visitMatchExpr(node);
    case "BlockExpr": return visitor.visitBlockExpr(node);
  }
  return assertNever(node);
}

/**
 * Exhaustiveness guard for switch statements over discriminated unions.
 * Adding a new union member without updating the switch raises at compile time
 * (via `never`) and at runtime if reached.
 */
export function assertNever(x: never): never {
  throw new Error(`Unhandled union member: ${JSON.stringify(x)}`);
}
