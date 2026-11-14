import { Diagnostic } from "../typechecker";
import { IRModule, IRModuleItem, IRStructDecl } from "../ir/shader-ir";
import {
  BackendCapabilities,
  ShaderTarget,
  ShaderStage,
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
import { validateGLSLModuleIR, generateGLSLFromIR, glslType } from "./glsl";

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
    let code: string | null = null;

    // GLSL ES 3.00 does not support double precision.
    // validateGLSLModule already catches all f64 types via collectTypes
    // (vectors, matrices, arrays, structs, etc.), so no separate scan is needed.

    try {
      const glsl = generateGLSLFromIR(module, "glsl-es-300");
      // Prepend precision qualifier after version header for fragment shaders.
      const lines = glsl.split("\n");
      const versionIdx = lines.findIndex((l) =>
        l.startsWith("#version 300 es"),
      );
      if (versionIdx !== -1) {
        lines.splice(versionIdx + 1, 0, "precision mediump float;");
        lines.splice(versionIdx + 2, 0, "");
      }
      code = lines.join("\n");
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
      const resources: ShaderResourceReflection[] = [];
      const uniforms: ShaderUniformReflection[] = [];
      let uniformOffset = 0;
      for (const b of module.items) {
        if (b.kind !== "binding") continue;
        const isSampler = b.type.kind === "sampler";
        resources.push({
          name: b.name,
          kind: isSampler ? "sampler" : "uniformBuffer",
          binding: b.binding,
          set: 0,
          stageVisibility: [stage],
        });
        if (!isSampler) {
          const typeName = glslType(b.type);
          const size = typeName === "float" || typeName === "int" || typeName === "uint" || typeName === "bool" ? 4 : 16;
          uniforms.push({
            name: b.name,
            type: typeName,
            offset: uniformOffset,
            size,
          });
          uniformOffset += size;
        }
      }
      const inputs = mainStmt
        ? mainStmt.params.map((p) => ({ name: p.name, type: glslType(p.type) }))
        : [];
      const outputs: ShaderInterfaceVariable[] = [];
      if (mainStmt && stage !== "compute") {
        const rt = mainStmt.returnType;
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
                outputs.push({ name: field.name, type: glslType(field.type), location: i });
              }
            }
          }
        } else if (stage === "vertex") {
          if ((rt.kind === "vector") && rt.size === 4) {
            outputs.push({ name: "gl_Position", type: glslType(rt), builtin: "position" });
          }
        }
      }
      shaders.push({
        stage,
        entryPoint: "main",
        code,
        reflection: {
          entryPoints: [{ name: "main", stage, inputs, outputs }],
          resources,
          uniforms,
        },
      });
    }

    return {
      target: this.id,
      shaders,
      diagnostics,
    };
  }
}

export const glslEs300Backend = new GlslEs300Backend();
defaultRegistry.register(glslEs300Backend);
