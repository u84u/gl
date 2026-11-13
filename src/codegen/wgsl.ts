import {
  BindingDecl,
  Expression,
  Program,
  Statement,
  StructDecl,
  Type,
} from "../types";

const SCALAR_MAP: Record<string, string> = {
  i8: "i32",
  u8: "u32",
  i16: "i32",
  u16: "u32",
  i32: "i32",
  u32: "u32",
  i64: "i32",
  u64: "u32",
  f16: "f32",
  f32: "f32",
  f64: "f32",
  bf16: "f32",
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

interface SamplerInfo {
  samplerBinding: number;
  samplerName: string;
}

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
function wgslType(t: Type): string {
  switch (t.kind) {
    case "scalar": {
      const mapped = SCALAR_MAP[t.name];
      if (!mapped) throw new Error(`Unknown scalar type: ${t.name}`);
      return mapped;
    }
    case "vector": {
      const prefix = VEC_TYPE_MAP[t.element] || "vec";
      return `${prefix}<${t.element}>`;
    }
    case "struct":
      return t.name;
    case "sampler":
      return "sampler";
    case "quaternion":
      return "vec4<f32>";
    case "matrix": {
      const m = t;
      const prefix = MAT_PREFIX_MAP[m.element] || "";
      if (m.rows === m.columns) {
        return `${prefix}mat${m.rows}x${m.rows}<${m.element}>`;
      }
      return `${prefix}mat${m.columns}x${m.rows}<${m.element}>`;
    }
    case "opaque":
      return t.name;
    case "anonymousStruct":
      return `AnonStruct_${t.fields.length}`;
    case "array":
      return `array<${wgslType(t.element)}, ${t.size}>`;
    default:
      throw new Error(`Cannot emit WGSL type for ${t.kind}`);
  }
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
function buildContext(
  program: Program,
  mainReturnStruct: string | null,
): WgslContext {
  const samplerMap = new Map<string, SamplerInfo>();
  const bindings = program.statements.filter(
    (s): s is BindingDecl => s.kind === "BindingDecl",
  );
  let maxBinding = -1;
  for (const b of bindings) {
    if (b.binding > maxBinding) maxBinding = b.binding;
  }
  let samplerCounter = maxBinding + 1;
  for (const b of bindings) {
    if (b.type.kind === "sampler") {
      samplerMap.set(b.name, {
        samplerBinding: samplerCounter++,
        samplerName: `${b.name}_sampler`,
      });
    }
  }

  const structLocations = new Map<string, Map<string, number>>();
  if (mainReturnStruct) {
    const structDecl = program.statements.find(
      (s): s is StructDecl => s.kind === "StructDecl" && s.name === mainReturnStruct,
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
export function generateWGSL(program: Program): string {
  const lines: string[] = [];
  lines.push("// Generated by @u84u/gl");
  lines.push("");

  const mainIndex = program.statements.findIndex(
    (s): s is Extract<Statement, { kind: "FnDecl" }> => s.kind === "FnDecl" && s.name === "main"
  );

  if (mainIndex === -1) {
    throw new Error("No main function found — fragment shaders require an entry point");
  }

  const mainFn = program.statements[mainIndex] as Extract<Statement, { kind: "FnDecl" }>;
  const returnType = mainFn.returnType;
  if (mainFn.params.length > 0) {
    throw new Error("main must take no parameters");
  }

  const mainReturnStruct =
    returnType.kind === "struct" ? returnType.name : null;
  const ctx = buildContext(program, mainReturnStruct);

  let anythingEmitted = false;
  for (let i = 0; i < program.statements.length; i++) {
    const stmt = program.statements[i];
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

  if (returnType.kind === "vector" && returnType.size === 4) {
    lines.push("@fragment");
    lines.push("fn main() -> @location(0) vec4<f32> {");
    for (const s of mainFn.body.statements) {
      emitStatement(lines, s, 1, ctx);
    }
    lines.push("}");
  } else if (returnType.kind === "struct") {
    lines.push("@fragment");
    lines.push(`fn main() -> ${returnType.name} {`);
    for (const s of mainFn.body.statements) {
      emitStatement(lines, s, 1, ctx);
    }
    lines.push("}");
  } else {
    throw new Error("main must return vec4 or a struct for fragment shaders");
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
  stmt: Statement,
  indent: number,
  ctx: WgslContext,
): void {
  const pad = "  ".repeat(indent);
  switch (stmt.kind) {
    case "StructDecl": {
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
      break;
    }
    case "EnumDecl": {
      // WGSL has no native enum; document the variants as a comment.
      const variants = stmt.variants.map((v) => v.name).join(", ");
      lines.push(`${pad}// enum ${stmt.name} (${variants})`);
      break;
    }
    case "BindingDecl": {
      const group = 0;
      if (stmt.type.kind === "sampler") {
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
        break;
      }
      lines.push(
        `${pad}@group(${group}) @binding(${stmt.binding}) var<uniform> ${stmt.name}: ${wgslType(stmt.type)};`,
      );
      break;
    }
    case "FnDecl": {
      const params = stmt.params
        .map((p) => `${p.name}: ${wgslType(p.type)}`)
        .join(", ");
      lines.push(`${pad}fn ${stmt.name}(${params}): ${wgslType(stmt.returnType)} {`);
      for (const s of stmt.body.statements) {
        emitStatement(lines, s, indent + 1, ctx);
      }
      lines.push(`${pad}}`);
      break;
    }
    case "VarDecl": {
      if (stmt.initializer && stmt.initializer.kind === "MatchExpr") {
        lines.push(`${pad}let ${stmt.name}: ${wgslType(stmt.type)};`);
        emitMatchAssignStatement(lines, stmt.initializer, stmt.name, indent, ctx);
        break;
      }
      let init = "";
      if (stmt.initializer) {
        init = ` = ${emitExpression(stmt.initializer, ctx)}`;
      }
      const kind = stmt.mutable ? "var" : "let";
      lines.push(`${pad}${kind} ${stmt.name}: ${wgslType(stmt.type)}${init};`);
      break;
    }
    case "ReturnStmt": {
      if (!stmt.value) {
        lines.push(`${pad}return;`);
        break;
      }
      lines.push(`${pad}return ${emitExpression(stmt.value, ctx)};`);
      break;
    }
    case "ExpressionStmt": {
      if (stmt.expression.kind === "MatchExpr") {
        emitMatchStatement(lines, stmt.expression, indent, ctx);
        break;
      }
      lines.push(`${pad}${emitExpression(stmt.expression, ctx)};`);
      break;
    }
    case "Block": {
      lines.push(`${pad}{`);
      for (const s of stmt.statements) {
        emitStatement(lines, s, indent + 1, ctx);
      }
      lines.push(`${pad}}`);
      break;
    }
    case "IfStmt": {
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
      break;
    }
    case "WhileStmt": {
      lines.push(`${pad}while ${emitExpression(stmt.condition, ctx)} {`);
      for (const s of stmt.body.statements) {
        emitStatement(lines, s, indent + 1, ctx);
      }
      lines.push(`${pad}}`);
      break;
    }
    case "ForStmt": {
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
        break;
      }
      // C-style for: WGSL has no C-style for, lower to loop + break.
      if (stmt.init) {
        if (stmt.init.kind === "VarDecl") {
          emitStatement(lines, stmt.init, indent, ctx);
        } else if (stmt.init.kind === "ExpressionStmt") {
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
      break;
    }
    case "DoWhileStmt": {
      lines.push(`${pad}loop {`);
      for (const s of stmt.body.statements) {
        emitStatement(lines, s, indent + 1, ctx);
      }
      lines.push(`${pad}  if (!(${emitExpression(stmt.condition, ctx)})) {`);
      lines.push(`${pad}    break;`);
      lines.push(`${pad}  }`);
      lines.push(`${pad}}`);
      break;
    }
    case "LoopStmt": {
      lines.push(`${pad}loop {`);
      for (const s of stmt.body.statements) {
        emitStatement(lines, s, indent + 1, ctx);
      }
      lines.push(`${pad}}`);
      break;
    }
    case "BreakStmt": {
      lines.push(`${pad}break;`);
      break;
    }
    case "ContinueStmt": {
      lines.push(`${pad}continue;`);
      break;
    }
    case "PanicStmt": {
      if (stmt.message) {
        lines.push(`${pad}// panic: ${emitExpression(stmt.message, ctx)}`);
      } else {
        lines.push(`${pad}// panic`);
      }
      break;
    }
    case "UnreachableStmt": {
      lines.push(`${pad}// unreachable`);
      break;
    }
    case "DiscardStmt": {
      lines.push(`${pad}discard;`);
      break;
    }
    case "TypeAlias":
    case "NewtypeDecl":
    case "OpaqueDecl":
      break;
  }
}

/**
 * Emits WGSL code for an expression.
 *
 * @param expr - The expression to emit.
 * @param ctx - The WGSL rendering context.
 * @returns The WGSL expression string.
 */
function emitExpression(expr: Expression, ctx: WgslContext): string {
  switch (expr.kind) {
    case "Identifier":
      return expr.name;
    case "Literal":
      return emitLiteral(expr);
    case "BinaryExpr":
      return `(${emitExpression(expr.left, ctx)} ${expr.operator} ${emitExpression(expr.right, ctx)})`;
    case "UnaryExpr":
      return `(${expr.operator}${emitExpression(expr.operand, ctx)})`;
    case "CallExpr": {
      const calleeName =
        expr.callee.kind === "Identifier"
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
    case "MemberExpr":
      return `${emitExpression(expr.object, ctx)}.${expr.property}`;
    case "SwizzleExpr": {
      const swizzle = expr.components.join("");
      return `${emitExpression(expr.object, ctx)}.${swizzle}`;
    }
    case "IndexExpr":
      return `${emitExpression(expr.object, ctx)}[${emitExpression(expr.index, ctx)}]`;
    case "StructLiteral": {
      const fields = expr.fields.map((f) => {
        if (f.name === null) return `..${emitExpression(f.value, ctx)}`;
        return emitExpression(f.value, ctx);
      }).join(", ");
      return `${expr.typeName}(${fields})`;
    }
    case "ArrayLiteral": {
      const elements = expr.elements.map((e) => emitExpression(e, ctx));
      const elementType = inferWgslElementType(expr.elements[0]!);
      return `array<${elementType}>(${elements.join(", ")})`;
    }
    case "CompoundAssignExpr": {
      return `(${emitExpression(expr.target, ctx)} = ${emitExpression(expr.target, ctx)} ${expr.operator.slice(0, -1)} ${emitExpression(expr.value, ctx)})`;
    }
    case "UpdateExpr": {
      const op = expr.operator === "++" ? "+ 1" : "- 1";
      const operandCode = emitExpression(expr.operand, ctx);
      if (expr.prefix) {
        return `(${operandCode} = ${operandCode} ${op}, ${operandCode})`;
      }
      return `(${operandCode} = ${operandCode} ${op})`;
    }
    case "ConditionalExpr": {
      return `(${emitExpression(expr.test, ctx)} ? ${emitExpression(expr.consequent, ctx)} : ${emitExpression(expr.alternate, ctx)})`;
    }
    case "NullCoalescingExpr": {
      return `(${emitExpression(expr.left, ctx)} != 0 ? ${emitExpression(expr.left, ctx)} : ${emitExpression(expr.right, ctx)})`;
    }
    case "MatchExpr": {
      return emitMatchExpression(expr, ctx);
    }
    case "BlockExpr": {
      const stmts = expr.block.statements;
      if (stmts.length === 0) return "0.0";
      const last = stmts[stmts.length - 1]!;
      if (last.kind === "ExpressionStmt") {
        return emitExpression(last.expression, ctx);
      }
      return "0.0";
    }
  }
}

/**
 * Emits a match expression as an if-else-if-else chain returning a value.
 *
 * @param expr - The MatchExpr to emit.
 * @param ctx - The WGSL rendering context.
 * @returns The WGSL expression string.
 */
function emitMatchExpression(expr: Expression, ctx: WgslContext): string {
  const matchExpr = expr as Extract<Expression, { kind: "MatchExpr" }>;
  const subjectCode = emitExpression(matchExpr.subject, ctx);
  const branches: string[] = [];
  for (let i = 0; i < matchExpr.arms.length; i++) {
    const arm = matchExpr.arms[i]!;
    let condition = "true";
    if (arm.pattern.kind === "literal" && arm.pattern.value !== null) {
      condition = `(${subjectCode} == ${arm.pattern.value})`;
    } else if (arm.pattern.kind === "binding") {
      condition = "true";
    }
    const bodyCode = emitMatchBodyToString(arm.body.statements, ctx);
    if (i === matchExpr.arms.length - 1) {
      branches.push(`else { ${bodyCode} }`);
    } else {
      branches.push(`if (${condition}) { ${bodyCode} }`);
    }
  }
  return `(${branches.join(" ")})`;
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
  expr: Expression,
  indent: number,
  ctx: WgslContext,
): void {
  const matchExpr = expr as Extract<Expression, { kind: "MatchExpr" }>;
  const pad = "  ".repeat(indent);
  const subjectCode = emitExpression(matchExpr.subject, ctx);
  for (let i = 0; i < matchExpr.arms.length; i++) {
    const arm = matchExpr.arms[i]!;
    let condition = "true";
    if (arm.pattern.kind === "literal" && arm.pattern.value !== null) {
      condition = `(${subjectCode} == ${arm.pattern.value})`;
    }
    const isLast = i === matchExpr.arms.length - 1;
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
  expr: Expression,
  target: string,
  indent: number,
  ctx: WgslContext,
): void {
  const matchExpr = expr as Extract<Expression, { kind: "MatchExpr" }>;
  const pad = "  ".repeat(indent);
  const subjectCode = emitExpression(matchExpr.subject, ctx);
  for (let i = 0; i < matchExpr.arms.length; i++) {
    const arm = matchExpr.arms[i]!;
    let condition = "true";
    if (arm.pattern.kind === "literal" && arm.pattern.value !== null) {
      condition = `(${subjectCode} == ${arm.pattern.value})`;
    }
    const isLast = i === matchExpr.arms.length - 1;
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
  stmts: Statement[],
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
    if (isLast && s.kind === "ExpressionStmt") {
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
function emitMatchBodyToString(stmts: Statement[], ctx: WgslContext): string {
  const parts: string[] = [];
  for (const s of stmts) {
    if (s.kind === "ReturnStmt") {
      if (s.value) {
        parts.push(`return ${emitExpression(s.value, ctx)};`);
      } else {
        parts.push("return;");
      }
    } else if (s.kind === "ExpressionStmt") {
      parts.push(`${emitExpression(s.expression, ctx)};`);
    } else if (s.kind === "VarDecl") {
      let init = "";
      if (s.initializer) {
        init = ` = ${emitExpression(s.initializer, ctx)}`;
      }
      const kind = s.mutable ? "var" : "let";
      parts.push(`${kind} ${s.name}: ${wgslType(s.type)}${init};`);
    } else if (s.kind === "Block") {
      parts.push("{ ");
      for (const inner of s.statements) {
        parts.push(emitMatchBodyToString([inner], ctx));
      }
      parts.push(" }");
    } else if (s.kind === "IfStmt") {
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
    } else if (s.kind === "DiscardStmt") {
      parts.push("discard;");
    } else if (s.kind === "BreakStmt") {
      parts.push("break;");
    } else if (s.kind === "ContinueStmt") {
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
function inferWgslElementType(expr: Expression): string {
  if (expr.kind === "Literal") {
    if (expr.literalKind === "int") return "i32";
    if (expr.literalKind === "float") return "f32";
    if (expr.literalKind === "bool") return "bool";
  }
  return "f32";
}

/**
 * Emits WGSL code for a literal expression.
 *
 * @param expr - The Literal expression to emit.
 * @returns The WGSL literal string.
 */
function emitLiteral(expr: Extract<Expression, { kind: "Literal" }>): string {
  const { value, literalKind } = expr;
  if (literalKind === "bool") return value ? "true" : "false";
  if (literalKind === "int") return `${typeof value === "number" ? value : Number(value)}`;
  if (literalKind === "float") {
    const f = typeof value === "number" ? value : Number(value);
    if (Number.isInteger(f)) return `${f}.0`;
    return String(f);
  }
  if (literalKind === "char") {
    return charToCode(typeof value === "string" ? value : String(value)).toString();
  }
  if (literalKind === "color") {
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
