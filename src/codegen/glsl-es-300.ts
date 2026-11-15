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
          message: "Invalid IR module passed to GLSL ES 3.00 backend",
          code: "INVALID_MODULE",
          severity: "error",
        }],
      };
    }
    const diagnostics: Diagnostic[] = [];
    let shaders: ShaderArtifact[] = [];

    try {
      const emitted = generateGLSLShaders(module, "glsl-es-300");
      shaders = emitted.map(({ stage, code, mainFn }) => {
        const esCode = emitGlslEsCode(code);
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
          code: esCode,
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

/**
 * Applies GLSL ES 3.00 post-processing to a single shader: inserts the
 * `precision mediump float;` qualifier after the version header, ensures the
 * version is on the first line, and drops GLSL 4.50 uniform binding layout
 * qualifiers (ES 3.00 uses separate sampler/texture uniforms instead).
 */
function emitGlslEsCode(code: string): string {
  const lines = code.split("\n");
  const versionIdx = lines.findIndex((l) => l.startsWith("#version 300 es"));
  if (versionIdx !== -1) {
    lines.splice(versionIdx + 1, 0, "precision mediump float;");
    lines.splice(versionIdx + 2, 0, "");
    const preceding = lines.splice(0, versionIdx);
    lines.splice(2, 0, ...preceding);
  }
  return lines.join("\n").replace(/^layout\(binding = \d+\) uniform /gm, "uniform ");
}

export const glslEs300Backend = new GlslEs300Backend();
defaultRegistry.register(glslEs300Backend);
