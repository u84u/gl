import type { Program } from "../types";
import { IRModule, IRType, IRExpression, IRStatement, IRModuleItem, IRBlock, IRStructDecl, IRFnDecl, IRField } from "../ir/shader-ir";
import { lowerProgram } from "../ir/lower";
import { Diagnostic, diagnostic } from "../typechecker";
import {
  BackendCapabilities,
  ShaderStage,
  ShaderTarget,
  GLSL_450_CAPABILITIES,
  scalarIsSupported,
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
  i8: "int",
  u8: "uint",
  i16: "int",
  u16: "uint",
  i32: "int",
  u32: "uint",
  i64: "int64_t",
  u64: "uint64_t",
  f16: "float",
  f32: "float",
  f64: "double",
  bf16: "float",
  bool: "bool",
};

// Vector type prefix map shared by glslType and inferGlslElementType.
const VEC_TYPE_MAP: Record<string, string> = {
  f32: "vec",
  f16: "vec",
  f64: "dvec",
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

// Matrix type prefix map shared by glslType and inferGlslElementType.
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
 * Converts a gl type to its GLSL equivalent string.
 *
 * @param t - The gl type to convert.
 * @returns The GLSL type string.
 */
export function glslType(t: IRType): string {
  if ((t.kind === "scalar")) {
    const mapped = SCALAR_MAP[t.name];
    if (!mapped) throw new Error(`Unknown scalar type: ${t.name}`);
    return mapped;
  }
  if ((t.kind === "vector")) {
    const prefix = VEC_TYPE_MAP[t.element] || "vec";
    return `${prefix}${t.size}`;
  }
  if ((t.kind === "struct")) return t.name;
  if ((t.kind === "sampler")) return t.name;
  if (t.kind === "quaternion") return "vec4";
  if ((t.kind === "matrix")) {
    const prefix = MAT_PREFIX_MAP[t.element] || "";
    if (t.rows === t.columns) {
      return `${prefix}mat${t.rows}`;
    }
    return `${prefix}mat${t.columns}x${t.rows}`;
  }
  if ((t.kind === "array")) {
    return `${glslType(t.element)}[${t.size}]`;
  }
  if (t.kind === "opaque") return t.name;
  if (t.kind === "anonymousStruct") {
    // Anonymous structs must be lifted to named structs for GLSL
    return `AnonStruct_${t.fields.length}`;
  }
  throw new Error(`Cannot emit GLSL type for ${t.kind}`);
}

interface GlslUniformLayout {
  size: number;
  align: number;
}

function glslScalarSize(name: string): number {
  return name === "i64" || name === "u64" || name === "f64" ? 8 : 4;
}

function roundUp(value: number, alignment: number): number {
  return alignment <= 1 ? value : Math.ceil(value / alignment) * alignment;
}

/**
 * Computes a natural layout for a standalone GLSL uniform. Standalone uniforms
 * have no std140/std430 block layout, so offsets are reported per declaration
 * and sizes follow the declared type rather than a blanket 16 bytes.
 */
export function glslUniformLayout(
  type: IRType,
  structs: Map<string, IRStructDecl>,
): GlslUniformLayout {
  switch (type.kind) {
    case "scalar": {
      const size = glslScalarSize(type.name);
      return { size, align: size };
    }
    case "vector": {
      const scalar = glslScalarSize(type.element);
      const align = type.size === 2 ? scalar * 2 : scalar * 4;
      return { size: scalar * type.size, align };
    }
    case "matrix": {
      const scalar = glslScalarSize(type.element);
      const columnSize = scalar * type.rows;
      const columnAlign = type.rows === 2 ? scalar * 2 : scalar * 4;
      const stride = roundUp(columnSize, columnAlign);
      return { size: type.columns * stride, align: columnAlign };
    }
    case "array": {
      const element = glslUniformLayout(type.element, structs);
      const stride = roundUp(element.size, element.align);
      return { size: type.size * stride, align: element.align };
    }
    case "struct": {
      const decl = structs.get(type.name);
      return decl ? glslLayoutFields(decl.fields, structs) : { size: 16, align: 16 };
    }
    case "anonymousStruct":
      return glslLayoutFields(type.fields, structs);
    case "tuple":
      return glslLayoutFields(
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

function glslLayoutFields(
  fields: { name: string; type: IRType }[],
  structs: Map<string, IRStructDecl>,
): GlslUniformLayout {
  let offset = 0;
  let align = 1;
  for (const field of fields) {
    const fieldLayout = glslUniformLayout(field.type, structs);
    align = Math.max(align, fieldLayout.align);
    offset = roundUp(offset, fieldLayout.align) + fieldLayout.size;
  }
  return { size: roundUp(offset, align), align };
}

export function glslStructMap(module: IRModule): Map<string, IRStructDecl> {
  const map = new Map<string, IRStructDecl>();
  for (const item of module.items) {
    if (item.kind === "struct") map.set(item.name, item);
  }
  return map;
}

/**
 * Generates GLSL source code for every staged entry point (`fn main`) in the
 * module, returning one artifact per entry point. Each artifact is a complete,
 * standalone shader (header + shared declarations + one entry point).
 *
 * @param module - The lowered IR module.
 * @param target - "glsl-450" or "glsl-es-300".
 * @returns One `{ stage, code, mainFn }` per entry point, in source order.
 * @throws Error if the program has no main function.
 */
export function generateGLSLShaders(
  module: IRModule,
  target?: "glsl-450" | "glsl-es-300",
): Array<{ stage: ShaderStage; code: string; mainFn: IRFnDecl }> {
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
    lines.push(target === "glsl-es-300" ? "#version 300 es" : "#version 450 core");
    lines.push("");

    // Emit every declaration except all `main` entry points. The current
    // entry point is rendered by emitGlslMainBody; other entry points each
    // get their own shader artifact.
    let anythingEmitted = false;
    for (const item of module.items) {
      if (item.kind === "fn" && item.name === "main") continue;
      emitStatement(lines, item, 0, stage, null);
      anythingEmitted = true;
    }

    // Inputs: staged entry-point parameters become shader inputs.
    let inputsEmitted = false;
    for (const p of mainFn.params) {
      if (p.location === undefined) continue;
      lines.push(`layout(location = ${p.location}) in ${glslType(p.type)} ${p.name};`);
      inputsEmitted = true;
    }

    if (anythingEmitted || inputsEmitted) {
      lines.push("");
    }

    emitGlslMainBody(lines, mainFn, stage, module, anythingEmitted || inputsEmitted);
    return { stage, code: lines.join("\n") + "\n", mainFn };
  });
}

/**
 * Backward-compatible single-shader generator: emits the first entry point.
 */
export function generateGLSLFromIR(
  module: IRModule,
  target?: "glsl-450" | "glsl-es-300",
): string {
  return generateGLSLShaders(module, target)[0]!.code;
}

/**
 * Emits the `void main() { ... }` body (plus any output declarations) for a
 * GLSL entry point. `precededByDecls` is true when declarations or inputs
 * were already emitted, so a separating blank line is added.
 */
function emitGlslMainBody(
  lines: string[],
  mainFn: IRFnDecl,
  stage: ShaderStage,
  module: IRModule,
  precededByDecls: boolean,
): void {
  const returnType = mainFn.returnType;
  let outputDeclEmitted = false;
  let outputFields: IRField[] = [];
  let outputStructName = "";

  if (stage === "fragment") {
    if (returnType.kind === "vector" && returnType.size === 4) {
      lines.push("out vec4 fragColor;");
      outputDeclEmitted = true;
    } else if (returnType.kind === "struct") {
      const structDecl = module.items.find(
        (s): s is IRStructDecl => s.kind === "struct" && s.name === returnType.name,
      );
      if (!structDecl) {
        throw new Error(`Unknown struct '${returnType.name}'`);
      }
      outputStructName = returnType.name;
      outputFields = structDecl.fields;
      // Declare varyings for fields with explicit/implicit locations.
      for (let i = 0; i < structDecl.fields.length; i++) {
        const field = structDecl.fields[i];
        if (!field) continue;
        if (field.builtin !== undefined) continue; // builtins are not fragment varyings
        const loc = field.location !== undefined ? field.location : i;
        const glslTypeName = glslType(field.type);
        lines.push(`layout(location = ${loc}) out ${glslTypeName} ${field.name};`);
        outputDeclEmitted = true;
      }
    } else {
      throw new Error("fragment main must return vec4 or a struct");
    }
    } else if (stage === "vertex") {
    if (returnType.kind === "struct") {
      const structDecl = module.items.find(
        (s): s is IRStructDecl => s.kind === "struct" && s.name === returnType.name,
      );
      if (!structDecl) {
        throw new Error(`Unknown struct '${returnType.name}'`);
      }
      outputStructName = returnType.name;
      outputFields = structDecl.fields;
      // Declare varyings for location fields; builtin position maps to gl_Position.
      for (const field of structDecl.fields) {
        if (field.builtin === "position") continue;
        if (field.location === undefined) continue;
        const glslTypeName = glslType(field.type);
        lines.push(`layout(location = ${field.location}) out ${glslTypeName} ${field.name};`);
        outputDeclEmitted = true;
      }
    } else if (returnType.kind !== "vector" || returnType.size !== 4) {
      throw new Error("vertex main must return vec4 (position) or an output struct");
    }
  } else if (stage === "compute") {
    lines.push("layout(local_size_x = 1, local_size_y = 1, local_size_z = 1) in;");
    outputDeclEmitted = true;
  } else {
    throw new Error(`Unknown shader stage: ${stage}`);
  }

  if (outputDeclEmitted || precededByDecls) {
    lines.push("");
  }
  lines.push("void main() {");
  const outputInfo:
    | { structName: string; fields: IRField[] }
    | null = stage === "fragment" || stage === "vertex"
    ? { structName: outputStructName, fields: outputFields }
    : null;
  for (const s of mainFn.body.statements) {
    emitStatement(lines, s, 1, stage, outputInfo);
  }
  lines.push("}");
}

/**
 * Backward-compatible wrapper: lowers a Program AST to IR and delegates to
 * the IR-based generator.
 */
export function generateGLSL(program: Program, target?: "glsl-450" | "glsl-es-300"): string {
  const ir = lowerProgram(program, "test.gl");
  return generateGLSLFromIR(ir, target);
}

/**
 * Emits GLSL code for a statement into the output lines array.
 *
 * @param lines - The output lines array to append to.
 * @param stmt - The statement to emit.
 * @param indent - The indentation level (number of 2-space indent units).
 * @param stage - The shader stage ("fragment", "vertex", "compute").
 * @param outputInfo - Optional output struct info for main function returns.
 */
function emitStatement(
  lines: string[],
  stmt: IRStatement | IRModuleItem,
  indent: number,
  stage: ShaderStage,
  outputInfo: { structName: string; fields: IRField[] } | null = null,
): void {
  const pad = "  ".repeat(indent);
  if ((stmt.kind === "struct")) {
    lines.push(`${pad}struct ${stmt.name} {`);
    for (const field of stmt.fields) {
      let fieldType: string;
      let fieldSuffix = "";
      if ((field.type.kind === "array")) {
        fieldType = glslType(field.type.element);
        fieldSuffix = `[${field.type.size}]`;
      } else {
        fieldType = glslType(field.type);
      }
      lines.push(`${pad}  ${fieldType} ${field.name}${fieldSuffix};`);
    }
    lines.push(`${pad}};`);
    return;
  }
  if ((stmt.kind === "binding")) {
    let declType: string;
    let declSuffix = "";
    if ((stmt.type.kind === "array")) {
      declType = glslType(stmt.type.element);
      declSuffix = `[${stmt.type.size}]`;
    } else {
      declType = glslType(stmt.type);
    }
    const isSamplerBinding = (stmt.type.kind === "sampler");
    const bindingDecl = isSamplerBinding
      ? `layout(binding = ${stmt.binding}) uniform ${declType} ${stmt.name}${declSuffix};`
      : `uniform ${declType} ${stmt.name}${declSuffix};`;
    lines.push(`${pad}${bindingDecl}`);
    return;
  }
  if ((stmt.kind === "fn")) {
    const params = stmt.params
      .map((p) => `${glslType(p.type)} ${p.name}`)
      .join(", ");
    lines.push(`${pad}${glslType(stmt.returnType)} ${stmt.name}(${params}) {`);
    for (const s of stmt.body.statements) {
      emitStatement(lines, s, indent + 1, stage, null);
    }
    lines.push(`${pad}}`);
    return;
  }
  if ((stmt.kind === "varDecl")) {
    let declType: string;
    let declSuffix = "";
    if ((stmt.type.kind === "array")) {
      declType = glslType(stmt.type.element);
      declSuffix = `[${stmt.type.size}]`;
    } else {
      declType = glslType(stmt.type);
    }
    if (stmt.initializer && stmt.initializer.kind === "match") {
      lines.push(`${pad}${declType} ${stmt.name}${declSuffix};`);
      emitMatchAssignStatement(lines, stmt.initializer, stmt.name, indent, stage, outputInfo);
      return;
    }
    let init = "";
    if (stmt.initializer) {
      if ((stmt.initializer.kind === "structLiteral")) {
        const args = stmt.initializer.fields.map((f) => {
          if (f.name === null) return `..${emitExpression(f.value)}`;
          return emitExpression(f.value);
        }).join(", ");
        init = ` = ${declType}(${args})`;
      } else {
        init = ` = ${emitExpression(stmt.initializer)}`;
      }
    }
    lines.push(`${pad}${declType} ${stmt.name}${declSuffix}${init};`);
    return;
  }
    if ((stmt.kind === "return")) {
      if (!stmt.value) {
        if (outputInfo) {
          throw new Error("main must return a value");
        }
        lines.push(`${pad}return;`);
        return;
      }
    if (outputInfo) {
      if (outputInfo.fields.length > 0) {
        lines.push(`${pad}${outputInfo.structName} outVal = ${emitExpression(stmt.value)};`);
        for (const field of outputInfo.fields) {
          if (field.builtin === "position") {
            lines.push(`${pad}gl_Position = outVal.${field.name};`);
          } else {
            lines.push(`${pad}${field.name} = outVal.${field.name};`);
          }
        }
      } else {
        if (stage === "vertex") {
          if ((stmt.value.kind === "structLiteral")) {
            const args = stmt.value.fields.map((f) => emitExpression(f.value)).join(", ");
            lines.push(`${pad}gl_Position = vec4(${args});`);
          } else {
            lines.push(`${pad}gl_Position = ${emitExpression(stmt.value)};`);
          }
        } else {
          if ((stmt.value.kind === "structLiteral")) {
            const args = stmt.value.fields.map((f) => emitExpression(f.value)).join(", ");
            lines.push(`${pad}fragColor = vec4(${args});`);
          } else {
            lines.push(`${pad}fragColor = ${emitExpression(stmt.value)};`);
          }
        }
      }
    } else {
      lines.push(`${pad}return ${emitExpression(stmt.value)};`);
    }
    return;
  }
  if ((stmt.kind === "expressionStmt")) {
    if (stmt.expression.kind === "match") {
      emitMatchStatement(lines, stmt.expression, indent, stage, outputInfo);
      return;
    }
    lines.push(`${pad}${emitExpression(stmt.expression)};`);
    return;
  }
  if ((stmt.kind === "block")) {
    lines.push(`${pad}{`);
    for (const s of stmt.statements) {
      emitStatement(lines, s, indent + 1, stage, outputInfo);
    }
    lines.push(`${pad}}`);
    return;
  }
  if ((stmt.kind === "if")) {
    lines.push(`${pad}if (${emitExpression(stmt.condition)}) {`);
    for (const s of stmt.thenBranch.statements) {
      emitStatement(lines, s, indent + 1, stage, outputInfo);
    }
    lines.push(`${pad}}`);
    if (stmt.elseBranch) {
      lines.push(`${pad}else {`);
      for (const s of stmt.elseBranch.statements) {
        emitStatement(lines, s, indent + 1, stage, outputInfo);
      }
      lines.push(`${pad}}`);
    }
    return;
  }
  if ((stmt.kind === "while")) {
    lines.push(`${pad}while (${emitExpression(stmt.condition)}) {`);
    for (const s of stmt.body.statements) {
      emitStatement(lines, s, indent + 1, stage, outputInfo);
    }
    lines.push(`${pad}}`);
    return;
  }
  if ((stmt.kind === "for")) {
    if (stmt.range) {
      const startCode = emitExpression(stmt.range.start);
      const endCode = emitExpression(stmt.range.end);
      const condOp = stmt.range.inclusive ? "<=" : "<";
      // Loop variable is implicitly an int
      lines.push(`${pad}for (int loopIndex = ${startCode}; loopIndex ${condOp} ${endCode}; loopIndex++) {`);
      for (const s of stmt.body.statements) {
        emitStatement(lines, s, indent + 1, stage, outputInfo);
      }
      lines.push(`${pad}}`);
      return;
    }
    let initStr = "";
    if (stmt.init) {
      if ((stmt.init.kind === "varDecl")) {
        initStr = emitVarDeclStr(stmt.init);
      } else if ((stmt.init.kind === "expressionStmt")) {
        initStr = emitExpression(stmt.init.expression);
      }
    }
    let condStr = stmt.condition ? emitExpression(stmt.condition) : "";
    let incrStr = stmt.increment ? emitExpression(stmt.increment) : "";
    lines.push(`${pad}for (${initStr}; ${condStr}; ${incrStr}) {`);
    for (const s of stmt.body.statements) {
      emitStatement(lines, s, indent + 1, stage, outputInfo);
    }
    lines.push(`${pad}}`);
    return;
  }
  if ((stmt.kind === "doWhile")) {
    lines.push(`${pad}do {`);
    for (const s of stmt.body.statements) {
      emitStatement(lines, s, indent + 1, stage, outputInfo);
    }
    lines.push(`${pad}} while (${emitExpression(stmt.condition)});`);
    return;
  }
  if ((stmt.kind === "loop")) {
    lines.push(`${pad}for (;;) {`);
    for (const s of stmt.body.statements) {
      emitStatement(lines, s, indent + 1, stage, outputInfo);
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
      lines.push(`${pad}// panic: ${emitExpression(stmt.message)}`);
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
  // TypeAlias, NewtypeDecl, OpaqueDecl, EnumDecl, ImplBlock, TraitDecl — transparent
}

/**
 * Emits a GLSL variable declaration string (without trailing semicolon).
 *
 * @param stmt - The VarDecl statement to emit.
 * @returns The GLSL declaration string.
 */
function emitVarDeclStr(stmt: Extract<IRStatement, { kind: "varDecl" }>): string {
  let declType: string;
  let declSuffix = "";
  if ((stmt.type.kind === "array")) {
    declType = glslType(stmt.type.element);
    declSuffix = `[${stmt.type.size}]`;
  } else {
    declType = glslType(stmt.type);
  }
  let init = "";
  if (stmt.initializer) {
    if ((stmt.initializer.kind === "structLiteral")) {
      const args = stmt.initializer.fields.map((f) => {
        if (f.name === null) return `..${emitExpression(f.value)}`;
        return emitExpression(f.value);
      }).join(", ");
      init = ` = ${declType}(${args})`;
    } else {
      init = ` = ${emitExpression(stmt.initializer)}`;
    }
  }
  return `${declType} ${stmt.name}${declSuffix}${init}`;
}

/**
 * Emits GLSL code for an expression.
 *
 * @param expr - The expression to emit.
 * @returns The GLSL expression string.
 */
function emitExpression(expr: IRExpression): string {
  if ((expr.kind === "identifier")) {
    return expr.name;
  }
  if ((expr.kind === "literal")) {
    return emitLiteral(expr);
  }
  if ((expr.kind === "binary")) {
    if (expr.operator === "<=>") {
      const left = emitExpression(expr.left);
      const right = emitExpression(expr.right);
      return `((${left} < ${right}) ? -1 : ((${left} > ${right}) ? 1 : 0))`;
    }
    return `(${emitExpression(expr.left)} ${expr.operator} ${emitExpression(expr.right)})`;
  }
  if ((expr.kind === "unary")) {
    return `(${expr.operator}${emitExpression(expr.operand)})`;
  }
  if ((expr.kind === "call")) {
    const calleeName =
      expr.callee.kind === "identifier" ? expr.callee.name : emitExpression(expr.callee);
    const args = expr.args.map(emitExpression).join(", ");
    const glslBuiltin = glslBuiltinName(calleeName);
    if (glslBuiltin && glslBuiltin.kind === "builtin") {
      return `${glslBuiltin.name}(${args})`;
    }
    if (glslBuiltin && glslBuiltin.kind === "rotate") {
      const xExpr = expr.args[0];
      const sExpr = expr.args[1];
      if (!xExpr || !sExpr) {
        throw new Error("rotateLeft/rotateRight require two arguments");
      }
      const xCode = emitExpression(xExpr);
      const sCode = emitExpression(sExpr);
      const dir = glslBuiltin.dir;
      return `(${xCode} ${dir === "left" ? "<<" : ">>"} ${sCode}) | (${xCode} ${dir === "left" ? ">>" : "<<"} (32 - ${sCode}))`;
    }
    return `${calleeName}(${args})`;
  }
  if ((expr.kind === "member")) {
    return `${emitExpression(expr.object)}.${expr.property}`;
  }
  if ((expr.kind === "swizzle")) {
    const swizzle = expr.components.join("");
    return `${emitExpression(expr.object)}.${swizzle}`;
  }
  if ((expr.kind === "index")) {
    return `${emitExpression(expr.object)}[${emitExpression(expr.index)}]`;
  }
  if ((expr.kind === "structLiteral")) {
    const fields = expr.fields.map((f) => {
      if (f.name === null) return `..${emitExpression(f.value)}`;
      return emitExpression(f.value);
    }).join(", ");
    return `${expr.typeName}(${fields})`;
  }
  if ((expr.kind === "arrayLiteral")) {
    const elements = expr.elements.map(emitExpression).join(", ");
    const elemType = expr.elements.length > 0 ? inferGlslElementType(expr.elements[0]!) : "float";
    return `${elemType}[${expr.elements.length}](${elements})`;
  }
  if ((expr.kind === "compoundAssign")) {
    return `(${emitExpression(expr.target)} = ${emitExpression(expr.target)} ${expr.operator.slice(0, -1)} ${emitExpression(expr.value)})`;
  }
  if ((expr.kind === "assignment")) {
    return `${emitExpression(expr.target)} = ${emitExpression(expr.value)}`;
  }
  if ((expr.kind === "update")) {
    const op = expr.operator === "++" ? "+ 1" : "- 1";
    if (expr.prefix) {
      return `(${emitExpression(expr.operand)} = ${emitExpression(expr.operand)} ${op}, ${emitExpression(expr.operand)})`;
    }
    return `(${emitExpression(expr.operand)} = ${emitExpression(expr.operand)} ${op})`;
  }
  if ((expr.kind === "conditional")) {
    return `(${emitExpression(expr.test)} ? ${emitExpression(expr.consequent)} : ${emitExpression(expr.alternate)})`;
  }
  if ((expr.kind === "nullCoalescing")) {
    return `(${emitExpression(expr.left)} != 0 ? ${emitExpression(expr.left)} : ${emitExpression(expr.right)})`;
  }
  if ((expr.kind === "match")) {
    throw new Error("Cannot emit a match expression in GLSL expression position");
  }
  if ((expr.kind === "blockExpr")) {
    const stmts = expr.block.statements;
    if (stmts.length === 0) return "0.0";
    const last = stmts[stmts.length - 1]!;
    if ((last.kind === "expressionStmt")) {
      return emitExpression(last.expression);
    }
    return "0.0";
  }
  throw new Error("Cannot emit GLSL expression");
}

/**
 * Type guard: literal pattern.
 */
function isLiteralPattern(p: { kind: string }): p is { kind: "literal"; value: number | string | boolean } {
  return p.kind === "literal";
}

/**
 * Emits a match expression used as a statement (if/else chain).
 */
function emitMatchStatement(
  lines: string[],
  expr: Extract<IRExpression, { kind: "match" }>,
  indent: number,
  stage: ShaderStage,
  outputInfo: { structName: string; fields: IRField[] } | null,
): void {
  const pad = "  ".repeat(indent);
  const subject = emitExpression(expr.subject);
  for (let i = 0; i < expr.arms.length; i++) {
    const arm = expr.arms[i]!;
    const condition =
      isLiteralPattern(arm.pattern) && arm.pattern.value !== null
        ? `(${subject} == ${arm.pattern.value})`
        : "true";
    const isLast = i === expr.arms.length - 1;
    const keyword =
      i === 0
        ? `if (${condition})`
        : isLast && condition === "true"
          ? "else"
          : `else if (${condition})`;
    lines.push(`${pad}${keyword} {`);
    for (const s of arm.body.statements) {
      emitStatement(lines, s, indent + 1, stage, outputInfo);
    }
    lines.push(`${pad}}`);
  }
}

/**
 * Emits a match expression as conditional assignments into a target variable.
 */
function emitMatchAssignStatement(
  lines: string[],
  expr: Extract<IRExpression, { kind: "match" }>,
  target: string,
  indent: number,
  stage: ShaderStage,
  outputInfo: { structName: string; fields: IRField[] } | null,
): void {
  const pad = "  ".repeat(indent);
  const subject = emitExpression(expr.subject);
  for (let i = 0; i < expr.arms.length; i++) {
    const arm = expr.arms[i]!;
    const condition =
      isLiteralPattern(arm.pattern) && arm.pattern.value !== null
        ? `(${subject} == ${arm.pattern.value})`
        : "true";
    const isLast = i === expr.arms.length - 1;
    const keyword =
      i === 0
        ? `if (${condition})`
        : isLast && condition === "true"
          ? "else"
          : `else if (${condition})`;
    lines.push(`${pad}${keyword} {`);
    const body = arm.body.statements;
    for (let j = 0; j < body.length; j++) {
      const s = body[j]!;
      if (j === body.length - 1 && s.kind === "expressionStmt") {
        lines.push(`${pad}  ${target} = ${emitExpression(s.expression)};`);
      } else {
        emitStatement(lines, s, indent + 1, stage, outputInfo);
      }
    }
    lines.push(`${pad}}`);
  }
}

/**
 * Maps a gl built-in function name to its GLSL equivalent or rotate operation.
 *
 * @param name - The gl built-in function name.
 * @returns A built-in descriptor, or null if the name is not a recognized built-in.
 */
function glslBuiltinName(name: string): { kind: "builtin"; name: string } | { kind: "rotate"; dir: "left" | "right" } | null {
  const map: Record<string, string> = {
    bitCount: "bitCount",
    extract: "bitfieldExtract",
    insert: "bitfieldInsert",
    reverse: "bitfieldReverse",
    deg: "degrees",
    rad: "radians",
    textureSample: "texture",
  };
  const mapped = map[name];
  if (mapped) return { kind: "builtin", name: mapped };
  if (name === "rotateLeft") return { kind: "rotate", dir: "left" };
  if (name === "rotateRight") return { kind: "rotate", dir: "right" };
  return null;
}

/**
 * Emits GLSL code for a literal expression.
 *
 * @param expr - The Literal expression to emit.
 * @returns The GLSL literal string.
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
    return `0x${typeof value === "string" ? value : String(value)}u`;
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

/**
 * Infers the GLSL element type string from an expression (used for array literals).
 *
 * @param expr - The expression to infer the element type from.
 * @returns The GLSL element type string.
 */
function inferGlslElementType(expr: IRExpression): string {
  if ((expr.kind === "literal")) {
    if ((expr.kind === "literal" && expr.literalKind === "int")) return "int";
    if ((expr.kind === "literal" && expr.literalKind === "float")) return "float";
    if ((expr.kind === "literal" && expr.literalKind === "bool")) return "bool";
  }
  if ((expr.kind === "call")) {
    const callee = expr.callee;
    if ((callee.kind === "identifier")) {
      const name = callee.name;
      if (name.startsWith("mat")) {
        let base = name;
        let prefix = "";
        for (const [k, v] of Object.entries(MAT_PREFIX_MAP)) {
          if (base.startsWith(k)) {
            prefix = v;
            base = base.slice(k.length);
            break;
          }
        }
        return `${prefix}mat${base}`;
      }
      if (name.startsWith("vec")) {
        return name;
      }
      if (name === "quat") return "vec4";
      return "float";
    }
  }
  return "float";
}

/**
 * IR-based GLSL capability validation. Consumes the canonical IR directly.
 */
export function validateGLSLModuleIR(
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
          diagnostic(itemFile, span, `GLSL does not support scalar type '${name}'`, {
            code: "GLSL_UNSUPPORTED_SCALAR",
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
        diagnostic(mainFn.sourceFile ?? file, spanOf(mainFn), `GLSL target does not support shader stage '${stage}'`, {
          code: "GLSL_UNSUPPORTED_STAGE",
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
          diagnostic(itemFile, span, `GLSL target does not support sampled texture bindings`, {
            code: "GLSL_UNSUPPORTED_RESOURCE",
            severity: "error",
            help: `Supported resource kinds: ${Array.from(capabilities.resourceKinds).join(", ")}`,
          }),
        );
      }
      if (!capabilities.resourceKinds.has("sampler")) {
        diagnostics.push(
          diagnostic(itemFile, span, `GLSL target does not support sampler bindings`, {
            code: "GLSL_UNSUPPORTED_RESOURCE",
            severity: "error",
            help: `Supported resource kinds: ${Array.from(capabilities.resourceKinds).join(", ")}`,
          }),
        );
      }
    } else {
      if (!capabilities.resourceKinds.has("uniformBuffer")) {
        diagnostics.push(
          diagnostic(itemFile, span, `GLSL target does not support uniform buffer bindings`, {
            code: "GLSL_UNSUPPORTED_RESOURCE",
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
 * GLSL code-generation backend. Supports "glsl-450" and "glsl" (alias).
 */
export class GlslBackend implements ShaderCodegenBackend {
  readonly version = "4.50";
  readonly capabilities: BackendCapabilities = GLSL_450_CAPABILITIES;

  constructor(readonly id: ShaderTarget) {}

  validate(module: IRModule, file: string): Diagnostic[] {
    if (!module || !Array.isArray(module.items)) {
      return [{
        file,
        span: { line: 1, column: 1 },
        message: "Invalid IR module passed to GLSL backend",
        code: "INVALID_MODULE",
        severity: "error",
      }];
    }
    return validateGLSLModuleIR(module, file, this.capabilities);
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
          message: "Invalid IR module passed to GLSL backend",
          code: "INVALID_MODULE",
          severity: "error",
        }],
      };
    }
    const diagnostics: Diagnostic[] = [];

    let shaders: ShaderArtifact[] = [];

    try {
      const emitted = generateGLSLShaders(module, "glsl-450");
      shaders = emitted.map(({ stage, code, mainFn }) => {
        const structs = glslStructMap(module);
        const resources: ShaderResourceReflection[] = [];
        const uniforms: ShaderUniformReflection[] = [];
        for (const b of module.items) {
          if (b.kind !== "binding") continue;
          const isSampler = b.type.kind === "sampler";
          resources.push({
            name: b.name,
            kind: isSampler ? "sampler" : "uniform",
            binding: b.binding,
            set: 0,
            stageVisibility: [stage],
          });
          if (!isSampler) {
            const layout = glslUniformLayout(b.type, structs);
            uniforms.push({
              name: b.name,
              type: glslType(b.type),
              offset: 0,
              size: layout.size,
            });
          }
        }
        const inputs: ShaderInterfaceVariable[] = (mainFn.params ?? []).map((p) => ({
          name: p.name,
          type: glslType(p.type),
          ...(p.location !== undefined ? { location: p.location } : {}),
          ...(p.builtin !== undefined ? { builtin: p.builtin } : {}),
        }));
        const outputs: ShaderInterfaceVariable[] = [];
        const rt = mainFn.returnType;
        if (stage !== "compute") {
          if (stage === "fragment") {
            if ((rt.kind === "vector") && rt.size === 4) {
              outputs.push({ name: "fragColor", type: glslType(rt), location: 0 });
            } else if (rt.kind === "struct") {
              const structDecl = module.items.find(
                (s): s is IRStructDecl => s.kind === "struct" && s.name === rt.name,
              );
              if (structDecl) {
                for (let i = 0; i < structDecl.fields.length; i++) {
                  const field = structDecl.fields[i];
                  if (!field) continue;
                  if (field.builtin !== undefined) continue;
                  const loc = field.location !== undefined ? field.location : i;
                  outputs.push({ name: field.name, type: glslType(field.type), location: loc });
                }
              }
            }
          } else if (stage === "vertex") {
            if ((rt.kind === "vector") && rt.size === 4) {
              outputs.push({ name: "gl_Position", type: glslType(rt), builtin: "position" });
            } else if (rt.kind === "struct") {
              const structDecl = module.items.find(
                (s): s is IRStructDecl => s.kind === "struct" && s.name === rt.name,
              );
              if (structDecl) {
                for (const field of structDecl.fields) {
                  if (!field) continue;
                  if (field.builtin === "position") {
                    outputs.push({ name: "gl_Position", type: glslType(field.type), builtin: "position" });
                  } else if (field.location !== undefined) {
                    outputs.push({ name: field.name, type: glslType(field.type), location: field.location });
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
        };
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

export const glsl450Backend = new GlslBackend("glsl-450");
export const glslBackend = new GlslBackend("glsl");
defaultRegistry.register(glsl450Backend);
defaultRegistry.register(glslBackend);


