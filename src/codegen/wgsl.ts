import type { Program } from "../types";
import { IRModule, IRType, IRExpression, IRStatement, IRModuleItem, IRBlock, IRAnonymousStruct } from "../ir/shader-ir";
import { lowerProgram } from "../ir/lower";
import { Diagnostic, diagnostic } from "../typechecker";
import {
  BackendCapabilities,
  ShaderTarget,
  WGSL_CAPABILITIES,
  scalarIsSupported,
  ShaderStage,
} from "./capabilities";
import {
  ShaderCodegenBackend,
  CodegenOptions,
  BackendOutput,
  ShaderArtifact,
  defaultRegistry,
} from "./backend";

const SCALAR_MAP: Record<string, string> = {
  i8: "i32",
  u8: "u32",
  i16: "i32",
  u16: "u32",
  i32: "i32",
  u32: "u32",
  f16: "f16",
  f32: "f32",
  bool: "bool",
};

const VEC_TYPE_MAP: Record<string, string> = {
  f32: "vec",
  f16: "vec",
  f64: "vec",
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

// WGSL constructor names carry an explicit element type parameter.
const CONSTRUCTOR_TYPE_MAP: Record<string, string> = {
  vec2: "vec2<f32>",
  vec3: "vec3<f32>",
  vec4: "vec4<f32>",
  ivec2: "ivec2<i32>",
  ivec3: "ivec3<i32>",
  ivec4: "ivec4<i32>",
  uvec2: "uvec2<u32>",
  uvec3: "uvec3<u32>",
  uvec4: "uvec4<u32>",
  bvec2: "bvec2<bool>",
  bvec3: "bvec3<bool>",
  bvec4: "bvec4<bool>",
  dvec2: "vec2<f64>",
  dvec3: "vec3<f64>",
  dvec4: "vec4<f64>",
  mat2: "mat2x2<f32>",
  mat3: "mat3x3<f32>",
  mat4: "mat4x4<f32>",
  quat: "vec4<f32>",
};

// gl built-in names that differ in WGSL.
const WGSL_BUILTIN_NAME_MAP: Record<string, string> = {
  deg: "degrees",
  rad: "radians",
};

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
 * Maps a gl sampler name to its WGSL texture type.
 *
 * @param name - The gl sampler name (e.g. "sampler2D").
 * @returns The WGSL texture type string.
 */
function samplerTextureType(name: string): string {
  const map: Record<string, string> = {
    sampler2D: "texture_2d<f32>",
    sampler3D: "texture_3d<f32>",
    samplerCube: "texture_cube<f32>",
    sampler2DArray: "texture_2d_array<f32>",
    samplerCubeArray: "texture_cube_array<f32>",
    sampler2DShadow: "texture_depth_2d<f32>",
    samplerCubeShadow: "texture_depth_cube<f32>",
    samplerBuffer: "texture_buffer<f32>",
  };
  return map[name] ?? "texture_2d<f32>";
}

/**
 * Converts a gl type to its WGSL equivalent string.
 *
 * @param t - The gl type to convert.
 * @returns The WGSL type string.
 */
function wgslType(t: IRType): string {
  if ((t.kind === "scalar")) {
    const mapped = SCALAR_MAP[t.name];
    if (!mapped) throw new Error(`Unknown scalar type: ${t.name}`);
    return mapped;
  }
  if ((t.kind === "vector")) {
    const prefix = VEC_TYPE_MAP[t.element] || "vec";
    return `${prefix}<${t.element}>`;
  }
  if ((t.kind === "struct")) return t.name;
  if ((t.kind === "sampler")) return "sampler";
  if (t.kind === "quaternion") return "vec4<f32>";
  if ((t.kind === "matrix")) {
    const prefix = MAT_PREFIX_MAP[t.element] || "";
    if (t.rows === t.columns) {
      return `${prefix}mat${t.rows}x${t.rows}<${t.element}>`;
    }
    return `${prefix}mat${t.columns}x${t.rows}<${t.element}>`;
  }
  if (t.kind === "opaque") return t.name;
  if (t.kind === "anonymousStruct") {
    return `AnonStruct_${t.fields.length}`;
  }
  if ((t.kind === "array")) {
    return `array<${wgslType(t.element)}, ${t.size}>`;
  }
  throw new Error(`Cannot emit WGSL type for ${t.kind}`);
}

interface WgslContext {
  samplerMap: Map<string, SamplerInfo>;
  structLocations: Map<string, Map<string, number>>;
  emittedSamplers: Set<number>;
}

/**
 * Builds the WgslContext from the program: assigns sampler bindings to every
 * sampler texture binding and records which struct fields need location
 * attributes when that struct is main's return type.
 *
 * @param program - The parsed Program AST.
 * @param mainReturnStruct - The struct name main returns, or null.
 * @returns The WgslContext.
 */
interface SamplerInfo {
  samplerBinding: number;
  samplerName: string;
}

function buildContext(
  module: IRModule,
  mainReturnStruct: string | null,
): WgslContext {
  const samplerMap = new Map<string, SamplerInfo>();
  const bindings = module.items.filter(
    (s): s is Extract<IRModuleItem, { kind: "binding" }> => s.kind === "binding",
  );
  let maxBinding = -1;
  for (const b of bindings) {
    if (b.binding > maxBinding) maxBinding = b.binding;
  }
  let samplerCounter = maxBinding + 1;
  for (const b of bindings) {
    if ((b.type.kind === "sampler")) {
      samplerMap.set(b.name, {
        samplerBinding: samplerCounter++,
        samplerName: `${b.name}_sampler`,
      });
    }
  }

  const structLocations = new Map<string, Map<string, number>>();
  if (mainReturnStruct) {
    const structDecl = module.items.find(
      (s): s is Extract<IRModuleItem, { kind: "struct" }> => s.kind === "struct" && s.name === mainReturnStruct,
    );
    if (structDecl) {
      const locations = new Map<string, number>();
      for (let i = 0; i < structDecl.fields.length; i++) {
        const field = structDecl.fields[i];
        if (field) locations.set(field.name, i);
      }
      structLocations.set(mainReturnStruct, locations);
    }
  }

  return { samplerMap, structLocations, emittedSamplers: new Set() };
}

/**
 * Generates WGSL source code from a parsed Program AST.
 *
 * @param program - The parsed Program AST.
 * @returns The generated WGSL source code string.
 * @throws Error if the program has no main function or main has invalid signature.
 */
export function generateWGSLFromIR(module: IRModule): string {
  const lines: string[] = [];
  lines.push("// Generated by @u84u/gl");
  lines.push("");

  const mainIndex = module.items.findIndex(
    (s): s is Extract<IRModuleItem, { kind: "fn" }> => s.kind === "fn" && s.name === "main"
  );

  if (mainIndex === -1) {
    throw new Error("No main function found — fragment shaders require an entry point");
  }

  const mainFnStmt = module.items[mainIndex];
  if (!mainFnStmt) {
    throw new Error("main statement is undefined");
  }
  if (!(mainFnStmt.kind === "fn")) {
    throw new Error("main is not a function declaration");
  }
  const mainFn = mainFnStmt;
  const returnType = mainFn.returnType;
  if (mainFn.params.length > 0) {
    throw new Error("main must take no parameters");
  }

  const mainReturnStruct =
    (returnType.kind === "struct") ? returnType.name : null;
  const ctx = buildContext(module, mainReturnStruct);

  let anythingEmitted = false;
  for (let i = 0; i < module.items.length; i++) {
    const stmt = module.items[i];
    if (!stmt) continue;
    if (i === mainIndex) continue;
    emitStatement(lines, stmt, 0, ctx);
    anythingEmitted = true;
  }

  // Emit any sampler declarations that were deferred.
  for (const [, info] of ctx.samplerMap) {
    if (ctx.emittedSamplers.has(info.samplerBinding)) continue;
    lines.push(
      `@group(0) @binding(${info.samplerBinding}) var ${info.samplerName}: sampler;`,
    );
    ctx.emittedSamplers.add(info.samplerBinding);
  }

  if (anythingEmitted) {
    lines.push("");
  }

  const stage = mainFn.stage ?? "fragment";

  if (stage === "fragment") {
    if ((returnType.kind === "vector") && returnType.size === 4) {
      lines.push("@fragment");
      lines.push("fn main() -> @location(0) vec4<f32> {");
      for (const s of mainFn.body.statements) {
        emitStatement(lines, s, 1, ctx);
      }
      lines.push("}");
    } else if ((returnType.kind === "struct")) {
      lines.push("@fragment");
      lines.push(`fn main() -> ${returnType.name} {`);
      for (const s of mainFn.body.statements) {
        emitStatement(lines, s, 1, ctx);
      }
      lines.push("}");
    } else {
      throw new Error("fragment main must return vec4 or a struct");
    }
  } else if (stage === "vertex") {
    if ((returnType.kind === "vector") && returnType.size === 4) {
      lines.push("@vertex");
      lines.push("fn main() -> @builtin(position) vec4<f32> {");
      for (const s of mainFn.body.statements) {
        emitStatement(lines, s, 1, ctx);
      }
      lines.push("}");
    } else {
      throw new Error("vertex main must return vec4 (position)");
    }
  } else if (stage === "compute") {
    lines.push("@compute @workgroup_size(1, 1, 1)");
    lines.push("fn main() {");
    for (const s of mainFn.body.statements) {
      emitStatement(lines, s, 1, ctx);
    }
    lines.push("}");
  } else {
    throw new Error(`Unknown shader stage: ${stage}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Emits WGSL code for a statement into the output lines array.
 *
 * @param lines - The output lines array to append to.
 * @param stmt - The statement to emit.
 * @param indent - The indentation level (number of 2-space indent units).
 * @param ctx - The WGSL rendering context.
 */
function emitStatement(
  lines: string[],
  stmt: IRStatement | IRModuleItem,
  indent: number,
  ctx: WgslContext,
): void {
  const pad = "  ".repeat(indent);
  if ((stmt.kind === "struct")) {
    const locations = ctx.structLocations.get(stmt.name);
    lines.push(`${pad}struct ${stmt.name} {`);
    for (const field of stmt.fields) {
      let fieldDecl = `${field.name}: ${wgslType(field.type)}`;
      if (locations) {
        const loc = locations.get(field.name);
        if (loc !== undefined) {
          fieldDecl = `@location(${loc}) ${fieldDecl}`;
        }
      }
      lines.push(`${pad}  ${fieldDecl},`);
    }
    lines.push(`${pad}};`);
    return;
  }
  if ((stmt.kind === "enum")) {
    // WGSL has no native enum; document the variants as a comment.
    const variants = stmt.variants.map((v) => v.name).join(", ");
    lines.push(`${pad}// enum ${stmt.name} (${variants})`);
    return;
  }
  if ((stmt.kind === "binding")) {
    const group = 0;
    if ((stmt.type.kind === "sampler")) {
      const info = ctx.samplerMap.get(stmt.name);
      const declType = samplerTextureType(stmt.type.name);
      lines.push(
        `${pad}@group(${group}) @binding(${stmt.binding}) var ${stmt.name}: ${declType};`,
      );
      if (info && !ctx.emittedSamplers.has(info.samplerBinding)) {
        lines.push(
          `${pad}@group(${group}) @binding(${info.samplerBinding}) var ${info.samplerName}: sampler;`,
        );
        ctx.emittedSamplers.add(info.samplerBinding);
      }
      return;
    }
    lines.push(
      `${pad}@group(${group}) @binding(${stmt.binding}) var<uniform> ${stmt.name}: ${wgslType(stmt.type)};`,
    );
    return;
  }
  if ((stmt.kind === "fn")) {
    const params = stmt.params
      .map((p) => `${p.name}: ${wgslType(p.type)}`)
      .join(", ");
    lines.push(`${pad}fn ${stmt.name}(${params}): ${wgslType(stmt.returnType)} {`);
    for (const s of stmt.body.statements) {
      emitStatement(lines, s, indent + 1, ctx);
    }
    lines.push(`${pad}}`);
    return;
  }
  if ((stmt.kind === "varDecl")) {
    if (stmt.initializer && (stmt.initializer.kind === "match")) {
      lines.push(`${pad}let ${stmt.name}: ${wgslType(stmt.type)};`);
      emitMatchAssignStatement(lines, stmt.initializer, stmt.name, indent, ctx);
      return;
    }
    let init = "";
    if (stmt.initializer) {
      init = ` = ${emitExpression(stmt.initializer, ctx)}`;
    }
    const kind = stmt.mutable ? "var" : "let";
    lines.push(`${pad}${kind} ${stmt.name}: ${wgslType(stmt.type)}${init};`);
    return;
  }
  if ((stmt.kind === "return")) {
    if (!stmt.value) {
      lines.push(`${pad}return;`);
      return;
    }
    lines.push(`${pad}return ${emitExpression(stmt.value, ctx)};`);
    return;
  }
  if ((stmt.kind === "expressionStmt")) {
    if ((stmt.expression.kind === "match")) {
      emitMatchStatement(lines, stmt.expression, indent, ctx);
      return;
    }
    lines.push(`${pad}${emitExpression(stmt.expression, ctx)};`);
    return;
  }
  if ((stmt.kind === "block")) {
    lines.push(`${pad}{`);
    for (const s of stmt.statements) {
      emitStatement(lines, s, indent + 1, ctx);
    }
    lines.push(`${pad}}`);
    return;
  }
  if ((stmt.kind === "if")) {
    lines.push(`${pad}if ${emitExpression(stmt.condition, ctx)} {`);
    for (const s of stmt.thenBranch.statements) {
      emitStatement(lines, s, indent + 1, ctx);
    }
    lines.push(`${pad}}`);
    if (stmt.elseBranch) {
      lines.push(`${pad}else {`);
      for (const s of stmt.elseBranch.statements) {
        emitStatement(lines, s, indent + 1, ctx);
      }
      lines.push(`${pad}}`);
    }
    return;
  }
  if ((stmt.kind === "while")) {
    lines.push(`${pad}while ${emitExpression(stmt.condition, ctx)} {`);
    for (const s of stmt.body.statements) {
      emitStatement(lines, s, indent + 1, ctx);
    }
    lines.push(`${pad}}`);
    return;
  }
  if ((stmt.kind === "for")) {
    if (stmt.range) {
      const { variable, start, end, inclusive } = stmt.range;
      const startCode = emitExpression(start, ctx);
      const endCode = emitExpression(end, ctx);
      const condOp = inclusive ? "<=" : "<";
      // Declare the loop variable directly so body references to it resolve.
      lines.push(`${pad}var ${variable} = ${startCode};`);
      lines.push(`${pad}loop {`);
      lines.push(`${pad}  if (!(${variable} ${condOp} ${endCode})) {`);
      lines.push(`${pad}    break;`);
      lines.push(`${pad}  }`);
      for (const s of stmt.body.statements) {
        emitStatement(lines, s, indent + 2, ctx);
      }
      lines.push(`${pad}  ${variable} = ${variable} + 1;`);
      lines.push(`${pad}}`);
      return;
    }
    // C-style for: WGSL has no C-style for, lower to loop + break.
    if (stmt.init) {
      if ((stmt.init.kind === "varDecl")) {
        emitStatement(lines, stmt.init, indent, ctx);
      } else if ((stmt.init.kind === "expressionStmt")) {
        emitStatement(lines, stmt.init, indent, ctx);
      }
    }
    lines.push(`${pad}loop {`);
    if (stmt.condition) {
      lines.push(`${pad}  if (!(${emitExpression(stmt.condition, ctx)})) {`);
      lines.push(`${pad}    break;`);
      lines.push(`${pad}  }`);
    }
    for (const s of stmt.body.statements) {
      emitStatement(lines, s, indent + 1, ctx);
    }
    if (stmt.increment) {
      lines.push(`${pad}  ${emitExpression(stmt.increment, ctx)};`);
    }
    lines.push(`${pad}}`);
    return;
  }
  if ((stmt.kind === "doWhile")) {
    lines.push(`${pad}loop {`);
    for (const s of stmt.body.statements) {
      emitStatement(lines, s, indent + 1, ctx);
    }
    lines.push(`${pad}  if (!(${emitExpression(stmt.condition, ctx)})) {`);
    lines.push(`${pad}    break;`);
    lines.push(`${pad}  }`);
    lines.push(`${pad}}`);
    return;
  }
  if ((stmt.kind === "loop")) {
    lines.push(`${pad}loop {`);
    for (const s of stmt.body.statements) {
      emitStatement(lines, s, indent + 1, ctx);
    }
    lines.push(`${pad}}`);
    return;
  }
  if ((stmt.kind === "break")) {
    lines.push(`${pad}break;`);
    return;
  }
  if ((stmt.kind === "continue")) {
    lines.push(`${pad}continue;`);
    return;
  }
  if ((stmt.kind === "panic")) {
    if (stmt.message) {
      lines.push(`${pad}// panic: ${emitExpression(stmt.message, ctx)}`);
    } else {
      lines.push(`${pad}// panic`);
    }
    return;
  }
  if ((stmt.kind === "unreachable")) {
    lines.push(`${pad}// unreachable`);
    return;
  }
  if ((stmt.kind === "discard")) {
    lines.push(`${pad}discard;`);
    return;
  }
  // TypeAlias, NewtypeDecl, OpaqueDecl — transparent
}


/**
 * Emits WGSL code for an expression.
 *
 * @param expr - The expression to emit.
 * @param ctx - The WGSL rendering context.
 * @returns The WGSL expression string.
 */
function emitExpression(expr: IRExpression, ctx: WgslContext): string {
  if ((expr.kind === "identifier")) {
    return expr.name;
  }
  if ((expr.kind === "literal")) {
    return emitLiteral(expr);
  }
  if ((expr.kind === "binary")) {
    return `(${emitExpression(expr.left, ctx)} ${expr.operator} ${emitExpression(expr.right, ctx)})`;
  }
  if ((expr.kind === "unary")) {
    return `(${expr.operator}${emitExpression(expr.operand, ctx)})`;
  }
  if ((expr.kind === "call")) {
    const calleeName =
      expr.callee.kind === "identifier"
        ? expr.callee.name
        : emitExpression(expr.callee, ctx);
    const constructorName = CONSTRUCTOR_TYPE_MAP[calleeName];
    const builtinName = WGSL_BUILTIN_NAME_MAP[calleeName];
    const name = constructorName ?? builtinName ?? calleeName;
    const args = expr.args.map((a) => emitExpression(a, ctx)).join(", ");
    if (calleeName === "texture") {
      // texture(tex, uv) -> textureSample(tex, sampler, uv)
      const tex = emitExpression(expr.args[0]!, ctx);
      const uv = emitExpression(expr.args[1]!, ctx);
      const info = ctx.samplerMap.get(tex);
      const samplerName = info ? info.samplerName : "sampler";
      return `textureSample(${tex}, ${samplerName}, ${uv})`;
    }
    return `${name}(${args})`;
  }
  if ((expr.kind === "member")) {
    return `${emitExpression(expr.object, ctx)}.${expr.property}`;
  }
  if ((expr.kind === "swizzle")) {
    const swizzle = expr.components.join("");
    return `${emitExpression(expr.object, ctx)}.${swizzle}`;
  }
  if ((expr.kind === "index")) {
    return `${emitExpression(expr.object, ctx)}[${emitExpression(expr.index, ctx)}]`;
  }
  if ((expr.kind === "structLiteral")) {
    const fields = expr.fields.map((f) => {
      if (f.name === null) return `..${emitExpression(f.value, ctx)}`;
      return emitExpression(f.value, ctx);
    }).join(", ");
    return `${expr.typeName}(${fields})`;
  }
  if ((expr.kind === "arrayLiteral")) {
    const elements = expr.elements.map((e) => emitExpression(e, ctx));
    const elementType = inferWgslElementType(expr.elements[0]!);
    return `array<${elementType}>(${elements.join(", ")})`;
  }
  if ((expr.kind === "compoundAssign")) {
    return `(${emitExpression(expr.target, ctx)} = ${emitExpression(expr.target, ctx)} ${expr.operator.slice(0, -1)} ${emitExpression(expr.value, ctx)})`;
  }
  if ((expr.kind === "update")) {
    const op = expr.operator === "++" ? "+ 1" : "- 1";
    const operandCode = emitExpression(expr.operand, ctx);
    if (expr.prefix) {
      return `(${operandCode} = ${operandCode} ${op}, ${operandCode})`;
    }
    return `(${operandCode} = ${operandCode} ${op})`;
  }
  if ((expr.kind === "conditional")) {
    return `(${emitExpression(expr.test, ctx)} ? ${emitExpression(expr.consequent, ctx)} : ${emitExpression(expr.alternate, ctx)})`;
  }
  if ((expr.kind === "nullCoalescing")) {
    return `(${emitExpression(expr.left, ctx)} != 0 ? ${emitExpression(expr.left, ctx)} : ${emitExpression(expr.right, ctx)})`;
  }
  if ((expr.kind === "match")) {
    return emitMatchExpression(expr, ctx);
  }
  if ((expr.kind === "blockExpr")) {
    const stmts = expr.block.statements;
    if (stmts.length === 0) return "0.0";
    const last = stmts[stmts.length - 1]!;
    if ((last.kind === "expressionStmt")) {
      return emitExpression(last.expression, ctx);
    }
    return "0.0";
  }
  throw new Error("Cannot emit WGSL expression");
}

/**
 * Emits a match expression as an if-else-if-else chain returning a value.
 *
 * @param expr - The MatchExpr to emit.
 * @param ctx - The WGSL rendering context.
 * @returns The WGSL expression string.
 */
function emitMatchExpression(expr: IRExpression, ctx: WgslContext): string {
  if (!(expr.kind === "match")) throw new Error("Not a match expression");
  const subjectCode = emitExpression(expr.subject, ctx);
  const branches: string[] = [];
  for (let i = 0; i < expr.arms.length; i++) {
    const arm = expr.arms[i]!;
    let condition = "true";
    if (isLiteralPattern(arm.pattern) && arm.pattern.value !== null) {
      condition = `(${subjectCode} == ${arm.pattern.value})`;
    } else if (isBindingPattern(arm.pattern)) {
      condition = "true";
    }
    const bodyCode = emitMatchBodyToString(arm.body.statements, ctx);
    if (i === expr.arms.length - 1) {
      branches.push(`else { ${bodyCode} }`);
    } else {
      branches.push(`if (${condition}) { ${bodyCode} }`);
    }
  }
  return `(${branches.join(" ")})`;
}

/**
 * Type guard: literal pattern.
 */
function isLiteralPattern(p: { kind: string }): p is { kind: "literal"; value: number | string | boolean } {
  return p.kind === "literal";
}

/**
 * Type guard: binding pattern.
 */
function isBindingPattern(p: { kind: string }): p is { kind: "binding"; binding: string } {
  return p.kind === "binding";
}

/**
 * Emits a match expression used as a statement (if-else-if-else chain).
 *
 * @param lines - The output lines array to append to.
 * @param expr - The MatchExpr to emit.
 * @param indent - The indentation level.
 * @param ctx - The WGSL rendering context.
 */
function emitMatchStatement(
  lines: string[],
  expr: IRExpression,
  indent: number,
  ctx: WgslContext,
): void {
  if (!(expr.kind === "match")) throw new Error("Not a match expression");
  const pad = "  ".repeat(indent);
  const subjectCode = emitExpression(expr.subject, ctx);
  for (let i = 0; i < expr.arms.length; i++) {
    const arm = expr.arms[i]!;
    let condition = "true";
    if (isLiteralPattern(arm.pattern) && arm.pattern.value !== null) {
      condition = `(${subjectCode} == ${arm.pattern.value})`;
    }
    const isLast = i === expr.arms.length - 1;
    const keyword =
      i === 0
        ? `if (${condition})`
        : isLast && condition === "true"
          ? "else"
          : `else if (${condition})`;
    lines.push(`${pad}${keyword} {`);
    for (const s of arm.body.statements) {
      emitStatement(lines, s, indent + 1, ctx);
    }
    lines.push(`${pad}}`);
  }
}

/**
 * Emits a match expression used as a value assigned to a target variable,
 * lowering to an if-else-if-else chain that assigns into the target.
 *
 * @param lines - The output lines array to append to.
 * @param expr - The MatchExpr to emit.
 * @param target - The target variable name to assign into.
 * @param indent - The indentation level.
 * @param ctx - The WGSL rendering context.
 */
function emitMatchAssignStatement(
  lines: string[],
  expr: IRExpression,
  target: string,
  indent: number,
  ctx: WgslContext,
): void {
  if (!(expr.kind === "match")) throw new Error("Not a match expression");
  const pad = "  ".repeat(indent);
  const subjectCode = emitExpression(expr.subject, ctx);
  for (let i = 0; i < expr.arms.length; i++) {
    const arm = expr.arms[i]!;
    let condition = "true";
    if (isLiteralPattern(arm.pattern) && arm.pattern.value !== null) {
      condition = `(${subjectCode} == ${arm.pattern.value})`;
    }
    const isLast = i === expr.arms.length - 1;
    const keyword =
      i === 0
        ? `if (${condition})`
        : isLast && condition === "true"
          ? "else"
          : `else if (${condition})`;
    lines.push(`${pad}${keyword} {`);
    emitMatchBodyAssigning(arm.body.statements, target, indent + 1, ctx, lines);
    lines.push(`${pad}}`);
  }
}

/**
 * Emits match arm body statements, converting the last ExpressionStmt into an
 * assignment to the target variable.
 *
 * @param stmts - The arm body statements.
 * @param target - The target variable name to assign into.
 * @param indent - The indentation level.
 * @param ctx - The WGSL rendering context.
 * @param lines - The output lines array to append to.
 */
function emitMatchBodyAssigning(
  stmts: (IRStatement | IRModuleItem)[],
  target: string,
  indent: number,
  ctx: WgslContext,
  lines: string[],
): void {
  const pad = "  ".repeat(indent);
  const lastIdx = stmts.length - 1;
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i]!;
    const isLast = i === lastIdx;
    if (isLast && (s.kind === "expressionStmt")) {
      lines.push(`${pad}${target} = ${emitExpression(s.expression, ctx)};`);
    } else {
      emitStatement(lines, s, indent, ctx);
    }
  }
}

/**
 * Emits WGSL code for a list of statements as a flat string (used inside match arms).
 * Returns the value produced by the last ExpressionStmt, or empty string.
 *
 * @param stmts - The statements to emit.
 * @param ctx - The WGSL rendering context.
 * @returns The concatenated WGSL code string.
 */
function emitMatchBodyToString(stmts: (IRStatement | IRModuleItem)[], ctx: WgslContext): string {
  const parts: string[] = [];
  for (const s of stmts) {
    if ((s.kind === "return")) {
      if (s.value) {
        parts.push(`return ${emitExpression(s.value, ctx)};`);
      } else {
        parts.push("return;");
      }
    } else if ((s.kind === "expressionStmt")) {
      parts.push(`${emitExpression(s.expression, ctx)};`);
    } else if ((s.kind === "varDecl")) {
      let init = "";
      if (s.initializer) {
        init = ` = ${emitExpression(s.initializer, ctx)}`;
      }
      const kind = s.mutable ? "var" : "let";
      parts.push(`${kind} ${s.name}: ${wgslType(s.type)}${init};`);
    } else if ((s.kind === "block")) {
      parts.push("{ ");
      for (const inner of s.statements) {
        parts.push(emitMatchBodyToString([inner], ctx));
      }
      parts.push(" }");
    } else if ((s.kind === "if")) {
      parts.push(`if (${emitExpression(s.condition, ctx)}) { `);
      for (const inner of s.thenBranch.statements) {
        parts.push(emitMatchBodyToString([inner], ctx));
      }
      parts.push(" }");
      if (s.elseBranch) {
        parts.push(" else { ");
        for (const inner of s.elseBranch.statements) {
          parts.push(emitMatchBodyToString([inner], ctx));
        }
        parts.push(" }");
      }
    } else if ((s.kind === "discard")) {
      parts.push("discard;");
    } else if ((s.kind === "break")) {
      parts.push("break;");
    } else if ((s.kind === "continue")) {
      parts.push("continue;");
    }
  }
  return parts.join(" ");
}

/**
 * Infers the WGSL element type string for an array literal from its first element.
 *
 * @param expr - The first element expression.
 * @returns The WGSL element type string.
 */
function inferWgslElementType(expr: IRExpression): string {
  if ((expr.kind === "literal")) {
    if ((expr.kind === "literal" && expr.literalKind === "int")) return "i32";
    if ((expr.kind === "literal" && expr.literalKind === "float")) return "f32";
    if ((expr.kind === "literal" && expr.literalKind === "bool")) return "bool";
  }
  return "f32";
}

/**
 * Emits WGSL code for a literal expression.
 *
 * @param expr - The Literal expression to emit.
 * @returns The WGSL literal string.
 */
function emitLiteral(expr: Extract<IRExpression, { kind: "literal" }>): string {
  const { value } = expr;
  if ((expr.kind === "literal" && expr.literalKind === "bool")) return value ? "true" : "false";
  if ((expr.kind === "literal" && expr.literalKind === "int")) return `${typeof value === "number" ? value : Number(value)}`;
  if ((expr.kind === "literal" && expr.literalKind === "float")) {
    const f = typeof value === "number" ? value : Number(value);
    if (Number.isInteger(f)) return `${f}.0`;
    return String(f);
  }
  if ((expr.kind === "literal" && expr.literalKind === "char")) {
    return charToCode(typeof value === "string" ? value : String(value)).toString();
  }
  if ((expr.kind === "literal" && expr.literalKind === "color")) {
    return `0x${typeof value === "string" ? value : String(value)}`;
  }
  return String(value);
}

/**
 * Converts a character literal to its numeric code point.
 *
 * @param s - The character string (single char or escape sequence).
 * @returns The numeric code point.
 */
function charToCode(s: string): number {
  if (s.length === 1) return s.charCodeAt(0);
  switch (s) {
    case "\\n": return 10;
    case "\\t": return 9;
    case "\\r": return 13;
    case "\\\\": return 92;
    case "\\'": return 39;
    case '\\"': return 34;
    case "\\0": return 0;
    default: return 0;
  }
}

export function validateWGSLModuleIR(
  module: IRModule,
  file: string,
  capabilities: BackendCapabilities,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<IRType>();

  function checkType(t: IRType, span: { line: number; column: number }): void {
    const nested: IRType[] = [];
    const collect = (x: IRType): void => {
      if (seen.has(x)) return;
      seen.add(x);
      switch (x.kind) {
        case "scalar":
          nested.push(x);
          break;
        case "vector":
        case "matrix":
          nested.push({ kind: "scalar", name: x.element } as IRType);
          break;
        case "array":
          collect(x.element);
          break;
        case "anonymousStruct":
          for (const f of x.fields) collect(f.type);
          break;
        case "union":
          for (const m of x.members) collect(m);
          break;
        case "option":
          collect(x.element);
          break;
        case "result":
          collect(x.ok);
          collect(x.err);
          break;
        case "tuple":
          for (const e of x.elements) collect(e);
          break;
        default:
          break;
      }
    };
    collect(t);
    for (const nt of nested) {
      if (nt.kind !== "scalar") continue;
      const name = nt.name;
      if (!scalarIsSupported(capabilities, name as any)) {
        diagnostics.push(
          diagnostic(file, span, `WGSL does not support scalar type '${name}'`, {
            code: "WGSL_UNSUPPORTED_SCALAR",
            severity: "error",
            help: `Convert to a supported type (${Array.from(capabilities.scalarTypes).join(", ")}) or use an explicit cast.`,
          }),
        );
      }
    }
  }

  function spanOf(s: { span?: { line: number; column: number } }): { line: number; column: number } {
    return s.span ? { line: s.span.line, column: s.span.column } : { line: 1, column: 1 };
  }

  function walkBlock(block: IRBlock): void {
    for (const stmt of block.statements) walkStmt(stmt);
  }

  function walkStmt(stmt: IRStatement | IRModuleItem): void {
    switch (stmt.kind) {
      case "varDecl":
        checkType(stmt.type, spanOf(stmt));
        if (stmt.initializer) { /* expressions not type-checked here */ }
        break;
      case "binding":
        checkType(stmt.type, spanOf(stmt));
        break;
      case "fn":
        for (const p of stmt.params) checkType(p.type, spanOf(stmt));
        checkType(stmt.returnType, spanOf(stmt));
        walkBlock(stmt.body);
        break;
      case "struct":
        for (const f of stmt.fields) checkType(f.type, spanOf(stmt));
        break;
      case "enum":
        for (const v of stmt.variants) {
          if (v.type) checkType(v.type, spanOf(stmt));
        }
        break;
      case "typeAlias":
        checkType(stmt.type, spanOf(stmt));
        break;
      case "newtype":
        checkType(stmt.innerType, spanOf(stmt));
        break;
      case "trait":
        for (const m of stmt.methods) {
          for (const p of m.params) checkType(p.type, spanOf(stmt));
          checkType(m.returnType, spanOf(stmt));
        }
        break;
      case "implBlock":
        checkType(stmt.type, spanOf(stmt));
        for (const m of stmt.methods) {
          for (const p of m.params) checkType(p.type, spanOf(stmt));
          checkType(m.returnType, spanOf(stmt));
        }
        break;
      case "if":
        walkBlock(stmt.thenBranch);
        if (stmt.elseBranch) walkBlock(stmt.elseBranch);
        break;
      case "while":
        walkBlock(stmt.body);
        break;
      case "for":
        walkBlock(stmt.body);
        break;
      case "doWhile":
        walkBlock(stmt.body);
        break;
      case "loop":
        walkBlock(stmt.body);
        break;
      case "block":
        walkBlock(stmt as IRBlock);
        break;
      default:
        break;
    }
  }

  // Stage validation
  const mainFn = module.items.find(
    (s): s is Extract<IRModuleItem, { kind: "fn" }> => s.kind === "fn" && s.name === "main",
  );
  if (mainFn) {
    const stage = mainFn.stage;
    if (!capabilities.shaderStages.has(stage as any)) {
      diagnostics.push(
        diagnostic(file, spanOf(mainFn), `WGSL target does not support shader stage '${stage}'`, {
          code: "WGSL_UNSUPPORTED_STAGE",
          severity: "error",
          help: `Supported stages: ${Array.from(capabilities.shaderStages).join(", ")}`,
        }),
      );
    }
  }

  for (const item of module.items) walkStmt(item);
  return diagnostics;
}

/**
 * WGSL code-generation backend for WebGPU.
 */
export class WgslBackend implements ShaderCodegenBackend {
  readonly id: ShaderTarget = "wgsl";
  readonly version = "1.0";
  readonly capabilities: BackendCapabilities = WGSL_CAPABILITIES;

  validate(module: IRModule, file: string): Diagnostic[] {
    if (!module || !Array.isArray(module.items)) {
      return [{
        file,
        span: { line: 1, column: 1 },
        message: "Invalid IR module passed to WGSL backend",
        code: "INVALID_MODULE",
        severity: "error",
      }];
    }
    return validateWGSLModuleIR(module, file, this.capabilities);
  }

  generate(
    module: IRModule,
    _file: string,
    _options: CodegenOptions = {},
  ): BackendOutput {
    if (!module || !Array.isArray(module.items)) {
      return {
        target: this.id,
        shaders: [],
        diagnostics: [{
          file: _file,
          span: { line: 1, column: 1 },
          message: "Invalid IR module passed to WGSL backend",
          code: "INVALID_MODULE",
          severity: "error",
        }],
      };
    }
    const diagnostics: Diagnostic[] = [];
    let code: string | null = null;

    try {
      code = generateWGSLFromIR(module);
    } catch (err) {
      diagnostics.push({
        file: _file,
        span: { line: 1, column: 1 },
        message: err instanceof Error ? err.message : String(err),
        severity: "error",
      });
    }

    const shaders: ShaderArtifact[] = [];
    if (code) {
      const mainStmt = module.items.find(
        (s): s is Extract<IRModuleItem, { kind: "fn" }> =>
          s.kind === "fn" && s.name === "main",
      );
      const stage = (mainStmt?.stage ?? "fragment") as ShaderStage;
      const resources = module.items
        .filter((s): s is Extract<IRModuleItem, { kind: "binding" }> => s.kind === "binding")
        .map((b) => ({
          name: b.name,
          kind: (b.type.kind === "sampler" ? "sampler" : "uniformBuffer") as string,
          binding: b.binding,
          set: 0,
          stageVisibility: [stage],
        }));
      const inputs = mainStmt
        ? mainStmt.params.map((p) => ({ name: p.name, type: wgslType(p.type) }))
        : [];
      const outputs: { name: string; type: string }[] = [];
      if (mainStmt && stage !== "compute") {
        const rt = mainStmt.returnType;
        if (rt.kind === "anonymousStruct") {
          for (const f of (rt as IRAnonymousStruct).fields) {
            outputs.push({ name: f.name, type: wgslType(f.type) });
          }
        } else {
          outputs.push({ name: "result", type: wgslType(rt) });
        }
      }
      shaders.push({
        stage,
        entryPoint: "main",
        code,
        reflection: {
          entryPoints: [{ name: "main", stage, inputs, outputs }],
          resources,
          uniforms: [],
        },
      } as ShaderArtifact);
    }

    return {
      target: this.id,
      shaders,
      diagnostics,
    };
  }
}

export const wgslBackend = new WgslBackend();
defaultRegistry.register(wgslBackend);

export function generateWGSL(program: Program): string {
  return generateWGSLFromIR(lowerProgram(program, "test.gl"));
}

