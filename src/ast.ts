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
  WildcardPattern,
  BindingPattern,
  LiteralPattern,
  Identifier,
  LiteralBase,
  BinaryExpr,
  UnaryExpr,
  CallExpr,
  SwizzleExpr,
  IndexExpr,
  CompoundAssignExpr,
  UpdateExpr,
  ConditionalExpr,
  NullCoalescingExpr,
  NewtypeDecl,
  OpaqueDecl,
  ImplBlock,
  Span,
} from "./types";
import { literal } from "./types";
import type { ShaderStage } from "./codegen/capabilities";

const DEFAULT_SPAN = { line: 1, column: 1 } as const;

/**
 * Creates a source span for AST nodes.
 *
 * @param line - The line number (1-based).
 * @param column - The column number (1-based).
 * @returns A span object.
 */
export function span(line = 1, column = 1): { line: number; column: number } {
  return { line, column };
}

/* ------------------------------------------------------------------ */
/* Type builders                                                        */
/* ------------------------------------------------------------------ */

/**
 * Builds a scalar type node.
 *
 * @param name - The scalar type name (e.g. "f32", "i32", "bool").
 * @returns The scalar Type node.
 */
export function scalarType(
  name: Extract<Type, { kind: "scalar" }>["name"],
): Type {
  return { kind: "scalar", name };
}

/**
 * Builds an i8 scalar type.
 * @returns The i8 Type node.
 */
export function i8(): Type { return scalarType("i8"); }
/**
 * Builds a u8 scalar type.
 * @returns The u8 Type node.
 */
export function u8(): Type { return scalarType("u8"); }
/**
 * Builds an i16 scalar type.
 * @returns The i16 Type node.
 */
export function i16(): Type { return scalarType("i16"); }
/**
 * Builds a u16 scalar type.
 * @returns The u16 Type node.
 */
export function u16(): Type { return scalarType("u16"); }
/**
 * Builds an i32 scalar type.
 * @returns The i32 Type node.
 */
export function i32(): Type { return scalarType("i32"); }
/**
 * Builds a u32 scalar type.
 * @returns The u32 Type node.
 */
export function u32(): Type { return scalarType("u32"); }
/**
 * Builds an i64 scalar type.
 * @returns The i64 Type node.
 */
export function i64(): Type { return scalarType("i64"); }
/**
 * Builds a u64 scalar type.
 * @returns The u64 Type node.
 */
export function u64(): Type { return scalarType("u64"); }
/**
 * Builds an f16 scalar type.
 * @returns The f16 Type node.
 */
export function f16(): Type { return scalarType("f16"); }
/**
 * Builds an f32 scalar type.
 * @returns The f32 Type node.
 */
export function f32(): Type { return scalarType("f32"); }
/**
 * Builds an f64 scalar type.
 * @returns The f64 Type node.
 */
export function f64(): Type { return scalarType("f64"); }
/**
 * Builds a bf16 scalar type.
 * @returns The bf16 Type node.
 */
export function bf16(): Type { return scalarType("bf16"); }
/**
 * Builds a bool scalar type.
 * @returns The bool Type node.
 */
export function boolType(): Type { return scalarType("bool"); }

/**
 * Builds a vector type node.
 *
 * @param element - The element type name (e.g. "f32", "i32").
 * @param size - The vector size (2, 3, or 4).
 * @returns The vector Type node.
 */
export function vectorType(
  element: string,
  size: 2 | 3 | 4,
): Type {
  return { kind: "vector", element, size } as Type;
}

/**
 * Builds a vec2 type.
 * @param element - The element type name (default "f32").
 * @returns The vec2 Type node.
 */
export function vec2(element = "f32"): Type {
  return vectorType(element, 2);
}

/**
 * Builds a vec3 type.
 * @param element - The element type name (default "f32").
 * @returns The vec3 Type node.
 */
export function vec3(element = "f32"): Type {
  return vectorType(element, 3);
}

/**
 * Builds a vec4 type.
 * @param element - The element type name (default "f32").
 * @returns The vec4 Type node.
 */
export function vec4(element = "f32"): Type {
  return vectorType(element, 4);
}

/**
 * Builds an ivec2 type.
 * @returns The ivec2 Type node.
 */
export function ivec2(): Type { return vectorType("i32", 2); }
/**
 * Builds an ivec3 type.
 * @returns The ivec3 Type node.
 */
export function ivec3(): Type { return vectorType("i32", 3); }
/**
 * Builds an ivec4 type.
 * @returns The ivec4 Type node.
 */
export function ivec4(): Type { return vectorType("i32", 4); }
/**
 * Builds a uvec2 type.
 * @returns The uvec2 Type node.
 */
export function uvec2(): Type { return vectorType("u32", 2); }
/**
 * Builds a uvec3 type.
 * @returns The uvec3 Type node.
 */
export function uvec3(): Type { return vectorType("u32", 3); }
/**
 * Builds a uvec4 type.
 * @returns The uvec4 Type node.
 */
export function uvec4(): Type { return vectorType("u32", 4); }
/**
 * Builds a bvec2 type.
 * @returns The bvec2 Type node.
 */
export function bvec2(): Type { return vectorType("bool", 2); }
/**
 * Builds a bvec3 type.
 * @returns The bvec3 Type node.
 */
export function bvec3(): Type { return vectorType("bool", 3); }
/**
 * Builds a bvec4 type.
 * @returns The bvec4 Type node.
 */
export function bvec4(): Type { return vectorType("bool", 4); }
/**
 * Builds a dvec2 type.
 * @returns The dvec2 Type node.
 */
export function dvec2(): Type { return vectorType("f64", 2); }
/**
 * Builds a dvec3 type.
 * @returns The dvec3 Type node.
 */
export function dvec3(): Type { return vectorType("f64", 3); }
/**
 * Builds a dvec4 type.
 * @returns The dvec4 Type node.
 */
export function dvec4(): Type { return vectorType("f64", 4); }

/**
 * Builds a matrix type node.
 *
 * @param element - The element type name.
 * @param rows - The number of rows (2, 3, or 4).
 * @param columns - The number of columns (2, 3, or 4).
 * @returns The matrix Type node.
 */
export function matrixType(
  element: string,
  rows: 2 | 3 | 4,
  columns: 2 | 3 | 4,
): Type {
  return { kind: "matrix", element, rows, columns } as Type;
}

/**
 * Builds a mat2 type.
 * @returns The mat2 Type node.
 */
export function mat2(): Type { return matrixType("f32", 2, 2); }
/**
 * Builds a mat3 type.
 * @returns The mat3 Type node.
 */
export function mat3(): Type { return matrixType("f32", 3, 3); }
/**
 * Builds a mat4 type.
 * @returns The mat4 Type node.
 */
export function mat4(): Type { return matrixType("f32", 4, 4); }
/**
 * Builds a mat2x3 type.
 * @returns The mat2x3 Type node.
 */
export function mat2x3(): Type { return matrixType("f32", 2, 3); }
/**
 * Builds a mat3x2 type.
 * @returns The mat3x2 Type node.
 */
export function mat3x2(): Type { return matrixType("f32", 3, 2); }
/**
 * Builds a dmat3 type.
 * @returns The dmat3 Type node.
 */
export function dmat3(): Type { return matrixType("f64", 3, 3); }

/**
 * Builds a quaternion type node.
 * @returns The quaternion Type node.
 */
export function quatType(): Type {
  return { kind: "quaternion" };
}

/**
 * Builds a struct type reference.
 *
 * @param name - The struct name.
 * @returns The struct Type node.
 */
export function structType(name: string): Type {
  return { kind: "struct", name };
}

/**
 * Builds an enum type reference.
 *
 * @param name - The enum name.
 * @returns The enum Type node.
 */
export function enumType(name: string): Type {
  return { kind: "enum", name };
}

/**
 * Builds a sampler type node.
 *
 * @param name - The sampler type name (e.g. "sampler2D").
 * @returns The sampler Type node.
 */
export function samplerType(
  name: Extract<Type, { kind: "sampler" }>["name"],
): Type {
  return { kind: "sampler", name };
}

/**
 * Builds a sampler2D type.
 * @returns The sampler2D Type node.
 */
export function sampler2D(): Type { return samplerType("sampler2D"); }
/**
 * Builds a sampler3D type.
 * @returns The sampler3D Type node.
 */
export function sampler3D(): Type { return samplerType("sampler3D"); }
/**
 * Builds a samplerCube type.
 * @returns The samplerCube Type node.
 */
export function samplerCube(): Type { return samplerType("samplerCube"); }

/**
 * Builds an array type node.
 *
 * @param element - The element Type.
 * @param size - The array size.
 * @returns The array Type node.
 */
export function arrayType(element: Type, size: number): Type {
  return { kind: "array", element, size };
}

/**
 * Builds a tuple type node.
 *
 * @param elements - The element Types.
 * @returns The tuple Type node.
 */
export function tupleType(elements: Type[]): Type {
  return { kind: "tuple", elements };
}

/**
 * Builds an option type node.
 *
 * @param element - The element Type.
 * @returns The option Type node.
 */
export function optionType(element: Type): Type {
  return { kind: "option", element };
}

/**
 * Builds a result type node.
 *
 * @param ok - The ok Type.
 * @param err - The err Type.
 * @returns The result Type node.
 */
export function resultType(ok: Type, err: Type): Type {
  return { kind: "result", ok, err };
}

/**
 * Builds an alias type reference.
 *
 * @param name - The alias name.
 * @returns The alias Type node.
 */
export function aliasType(name: string): Type {
  return { kind: "alias", name };
}

/**
 * Builds an opaque type reference.
 *
 * @param name - The opaque type name.
 * @returns The opaque Type node.
 */
export function opaqueType(name: string): Type {
  return { kind: "opaque", name };
}

/**
 * Builds an anonymous struct type node.
 *
 * @param fields - The struct fields.
 * @returns The anonymous struct Type node.
 */
export function anonymousStructType(fields: Field[]): Type {
  return { kind: "anonymousStruct", fields };
}

/**
 * Builds a union type node.
 *
 * @param members - The member Types.
 * @returns The union Type node.
 */
export function unionType(members: Type[]): Type {
  return { kind: "union", members };
}

/* ------------------------------------------------------------------ */
/* Field / Param builders                                               */
/* ------------------------------------------------------------------ */

/**
 * Builds a struct field.
 *
 * @param name - The field name.
 * @param type - The field Type.
 * @returns The Field node.
 */
export function field(name: string, type: Type, span: Span = { line: 1, column: 1 }): Field {
  return { name, type, span };
}

/**
 * Builds a function parameter.
 *
 * @param name - The parameter name.
 * @param type - The parameter Type.
 * @param span - Optional source span (defaults to 1:1).
 * @returns The Param node.
 */
export function param(name: string, type: Type, span: Span = { line: 1, column: 1 }): Param {
  return { name, type, span };
}

/* ------------------------------------------------------------------ */
/* Statement builders                                                   */
/* ------------------------------------------------------------------ */

/**
 * Builds a struct declaration.
 *
 * @param name - The struct name.
 * @param fields - The struct fields.
 * @returns The StructDecl node.
 */
export function structDecl(name: string, fields: Field[]): StructDecl {
  return { kind: "StructDecl", name, fields, span: DEFAULT_SPAN };
}

/**
 * Builds an enum declaration.
 *
 * @param name - The enum name.
 * @param variants - The enum variants (name + optional type).
 * @returns The EnumDecl node.
 */
export function enumDecl(
  name: string,
  variants: { name: string; type: Type | null; span?: Span }[],
): EnumDecl {
  return { kind: "EnumDecl", name, variants, span: DEFAULT_SPAN };
}

/**
 * Builds a function declaration.
 *
 * @param name - The function name.
 * @param params - The function parameters.
 * @param returnType - The return Type.
 * @param body - The function body block.
 * @returns The FnDecl node.
 */
export function fnDecl(
  name: string,
  params: Param[],
  returnType: Type,
  body: Block,
  stage: ShaderStage = "fragment",
): FnDecl {
  return {
    kind: "FnDecl",
    name,
    params,
    returnType,
    body,
    stage,
    span: DEFAULT_SPAN,
  };
}

/**
 * Builds a binding declaration (@binding).
 *
 * @param binding - The binding slot number.
 * @param name - The binding name.
 * @param type - The binding Type.
 * @returns The BindingDecl node.
 */
export function bindingDecl(
  binding: number,
  name: string,
  type: Type,
): BindingDecl {
  return { kind: "BindingDecl", binding, name, type, span: DEFAULT_SPAN };
}

/**
 * Builds an import declaration.
 *
 * @param path - The import path.
 * @returns The ImportDecl node.
 */
export function importDecl(path: string): ImportDecl {
  return { kind: "ImportDecl", path, span: DEFAULT_SPAN };
}

/**
 * Builds a variable declaration.
 *
 * @param name - The variable name.
 * @param type - The variable Type.
 * @param initializer - The initializer expression, or null.
 * @param mutable - Whether the variable is mutable (var vs let).
 * @returns The VarDecl node.
 */
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

/**
 * Builds a return statement.
 *
 * @param value - The return value expression, or null.
 * @returns The ReturnStmt node.
 */
export function returnStmt(value: Expression | null = null): ReturnStmt {
  return { kind: "ReturnStmt", value, span: DEFAULT_SPAN };
}

/**
 * Builds an expression statement.
 *
 * @param expression - The expression to evaluate.
 * @returns The ExpressionStmt node.
 */
export function expressionStmt(expression: Expression): ExpressionStmt {
  return { kind: "ExpressionStmt", expression, span: DEFAULT_SPAN };
}

/**
 * Builds a block statement.
 *
 * @param statements - The statements inside the block.
 * @returns The Block node.
 */
export function block(statements: Statement[]): Block {
  return { kind: "Block", statements, span: DEFAULT_SPAN };
}

/**
 * Builds an if-else statement.
 *
 * @param condition - The condition expression.
 * @param thenBranch - The then-branch block.
 * @param elseBranch - The optional else-branch block.
 * @returns The IfStmt node.
 */
export function ifStmt(
  condition: Expression,
  thenBranch: Block,
  elseBranch: Block | null = null,
): IfStmt {
  return { kind: "IfStmt", condition, thenBranch, elseBranch, span: DEFAULT_SPAN };
}

/**
 * Builds a while loop statement.
 *
 * @param condition - The loop condition expression.
 * @param body - The loop body block.
 * @returns The WhileStmt node.
 */
export function whileStmt(condition: Expression, body: Block): WhileStmt {
  return { kind: "WhileStmt", condition, body, span: DEFAULT_SPAN };
}

/**
 * Builds a C-style for loop statement.
 *
 * @param init - The initializer (VarDecl, ExpressionStmt, or null).
 * @param condition - The loop condition, or null.
 * @param increment - The increment expression, or null.
 * @param body - The loop body block.
 * @returns The ForStmt node.
 */
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

/**
 * Builds a range-based for loop statement (e.g. `for x in 0..3`).
 *
 * @param variable - The loop variable name.
 * @param start - The range start expression.
 * @param end - The range end expression.
 * @param inclusive - Whether the range is inclusive (`..=`).
 * @param body - The loop body block.
 * @returns The ForStmt node.
 */
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

/**
 * Builds a do-while loop statement.
 *
 * @param body - The loop body block.
 * @param condition - The exit condition expression.
 * @returns The DoWhileStmt node.
 */
export function doWhileStmt(body: Block, condition: Expression): DoWhileStmt {
  return { kind: "DoWhileStmt", body, condition, span: DEFAULT_SPAN };
}

/**
 * Builds a loop statement (infinite loop, lowered to `for (;;)`).
 *
 * @param body - The loop body block.
 * @returns The LoopStmt node.
 */
export function loopStmt(body: Block): LoopStmt {
  return { kind: "LoopStmt", body, label: null, span: DEFAULT_SPAN };
}

/**
 * Builds a break statement.
 * @returns The BreakStmt node.
 */
export function breakStmt(): BreakStmt {
  return { kind: "BreakStmt", label: null, span: DEFAULT_SPAN };
}

/**
 * Builds a continue statement.
 * @returns The ContinueStmt node.
 */
export function continueStmt(): ContinueStmt {
  return { kind: "ContinueStmt", label: null, span: DEFAULT_SPAN };
}

/**
 * Builds a discard statement.
 * @returns The DiscardStmt node.
 */
export function discardStmt(): DiscardStmt {
  return { kind: "DiscardStmt", span: DEFAULT_SPAN };
}

/**
 * Builds a panic statement.
 *
 * @param message - The optional panic message expression.
 * @returns The PanicStmt node.
 */
export function panicStmt(message: Expression | null = null): PanicStmt {
  return { kind: "PanicStmt", message, span: DEFAULT_SPAN };
}

/**
 * Builds an unreachable statement.
 * @returns The UnreachableStmt node.
 */
export function unreachableStmt(): UnreachableStmt {
  return { kind: "UnreachableStmt", span: DEFAULT_SPAN };
}

/* ------------------------------------------------------------------ */
/* Expression builders                                                  */
/* ------------------------------------------------------------------ */

/**
 * Builds an identifier expression.
 *
 * @param name - The identifier name.
 * @returns The Identifier expression node.
 */
export function ident(name: string): Identifier {
  return { kind: "Identifier", name, span: DEFAULT_SPAN };
}

/**
 * Builds an integer literal expression.
 *
 * @param value - The integer value.
 * @returns The Literal expression node with literalKind "int".
 */
export function int(value: number): LiteralBase<"int"> {
  return literal("int", value, DEFAULT_SPAN);
}

/**
 * Builds a float literal expression.
 *
 * @param value - The float value.
 * @returns The Literal expression node with literalKind "float".
 */
export function float(value: number): LiteralBase<"float"> {
  return literal("float", value, DEFAULT_SPAN);
}

/**
 * Builds a boolean literal expression.
 *
 * @param value - The boolean value.
 * @returns The Literal expression node with literalKind "bool".
 */
export function boolLiteral(value: boolean): LiteralBase<"bool"> {
  return literal("bool", value, DEFAULT_SPAN);
}

/**
 * Builds a binary expression.
 *
 * @param left - The left operand.
 * @param operator - The binary operator.
 * @param right - The right operand.
 * @returns The BinaryExpr expression node.
 */
export function binary(left: Expression, operator: string, right: Expression): BinaryExpr {
  return { kind: "BinaryExpr", left, operator, right, span: DEFAULT_SPAN };
}

/**
 * Builds a unary expression.
 *
 * @param operator - The unary operator.
 * @param operand - The operand expression.
 * @returns The UnaryExpr expression node.
 */
export function unary(operator: string, operand: Expression): UnaryExpr {
  return { kind: "UnaryExpr", operator, operand, span: DEFAULT_SPAN };
}

/**
 * Builds a function call expression.
 *
 * @param callee - The callee expression.
 * @param args - The call arguments (default empty).
 * @returns The CallExpr expression node.
 */
export function call(callee: Expression, args: Expression[] = []): CallExpr {
  return { kind: "CallExpr", callee, args, span: DEFAULT_SPAN };
}

/**
 * Builds a member access expression.
 *
 * @param object - The object expression.
 * @param property - The property name.
 * @returns The MemberExpr expression node.
 */
export function member(object: Expression, property: string): MemberExpr {
  return { kind: "MemberExpr", object, property, span: DEFAULT_SPAN };
}

/**
 * Builds a swizzle expression.
 *
 * @param object - The object expression.
 * @param components - The swizzle components (e.g. ["r", "g", "b"]).
 * @returns The SwizzleExpr expression node.
 */
export function swizzle(object: Expression, components: string[]): SwizzleExpr {
  return { kind: "SwizzleExpr", object, components, span: DEFAULT_SPAN };
}

/**
 * Builds an index expression.
 *
 * @param object - The object expression.
 * @param indexExpr - The index expression.
 * @returns The IndexExpr expression node.
 */
export function index(object: Expression, indexExpr: Expression): IndexExpr {
  return { kind: "IndexExpr", object, index: indexExpr, span: DEFAULT_SPAN };
}

/**
 * Builds a struct literal expression.
 *
 * @param typeName - The struct type name.
 * @param fields - The field name/value pairs (name may be null for spread).
 * @returns The StructLiteral expression node.
 */
export function structLiteral(
  typeName: string,
  fields: { name: string | null; value: Expression }[],
): StructLiteral {
  return { kind: "StructLiteral", typeName, fields, span: DEFAULT_SPAN };
}

/**
 * Builds an array literal expression.
 *
 * @param elements - The array elements (default empty).
 * @returns The ArrayLiteral expression node.
 */
export function arrayLiteral(elements: Expression[] = []): ArrayLiteral {
  return { kind: "ArrayLiteral", elements, span: DEFAULT_SPAN };
}

/**
 * Builds a compound assignment expression (e.g. `x += 2`).
 *
 * @param target - The target expression.
 * @param operator - The compound assignment operator.
 * @param value - The value expression.
 * @returns The CompoundAssignExpr expression node.
 */
export function compoundAssign(
  target: Expression,
  operator: "+=" | "-=" | "*=" | "/=" | "%=" | "&=" | "|=" | "^=" | "<<=" | ">>=",
  value: Expression,
): CompoundAssignExpr {
  return { kind: "CompoundAssignExpr", operator, target, value, span: DEFAULT_SPAN };
}

/**
 * Builds an increment/decrement expression (e.g. `++x` or `x--`).
 *
 * @param operator - The update operator ("++" or "--").
 * @param operand - The operand expression.
 * @param prefix - Whether the operator is prefix (default false).
 * @returns The UpdateExpr expression node.
 */
export function update(
  operator: "++" | "--",
  operand: Expression,
  prefix = false,
): UpdateExpr {
  return { kind: "UpdateExpr", operator, operand, prefix, span: DEFAULT_SPAN };
}

/**
 * Builds a ternary conditional expression (e.g. `b ? 1.0 : 2.0`).
 *
 * @param test - The test expression.
 * @param consequent - The consequent expression.
 * @param alternate - The alternate expression.
 * @returns The ConditionalExpr expression node.
 */
export function conditional(
  test: Expression,
  consequent: Expression,
  alternate: Expression,
): ConditionalExpr {
  return { kind: "ConditionalExpr", test, consequent, alternate, span: DEFAULT_SPAN };
}

/**
 * Builds a null coalescing expression (e.g. `x ?? 2`).
 *
 * @param left - The left expression.
 * @param right - The right expression.
 * @returns The NullCoalescingExpr expression node.
 */
export function nullCoalescing(left: Expression, right: Expression): NullCoalescingExpr {
  return { kind: "NullCoalescingExpr", left, right, span: DEFAULT_SPAN };
}

/**
 * Builds a match expression.
 *
 * @param subject - The subject expression.
 * @param arms - The match arms.
 * @returns The MatchExpr expression node.
 */
export function match(subject: Expression, arms: MatchArm[]): MatchExpr {
  return { kind: "MatchExpr", subject, arms, span: DEFAULT_SPAN };
}

/**
 * Builds a block expression.
 *
 * @param block - The block statement.
 * @returns The BlockExpr expression node.
 */
export function blockExpr(block: Block): BlockExpr {
  return { kind: "BlockExpr", block, span: DEFAULT_SPAN };
}

/* ------------------------------------------------------------------ */
/* Pattern builders                                                     */
/* ------------------------------------------------------------------ */

/**
 * Builds a literal match pattern.
 *
 * @param value - The literal value.
 * @returns The LiteralPattern node.
 */
export function literalPattern(
  value: number | string | boolean,
): LiteralPattern {
  return { kind: "literal", value, span: DEFAULT_SPAN };
}

/**
 * Builds a binding match pattern.
 *
 * @param name - The binding name.
 * @returns The BindingPattern node.
 */
export function bindingPattern(name: string): BindingPattern {
  return { kind: "binding", binding: name, span: DEFAULT_SPAN };
}

/**
 * Builds a wildcard match pattern.
 * @returns The WildcardPattern node.
 */
export function wildcardPattern(): WildcardPattern {
  return { kind: "wildcard", span: DEFAULT_SPAN };
}

/**
 * Builds a match arm.
 *
 * @param pattern - The match pattern.
 * @param body - The arm body block.
 * @param guard - The optional guard expression.
 * @returns The MatchArm node.
 */
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

/**
 * Builds a type alias declaration.
 *
 * @param name - The alias name.
 * @param type - The aliased Type.
 * @returns The TypeAlias node.
 */
export function typeAlias(name: string, type: Type): TypeAlias {
  return { kind: "TypeAlias", name, type, span: DEFAULT_SPAN };
}

/**
 * Builds a newtype declaration.
 *
 * @param name - The newtype name.
 * @param innerType - The inner Type.
 * @returns The NewtypeDecl node.
 */
export function newtypeDecl(name: string, innerType: Type): NewtypeDecl {
  return { kind: "NewtypeDecl", name, innerType, span: DEFAULT_SPAN };
}

/**
 * Builds an opaque type declaration.
 *
 * @param name - The opaque type name.
 * @returns The OpaqueDecl node.
 */
export function opaqueDecl(name: string): OpaqueDecl {
  return { kind: "OpaqueDecl", name, span: DEFAULT_SPAN };
}

/**
 * Builds a trait declaration.
 *
 * @param name - The trait name.
 * @param bounds - The trait bounds.
 * @param methods - The trait method signatures.
 * @returns The TraitDecl node.
 */
export function traitDecl(
  name: string,
  bounds: string[],
  methods: { name: string; params: Param[]; returnType: Type }[],
): TraitDecl {
  return { kind: "TraitDecl", name, bounds, methods, span: DEFAULT_SPAN };
}

/**
 * Builds an impl block declaration.
 *
 * @param trait - The trait name, or null for inherent impl.
 * @param type - The target Type.
 * @param methods - The impl method declarations.
 * @returns The ImplBlock node.
 */
export function implBlock(
  trait: string | null,
  type: Type,
  methods: FnDecl[],
): ImplBlock {
  return { kind: "ImplBlock", trait, type, methods, span: DEFAULT_SPAN };
}

/* ------------------------------------------------------------------ */
/* Program                                                              */
/* ------------------------------------------------------------------ */

/**
 * Builds a Program node.
 *
 * @param statements - The top-level statements.
 * @returns The Program node.
 */
export function program(statements: Statement[]): Program {
  return { kind: "Program", statements, span: DEFAULT_SPAN };
}

/* ------------------------------------------------------------------ */
/* Convenience: main entry point                                        */
/* ------------------------------------------------------------------ */

/**
 * Builds a `fn main(): vec4` entry point.
 *
 * @param body - The main function body block.
 * @returns The FnDecl node for main.
 */
export function mainFn(body: Block): FnDecl {
  return fnDecl("main", [], vec4(), body);
}

/**
 * Builds a `fn main(): vec4` entry point from a list of statements.
 *
 * @param statements - The statements inside main's body.
 * @returns The FnDecl node for main.
 */
export function mainVec4(statements: Statement[]): FnDecl {
  return mainFn(block(statements));
}
