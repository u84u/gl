import { Diagnostic } from "../typechecker";
import { IRModule, IRStructDecl } from "../ir/shader-ir";
import {
  BackendCapabilities,
  ShaderTarget,
  GLSL_ES_300_CAPABILITIES,
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
import {
  validateGLSLModuleIR,
  generateGLSLShaders,
  glslType,
  glslUniformLayout,
  glslStructMap,
} from "./glsl";

export class GlslEs300Backend implements ShaderCodegenBackend {
  readonly id: ShaderTarget = "glsl-es-300";
  readonly version = "3.00";
  readonly capabilities: BackendCapabilities = GLSL_ES_300_CAPABILITIES;

  validate(module: IRModule, file: string): Diagnostic[] {
    if (!module || !Array.isArray(module.items)) {
      return [{
        file,
        span: { line: 1, column: 1 },
        message: "Invalid IR module passed to GLSL ES 3.00 backend",
        code: "INVALID_MODULE",
        severity: "error",
      }];
    }
    const diagnostics = validateGLSLModuleIR(module, file, this.capabilities);
    for (const item of module.items) {
      if (item.kind !== "fn" || item.name !== "main" || (item.stage ?? "fragment") !== "fragment" || item.returnType.kind !== "struct") {
        continue;
      }
      const returnTypeName = item.returnType.name;
      const outputStruct = module.items.find((candidate): candidate is IRStructDecl =>
        candidate.kind === "struct" && candidate.name === returnTypeName,
      );
      const outputs = (outputStruct?.fields ?? [])
        .map((field, index) => ({ field, location: field.location ?? index }))
        .filter(({ field }) => field.builtin === undefined);
      if (outputs.length > 1) {
        diagnostics.push({
          file,
          span: item.span ?? { line: 1, column: 1 },
          message: "GLSL ES 3.00 supports only one fragment output",
          code: "GLSL_ES_300_MULTIPLE_FRAGMENT_OUTPUTS",
          severity: "error",
        });
      } else if (outputs.some(({ location }) => location !== 0)) {
        diagnostics.push({
          file,
          span: item.span ?? { line: 1, column: 1 },
          message: "GLSL ES 3.00 requires the fragment output at location 0",
          code: "GLSL_ES_300_UNSUPPORTED_FRAGMENT_OUTPUT_LOCATION",
          severity: "error",
        });
      }
    }
    return diagnostics;
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
          message: "Invalid IR module passed to GLSL ES 3.00 backend",
          code: "INVALID_MODULE",
          severity: "error",
        }],
      };
    }
    const diagnostics: Diagnostic[] = [];
    let shaders: ShaderArtifact[] = [];

    try {
      const declarations = generateGLSLShaders(module, "glsl-es-300");
      let usedNames = declarations.map((shader) => shader.code).join("\n");
      const outputIdentifier = uniqueIdentifier("_gl_output", usedNames);
      usedNames += ` ${outputIdentifier}`;
      const varyingLocations = new Set<number>();
      for (const { stage, mainFn } of declarations) {
        if (stage === "vertex" && mainFn.returnType.kind === "struct") {
          const returnTypeName = mainFn.returnType.name;
          const outputStruct = module.items.find((item): item is IRStructDecl =>
            item.kind === "struct" && item.name === returnTypeName,
          );
          outputStruct?.fields.forEach((field, index) => {
            if (field.builtin === undefined) varyingLocations.add(field.location ?? index);
          });
        } else if (stage === "fragment") {
          mainFn.params.forEach((param) => {
            if (param.location !== undefined) varyingLocations.add(param.location);
          });
        }
      }
      const varyingNames = new Map<number, string>();
      for (const location of [...varyingLocations].sort((left, right) => left - right)) {
        const name = uniqueIdentifier(varyingName(location), usedNames);
        varyingNames.set(location, name);
        usedNames += ` ${name}`;
      }
      const emitted = generateGLSLShaders(module, "glsl-es-300", { varyingNames });
      shaders = emitted.map(({ stage, code, mainFn }) => {
        const esCode = code.replace(/\boutput\b/g, outputIdentifier);
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
                for (let index = 0; index < structDecl.fields.length; index++) {
                  const field = structDecl.fields[index];
                  if (!field) continue;
                  if (field.builtin === "position") {
                    outputs.push({ name: "gl_Position", type: glslType(field.type), builtin: "position" });
                  } else {
                    const location = field.location ?? index;
                    outputs.push({
                      name: varyingNames.get(location) ?? field.name,
                      type: glslType(field.type),
                      location,
                    });
                  }
                }
              }
            }
          }
        }
        return {
          stage,
          entryPoint: "main",
          code: esCode,
          reflection: {
            entryPoints: [{
              name: "main",
              stage,
              inputs: inputs.map((input) => ({
                ...input,
                name: stage === "fragment" && input.location !== undefined
                  ? varyingNames.get(input.location) ?? input.name
                  : mangleEsIdentifier(input.name, outputIdentifier),
              })),
              outputs: outputs.map((output) => ({
                ...output,
                name: stage === "vertex" && output.location !== undefined
                  ? varyingNames.get(output.location) ?? output.name
                  : mangleEsIdentifier(output.name, outputIdentifier),
              })),
            }],
            resources: resources.map((resource) => ({
              ...resource,
              name: mangleEsIdentifier(resource.name, outputIdentifier),
            })),
            uniforms: uniforms.map((uniform) => ({
              ...uniform,
              name: mangleEsIdentifier(uniform.name, outputIdentifier),
            })),
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

function varyingName(location: number): string {
  return `_gl_varying_${location}`;
}

function mangleEsIdentifier(name: string, outputIdentifier: string): string {
  return name === "output" ? outputIdentifier : name;
}

function uniqueIdentifier(base: string, existingCode: string): string {
  let candidate = base;
  let suffix = 0;
  while (new RegExp(`\\b${escapeRegExp(candidate)}\\b`).test(existingCode)) {
    candidate = `${base}_${++suffix}`;
  }
  return candidate;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const glslEs300Backend = new GlslEs300Backend();
defaultRegistry.register(glslEs300Backend);
