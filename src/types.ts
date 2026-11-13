export type Span = {
  line: number;
  column: number;
};

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

export interface FnDecl {
  kind: "FnDecl";
  name: string;
  params: Param[];
  returnType: Type;
  body: Block;
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

export interface IfStmt {
  kind: "IfStmt";
  condition: Expression;
  thenBranch: Block;
  elseBranch: Block | null;
  span: Span;
}

export interface Block {
  kind: "Block";
  statements: Statement[];
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

export interface ImportDecl {
  kind: "ImportDecl";
  path: string;
  span: Span;
}

export interface BindingDecl {
  kind: "BindingDecl";
  binding: number;
  name: string;
  type: Type;
  span: Span;
}

export interface Identifier {
  kind: "Identifier";
  name: string;
  span: Span;
}

export interface Literal {
  kind: "Literal";
  value: number | string | boolean;
  literalKind: "int" | "float" | "bool" | "char" | "color";
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

export interface Pattern {
  kind: "wildcard" | "binding" | "literal" | "struct" | "tuple" | "array" | "ref" | "deref";
  binding: string | null;
  value: number | string | boolean | null;
  subPatterns: Pattern[];
  span: Span;
}

export interface EnumDecl {
  kind: "EnumDecl";
  name: string;
  variants: { name: string; type: Type | null }[];
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

export interface ArrayLiteral {
  kind: "ArrayLiteral";
  elements: Expression[];
  span: Span;
}

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

export interface BlockExpr {
  kind: "BlockExpr";
  block: Block;
  span: Span;
}

export interface Program {
  kind: "Program";
  statements: Statement[];
  span: Span;
}
