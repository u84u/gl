import type { Program } from "../types";
import { IRModule, IRType, IRExpression, IRStatement, IRModuleItem, IRBlock, IRStructDecl, IRFnDecl, IRScalarName } from "../ir/shader-ir";
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
  ShaderResourceReflection,
  ShaderUniformReflection,
  ShaderInterfaceVariable,
  defaultRegistry,
} from "./backend";

const SCALAR_MAP: Record<string, string> = {
  i32: "i32",
  u32: "u32",
  f16: "f16",
  f32: "f32",
  bool: "bool",
};

// WGSL has a single vector family; the element type is a type parameter.
const CONSTRUCTOR_TYPE_MAP: Record<string, string> = {
  vec2: "vec2<f32>",
  vec3: "vec3<f32>",
  vec4: "vec4<f32>",
  ivec2: "vec2<i32>",
  ivec3: "vec3<i32>",
  ivec4: "vec4<i32>",
  uvec2: "vec2<u32>",
  uvec3: "vec3<u32>",
  uvec4: "vec4<u32>",
  bvec2: "vec2<bool>",
  bvec3: "vec3<bool>",
  bvec4: "vec4<bool>",
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

/* ------------------------------------------------------------------ */
/* f16 feature detection                                              */
/* ------------------------------------------------------------------ */

function irTypeUsesF16(t: IRType): boolean {
  switch (t.kind) {
    case "scalar":
      return t.name === "f16";
    case "vector":
    case "matrix":
      return t.element === "f16";
    case "array":
      return irTypeUsesF16(t.element);
    case "anonymousStruct":
      return t.fields.some((f) => irTypeUsesF16(f.type));
    case "union":
      return t.members.some(irTypeUsesF16);
    case "option":
      return irTypeUsesF16(t.element);
    case "result":
      return irTypeUsesF16(t.ok) || irTypeUsesF16(t.err);
    case "tuple":
      return t.elements.some(irTypeUsesF16);
    default:
      return false;
  }
}

function blockUsesF16(block: IRBlock): boolean {
  return block.statements.some(stmtUsesF16);
}

function stmtUsesF16(stmt: IRModuleItem): boolean {
  switch (stmt.kind) {
    case "varDecl":
      return irTypeUsesF16(stmt.type);
    case "fn":
      return (
        stmt.params.some((p) => irTypeUsesF16(p.type)) ||
        irTypeUsesF16(stmt.returnType) ||
        blockUsesF16(stmt.body)
      );
    case "struct":
      return stmt.fields.some((f) => irTypeUsesF16(f.type));
    case "binding":
      return irTypeUsesF16(stmt.type);
    case "enum":
      return stmt.variants.some((v) => v.type !== null && irTypeUsesF16(v.type));
    case "typeAlias":
      return irTypeUsesF16(stmt.type);
    case "newtype":
      return irTypeUsesF16(stmt.innerType);
    case "trait":
      return stmt.methods.some(
        (m) => m.params.some((p) => irTypeUsesF16(p.type)) || irTypeUsesF16(m.returnType),
      );
    case "implBlock":
      return irTypeUsesF16(stmt.type) || stmt.methods.some(stmtUsesF16);
    case "if":
      return blockUsesF16(stmt.thenBranch) || (stmt.elseBranch ? blockUsesF16(stmt.elseBranch) : false);
    case "while":
    case "for":
    case "doWhile":
    case "loop":
      return blockUsesF16(stmt.body);
    case "block":
      return blockUsesF16(stmt);
    default:
      return false;
  }
}

function moduleUsesF16(module: IRModule): boolean {
  return module.items.some(stmtUsesF16);
}

/* ------------------------------------------------------------------ */
/* Uniform layout (WGSL address space)                                */
/* ------------------------------------------------------------------ */

interface UniformLayout {
  size: number;
  align: number;
}

function roundUp(value: number, alignment: number): number {
  return alignment <= 1 ? value : Math.ceil(value / alignment) * alignment;
}

function scalarLayout(name: IRScalarName): UniformLayout {
  return name === "f16" ? { size: 2, align: 2 } : { size: 4, align: 4 };
}

/**
 * Computes the WGSL uniform-buffer layout of a type: each member is aligned to
 * its natural alignment, vectors follow the vec2/vec3+ rules, and arrays use
 * a stride rounded up to the element alignment.
 */
function wgslUniformLayout(
  type: IRType,
  structs: Map<string, IRStructDecl>,
): UniformLayout {
  switch (type.kind) {
    case "scalar":
      return scalarLayout(type.name);
    case "vector": {
      const element = scalarLayout(type.element);
      const align = type.size === 2 ? element.align * 2 : element.align * 4;
      return { size: element.size * type.size, align };
    }
    case "matrix": {
      const element = scalarLayout(type.element);
      const columnSize = element.size * type.rows;
      const columnAlign = type.rows === 2 ? element.align * 2 : element.align * 4;
      const stride = roundUp(columnSize, columnAlign);
      return { size: type.columns * stride, align: columnAlign };
    }
    case "array": {
      const element = wgslUniformLayout(type.element, structs);
      const stride = roundUp(element.size, element.align);
      return { size: type.size * stride, align: element.align };
    }
    case "struct": {
      const decl = structs.get(type.name);
      return decl ? layoutFields(decl.fields, structs) : { size: 16, align: 16 };
    }
    case "anonymousStruct":
      return layoutFields(type.fields, structs);
    case "tuple":
      return layoutFields(
        type.elements.map((fieldType, index) => ({ name: `_${index}`, type: fieldType })),
        structs,
      );
    case "quaternion":
      return { size: 16, align: 16 };
    case "enum":
      return { size: 4, align: 4 };
    default:
      return { size: 16, align: 16 };
  }
}

function layoutFields(
  fields: { name: string; type: IRType }[],
  structs: Map<string, IRStructDecl>,
): UniformLayout {
  let offset = 0;
  let align = 1;
  for (const field of fields) {
    const fieldLayout = wgslUniformLayout(field.type, structs);
    align = Math.max(align, fieldLayout.align);
    offset = roundUp(offset, fieldLayout.align) + fieldLayout.size;
  }
  return { size: roundUp(offset, align), align };
}

function structMap(module: IRModule): Map<string, IRStructDecl> {
  const map = new Map<string, IRStructDecl>();
  for (const item of module.items) {
    if (item.kind === "struct") map.set(item.name, item);
  }
  return map;
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
    const element = SCALAR_MAP[t.element];
    if (!element) throw new Error(`Unsupported WGSL vector element type: ${t.element}`);
    return `vec${t.size}<${element}>`;
  }
  if ((t.kind === "struct")) return t.name;
  if ((t.kind === "sampler")) return "sampler";
  if (t.kind === "quaternion") return "vec4<f32>";
  if ((t.kind === "matrix")) {
    const element = SCALAR_MAP[t.element];
    if (!element) throw new Error(`Unsupported WGSL matrix element type: ${t.element}`);
    if (element !== "f32" && element !== "f16") {
      throw new Error(`WGSL matrices require f32 or f16 elements, got ${t.element}`);
    }
    return `mat${t.columns}x${t.rows}<${element}>`;
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
        if (field) {
          // Explicit @location wins; otherwise fall back to the field index.
          locations.set(field.name, field.location !== undefined ? field.location : i);
        }
      }
      structLocations.set(mainReturnStruct, locations);
    }
  }

  return { samplerMap, structLocations, emittedSamplers: new Set() };
}

/**
 * Generates WGSL source code for every staged entry point (`fn main`) in the
 * module, returning one artifact per entry point. Each artifact is a complete,
 * standalone shader.
 *
 * @param module - The lowered IR module.
 * @returns One `{ stage, code, mainFn }` per entry point, in source order.
 * @throws Error if the program has no main function.
 */
export function generateWGSLShaders(module: IRModule): Array<{ stage: ShaderStage; code: string; mainFn: IRFnDecl }> {
  const mains = module.items.filter(
    (s): s is Extract<IRModuleItem, { kind: "fn" }> => s.kind === "fn" && s.name === "main",
  );
  if (mains.length === 0) {
    throw new Error("No main function found — shaders require an entry point");
  }
  return mains.map((mainFn) => {
    const stage = (mainFn.stage ?? "fragment") as ShaderStage;
    const lines: string[] = [];
    lines.push("// Generated by @u84u/gl");
    if (moduleUsesF16(module)) {
      lines.push("enable f16;");
    }
    lines.push("");

    const mainReturnStruct =
      mainFn.returnType.kind === "struct" ? mainFn.returnType.name : null;
    const ctx = buildContext(module, mainReturnStruct);

    let anythingEmitted = false;
    for (const item of module.items) {
      if (item.kind === "fn" && item.name === "main") continue;
      emitStatement(lines, item, 0, ctx);
      anythingEmitted = true;
    }

    // Emit any sampler declarations that were deferred.
    for (const [, info] of ctx.samplerMap) {
      if (ctx.emittedSamplers.has(info.samplerBinding)) continue;
      lines.push(
        `@group(0) @binding(${info.samplerBinding}) var ${info.samplerName}: sampler;`,
      );
      ctx.emittedSamplers.add(info.samplerBinding);
      anythingEmitted = true;
    }

    if (anythingEmitted) {
      lines.push("");
    }

    emitWGSLEntryPoint(lines, mainFn, ctx, stage);
    return { stage, code: lines.join("\n") + "\n", mainFn };
  });
}

/**
 * Backward-compatible single-shader generator: emits the first entry point.
 */
export function generateWGSLFromIR(module: IRModule): string {
  return generateWGSLShaders(module)[0]!.code;
}

/**
 * Emits a single WGSL entry point function with its stage attribute, parameter
 * attributes, and return type.
 */
function emitWGSLEntryPoint(
  lines: string[],
  mainFn: IRFnDecl,
  ctx: WgslContext,
  stage: ShaderStage,
): void {
  const returnType = mainFn.returnType;

  let stageAttr: string;
  if (stage === "vertex") stageAttr = "@vertex";
  else if (stage === "compute") stageAttr = "@compute @workgroup_size(1, 1, 1)";
  else stageAttr = "@fragment";

  const params = (mainFn.params ?? []).map((p) => {
    let decl = `${p.name}: ${wgslType(p.type)}`;
    if (p.builtin) decl = `@builtin(${p.builtin}) ${decl}`;
    else if (p.location !== undefined) decl = `@location(${p.location}) ${decl}`;
    return decl;
  }).join(", ");

  let retType = "";
  if (stage === "fragment") {
    if (returnType.kind === "vector" && returnType.size === 4) {
      retType = "-> @location(0) vec4<f32>";
    } else if (returnType.kind === "struct") {
      retType = `-> ${returnType.name}`;
    } else {
      throw new Error("fragment main must return vec4 or a struct");
    }
  } else if (stage === "vertex") {
    if (returnType.kind === "vector" && returnType.size === 4) {
      retType = "-> @builtin(position) vec4<f32>";
    } else if (returnType.kind === "struct") {
      retType = `-> ${returnType.name}`;
    } else {
      throw new Error("vertex main must return vec4 (position) or an output struct");
    }
  } else if (stage === "compute") {
    retType = "";
  } else {
    throw new Error(`Unknown shader stage: ${stage}`);
  }

  lines.push(stageAttr);
  const paramsPart = params.length > 0 ? params : "";
  const retPart = retType.length > 0 ? ` ${retType}` : "";
  lines.push(`fn main(${paramsPart})${retPart} {`);
  emitStatements(lines, mainFn.body.statements, 1, ctx);
  lines.push("}");
}

/**
 * Emits WGSL code for a statement into the output lines array.
 *
 * @param lines - The output lines array to append to.
 * @param stmt - The statement to emit.
 * @param indent - The indentation level (number of 2-space indent units).
 * @param ctx - The WGSL rendering context.
 */
/**
 * Emits an expression used in statement position. WGSL has no comma operator
 * and assignment is not an expression, so assignments and updates are emitted
 * as real statements and value-only expressions use phony assignment.
 */
function emitExpressionStatement(
  lines: string[],
  expr: IRExpression,
  indent: number,
  ctx: WgslContext,
): void {
  const pad = "  ".repeat(indent);
  if (expr.kind === "match") {
    emitMatchStatement(lines, expr, indent, ctx);
    return;
  }
  if (expr.kind === "compoundAssign") {
    const target = emitExpression(expr.target, ctx);
    lines.push(
      `${pad}${target} = ${target} ${expr.operator.slice(0, -1)} ${emitExpression(expr.value, ctx)};`,
    );
    return;
  }
  if (expr.kind === "assignment") {
    lines.push(
      `${pad}${emitExpression(expr.target, ctx)} = ${emitExpression(expr.value, ctx)};`,
    );
    return;
  }
  if (expr.kind === "update") {
    const target = emitExpression(expr.operand, ctx);
    const op = expr.operator === "++" ? "+" : "-";
    lines.push(`${pad}${target} = ${target} ${op} 1;`);
    return;
  }
  lines.push(`${pad}_ = ${emitExpression(expr, ctx)};`);
}

function statementTerminatesFlow(stmt: IRStatement | IRModuleItem, insideLoop = false): boolean {
  if (stmt.kind === "return" || stmt.kind === "discard") return true;
  if (insideLoop && (stmt.kind === "break" || stmt.kind === "continue")) return true;
  if (stmt.kind === "block") {
    const last = stmt.statements.at(-1);
    return last ? statementTerminatesFlow(last, insideLoop) : false;
  }
  if (stmt.kind === "if") {
    const thenLast = stmt.thenBranch.statements.at(-1);
    const elseLast = stmt.elseBranch?.statements.at(-1);
    return Boolean(
      thenLast && elseLast &&
      statementTerminatesFlow(thenLast, insideLoop) &&
      statementTerminatesFlow(elseLast, insideLoop),
    );
  }
  return false;
}

function emitStatements(
  lines: string[],
  statements: readonly (IRStatement | IRModuleItem)[],
  indent: number,
  ctx: WgslContext,
  insideLoop = false,
): void {
  for (const stmt of statements) {
    emitStatement(lines, stmt, indent, ctx, insideLoop);
    if (statementTerminatesFlow(stmt, insideLoop)) break;
  }
}

function emitStatement(
  lines: string[],
  stmt: IRStatement | IRModuleItem,
  indent: number,
  ctx: WgslContext,
  insideLoop = false,
): void {
  const pad = "  ".repeat(indent);
  if ((stmt.kind === "struct")) {
    const locations = ctx.structLocations.get(stmt.name);
    lines.push(`${pad}struct ${stmt.name} {`);
    for (const field of stmt.fields) {
      let fieldDecl = `${field.name}: ${wgslType(field.type)}`;
      if (locations) {
        const attrs: string[] = [];
        if (field.builtin) attrs.push(`@builtin(${field.builtin})`);
        const loc = locations.get(field.name);
        if (loc !== undefined && !field.builtin) attrs.push(`@location(${loc})`);
        if (attrs.length) fieldDecl = `${attrs.join(" ")} ${fieldDecl}`;
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
    emitStatements(lines, stmt.body.statements, indent + 1, ctx);
    lines.push(`${pad}}`);
    return;
  }
  if ((stmt.kind === "varDecl")) {
    if (stmt.initializer && (stmt.initializer.kind === "match")) {
      // A match expression is lowered to conditional assignments, which WGSL
      // only permits through a mutable local.
      lines.push(`${pad}var ${stmt.name}: ${wgslType(stmt.type)};`);
      emitMatchAssignStatement(lines, stmt.initializer, stmt.name, indent, ctx);
      return;
    }
    let init = "";
    if (stmt.initializer) {
      init = ` = ${emitExpression(stmt.initializer, ctx)}`;
    }
    // WGSL `let` requires an initializer; an uninitialised local must be `var`.
    const kind = stmt.mutable || !stmt.initializer ? "var" : "let";
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
    emitExpressionStatement(lines, stmt.expression, indent, ctx);
    return;
  }
  if ((stmt.kind === "block")) {
    lines.push(`${pad}{`);
    emitStatements(lines, stmt.statements, indent + 1, ctx, insideLoop);
    lines.push(`${pad}}`);
    return;
  }
  if ((stmt.kind === "if")) {
    lines.push(`${pad}if ${emitExpression(stmt.condition, ctx)} {`);
    emitStatements(lines, stmt.thenBranch.statements, indent + 1, ctx, insideLoop);
    lines.push(`${pad}}`);
    if (stmt.elseBranch) {
      lines.push(`${pad}else {`);
      emitStatements(lines, stmt.elseBranch.statements, indent + 1, ctx, insideLoop);
      lines.push(`${pad}}`);
    }
    return;
  }
  if ((stmt.kind === "while")) {
    lines.push(`${pad}while ${emitExpression(stmt.condition, ctx)} {`);
    emitStatements(lines, stmt.body.statements, indent + 1, ctx, true);
    lines.push(`${pad}}`);
    return;
  }
  if ((stmt.kind === "for")) {
    if (stmt.range) {
      const { variable, start, end, inclusive } = stmt.range;
      const startCode = emitExpression(start, ctx);
      const endCode = emitExpression(end, ctx);
      const condOp = inclusive ? "<=" : "<";
      lines.push(`${pad}for (var ${variable} = ${startCode}; ${variable} ${condOp} ${endCode}; ${variable} = ${variable} + 1) {`);
      emitStatements(lines, stmt.body.statements, indent + 1, ctx, true);
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
    emitStatements(lines, stmt.body.statements, indent + 1, ctx, true);
    if (stmt.increment) {
      lines.push(`${pad}  continuing {`);
      emitExpressionStatement(lines, stmt.increment, indent + 2, ctx);
      lines.push(`${pad}  }`);
    }
    lines.push(`${pad}}`);
    return;
  }
  if ((stmt.kind === "doWhile")) {
    lines.push(`${pad}loop {`);
    emitStatements(lines, stmt.body.statements, indent + 1, ctx, true);
    lines.push(`${pad}  continuing {`);
    lines.push(`${pad}    break if !(${emitExpression(stmt.condition, ctx)});`);
    lines.push(`${pad}  }`);
    lines.push(`${pad}}`);
    return;
  }
  if ((stmt.kind === "loop")) {
    lines.push(`${pad}loop {`);
    emitStatements(lines, stmt.body.statements, indent + 1, ctx, true);
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
    if (expr.operator === "<=>") {
      // WGSL has no spaceship operator; map to -1/0/1 comparisons.
      const left = emitExpression(expr.left, ctx);
      const right = emitExpression(expr.right, ctx);
      return `select(select(i32(0), i32(1), (${left} > ${right})), i32(-1), (${left} < ${right}))`;
    }
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
    if (calleeName === "texture" || calleeName === "textureSample") {
      // texture(tex, uv) / textureSample(tex, uv) -> textureSample(tex, sampler, uv)
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
    return `array<${elementType}, ${expr.elements.length}>(${elements.join(", ")})`;
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
    // WGSL select(falseValue, trueValue, condition)
    return `select(${emitExpression(expr.alternate, ctx)}, ${emitExpression(expr.consequent, ctx)}, ${emitExpression(expr.test, ctx)})`;
  }
  if ((expr.kind === "nullCoalescing")) {
    const left = emitExpression(expr.left, ctx);
    return `select(${emitExpression(expr.right, ctx)}, ${left}, (${left} != 0))`;
  }
  if ((expr.kind === "match")) {
    throw new Error("Cannot emit a match expression in WGSL expression position");
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
 * Type guard: literal pattern.
 */
function isLiteralPattern(p: { kind: string }): p is { kind: "literal"; value: number | string | boolean } {
  return p.kind === "literal";
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

  function checkType(t: IRType, span: { line: number; column: number }, itemFile: string): void {
    const nested: IRType[] = [];
    const collect = (x: IRType): void => {
      if (seen.has(x)) return;
      seen.add(x);
      switch (x.kind) {
        case "scalar":
          nested.push(x);
          break;
        case "vector":
          nested.push({ kind: "scalar", name: x.element } as IRType);
          break;
        case "matrix":
          nested.push({ kind: "scalar", name: x.element } as IRType);
          if (x.element !== "f32" && x.element !== "f16") {
            diagnostics.push(
              diagnostic(itemFile, span, `WGSL does not support matrix element type '${x.element}'`, {
                code: "WGSL_UNSUPPORTED_MATRIX",
                severity: "error",
                help: "WGSL matrices require f32 or f16 elements.",
              }),
            );
          }
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
          diagnostic(itemFile, span, `WGSL does not support scalar type '${name}'`, {
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
    const itemFile = ("sourceFile" in stmt && stmt.sourceFile) || file;
    switch (stmt.kind) {
      case "varDecl":
        checkType(stmt.type, spanOf(stmt), itemFile);
        if (stmt.initializer) { /* expressions not type-checked here */ }
        break;
      case "binding":
        checkType(stmt.type, spanOf(stmt), itemFile);
        break;
      case "fn":
        for (const p of stmt.params) checkType(p.type, spanOf(stmt), itemFile);
        checkType(stmt.returnType, spanOf(stmt), itemFile);
        walkBlock(stmt.body);
        break;
      case "struct":
        for (const f of stmt.fields) checkType(f.type, spanOf(stmt), itemFile);
        break;
      case "enum":
        for (const v of stmt.variants) {
          if (v.type) checkType(v.type, spanOf(stmt), itemFile);
        }
        break;
      case "typeAlias":
        checkType(stmt.type, spanOf(stmt), itemFile);
        break;
      case "newtype":
        checkType(stmt.innerType, spanOf(stmt), itemFile);
        break;
      case "trait":
        for (const m of stmt.methods) {
          for (const p of m.params) checkType(p.type, spanOf(stmt), itemFile);
          checkType(m.returnType, spanOf(stmt), itemFile);
        }
        break;
      case "implBlock":
        checkType(stmt.type, spanOf(stmt), itemFile);
        for (const m of stmt.methods) {
          for (const p of m.params) checkType(p.type, spanOf(stmt), itemFile);
          checkType(m.returnType, spanOf(stmt), itemFile);
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
        diagnostic(mainFn.sourceFile ?? file, spanOf(mainFn), `WGSL target does not support shader stage '${stage}'`, {
          code: "WGSL_UNSUPPORTED_STAGE",
          severity: "error",
          help: `Supported stages: ${Array.from(capabilities.shaderStages).join(", ")}`,
        }),
      );
    }
  }

  // Resource kind validation
  for (const item of module.items) {
    if (item.kind !== "binding") continue;
    const span = spanOf(item);
    const itemFile = item.sourceFile ?? file;
    if (item.type.kind === "sampler") {
      if (!capabilities.resourceKinds.has("sampledTexture")) {
        diagnostics.push(
          diagnostic(itemFile, span, `WGSL target does not support sampled texture bindings`, {
            code: "WGSL_UNSUPPORTED_RESOURCE",
            severity: "error",
            help: `Supported resource kinds: ${Array.from(capabilities.resourceKinds).join(", ")}`,
          }),
        );
      }
      if (!capabilities.resourceKinds.has("sampler")) {
        diagnostics.push(
          diagnostic(itemFile, span, `WGSL target does not support sampler bindings`, {
            code: "WGSL_UNSUPPORTED_RESOURCE",
            severity: "error",
            help: `Supported resource kinds: ${Array.from(capabilities.resourceKinds).join(", ")}`,
          }),
        );
      }
    } else {
      if (!capabilities.resourceKinds.has("uniformBuffer")) {
        diagnostics.push(
          diagnostic(itemFile, span, `WGSL target does not support uniform buffer bindings`, {
            code: "WGSL_UNSUPPORTED_RESOURCE",
            severity: "error",
            help: `Supported resource kinds: ${Array.from(capabilities.resourceKinds).join(", ")}`,
          }),
        );
      }
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

    let shaders: ShaderArtifact[] = [];

    try {
      const emitted = generateWGSLShaders(module);
      shaders = emitted.map(({ stage, code, mainFn }) => {
        const mainReturnStruct =
          mainFn.returnType.kind === "struct" ? mainFn.returnType.name : null;
        // Reuse the same binding plan as code generation so reflection reports
        // the synthesized sampler bindings that are actually emitted.
        const ctx = buildContext(module, mainReturnStruct);
        const structs = structMap(module);
        const resources: ShaderResourceReflection[] = [];
        const uniforms: ShaderUniformReflection[] = [];
        for (const b of module.items) {
          if (b.kind !== "binding") continue;
          const isSampler = b.type.kind === "sampler";
          resources.push({
            name: b.name,
            kind: isSampler ? "sampledTexture" : "uniformBuffer",
            binding: b.binding,
            set: 0,
            stageVisibility: [stage],
          });
          if (isSampler) {
            const samplerInfo = ctx.samplerMap.get(b.name);
            resources.push({
              name: samplerInfo?.samplerName ?? `${b.name}_sampler`,
              kind: "sampler",
              binding: samplerInfo?.samplerBinding ?? b.binding,
              set: 0,
              stageVisibility: [stage],
            });
          } else {
            const layout = wgslUniformLayout(b.type, structs);
            uniforms.push({
              name: b.name,
              type: wgslType(b.type),
              // Each @binding is its own uniform buffer, so the member starts at 0.
              offset: 0,
              size: layout.size,
            });
          }
        }
        const inputs: ShaderInterfaceVariable[] = (mainFn.params ?? []).map((p) => ({
          name: p.name,
          type: wgslType(p.type),
          ...(p.location !== undefined ? { location: p.location } : {}),
          ...(p.builtin !== undefined ? { builtin: p.builtin } : {}),
        }));
        const outputs: ShaderInterfaceVariable[] = [];
        if (stage !== "compute") {
          const rt = mainFn.returnType;
          if (stage === "fragment") {
            if ((rt.kind === "vector") && rt.size === 4) {
              outputs.push({ name: "", type: wgslType(rt), location: 0 });
            } else if (rt.kind === "struct") {
              const structDecl = module.items.find(
                (s): s is Extract<IRModuleItem, { kind: "struct" }> => s.kind === "struct" && s.name === rt.name,
              );
              if (structDecl) {
                for (let i = 0; i < structDecl.fields.length; i++) {
                  const field = structDecl.fields[i];
                  if (!field) continue;
                  if (field.builtin !== undefined) continue;
                  const loc = field.location !== undefined ? field.location : i;
                  outputs.push({ name: field.name, type: wgslType(field.type), location: loc });
                }
              }
            }
          } else if (stage === "vertex") {
            if ((rt.kind === "vector") && rt.size === 4) {
              outputs.push({ name: "gl_Position", type: wgslType(rt), builtin: "position" });
            } else if (rt.kind === "struct") {
              const structDecl = module.items.find(
                (s): s is Extract<IRModuleItem, { kind: "struct" }> => s.kind === "struct" && s.name === rt.name,
              );
              if (structDecl) {
                for (const field of structDecl.fields) {
                  if (!field) continue;
                  if (field.builtin === "position") {
                    outputs.push({ name: "gl_Position", type: wgslType(field.type), builtin: "position" });
                  } else if (field.location !== undefined) {
                    outputs.push({ name: field.name, type: wgslType(field.type), location: field.location });
                  }
                }
              }
            }
          }
        }
        return {
          stage,
          entryPoint: "main",
          code,
          reflection: {
            entryPoints: [{ name: "main", stage, inputs, outputs }],
            resources,
            uniforms,
          },
        } as ShaderArtifact;
      });
    } catch (err) {
      diagnostics.push({
        file: _file,
        span: { line: 1, column: 1 },
        message: err instanceof Error ? err.message : String(err),
        severity: "error",
      });
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

