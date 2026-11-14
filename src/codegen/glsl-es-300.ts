import { Diagnostic } from "../typechecker";
import { IRModule, IRModuleItem, IRAnonymousStruct } from "../ir/shader-ir";
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
      const resources = module.items
        .filter((s): s is Extract<IRModuleItem, { kind: "binding" }> => s.kind === "binding")
        .map((b) => ({
          name: b.name,
          kind: (b.type.kind === "sampler") ? "sampler" : "uniformBuffer",
          binding: b.binding,
          set: 0,
          stageVisibility: [stage],
        }));
      const inputs = mainStmt
        ? mainStmt.params.map((p) => ({ name: p.name, type: glslType(p.type) }))
        : [];
      const outputs: { name: string; type: string }[] = [];
      if (mainStmt && stage !== "compute") {
        const rt = mainStmt.returnType;
        if (rt.kind === "anonymousStruct") {
          for (const f of (rt as IRAnonymousStruct).fields) {
            outputs.push({ name: f.name, type: glslType(f.type) });
          }
        } else {
          outputs.push({ name: "result", type: glslType(rt) });
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
