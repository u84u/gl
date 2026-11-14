import { Statement, isProgram } from "../types";
import { Diagnostic } from "../typechecker";
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
  defaultRegistry,
} from "./backend";
import { generateGLSL } from "./glsl";
import { validateGLSLModule } from "./glsl";

export class GlslEs300Backend implements ShaderCodegenBackend {
  readonly id: ShaderTarget = "glsl-es-300";
  readonly version = "3.00";
  readonly capabilities: BackendCapabilities = GLSL_ES_300_CAPABILITIES;

  validate(ast: unknown, file: string): Diagnostic[] {
    if (!isProgram(ast)) {
      return [{
        file,
        span: { line: 1, column: 1 },
        message: "Invalid program passed to GLSL ES 3.00 backend",
        code: "INVALID_PROGRAM",
        severity: "error",
      }];
    }
    return validateGLSLModule(ast, file, this.capabilities);
  }

  generate(
    ast: unknown,
    _file: string,
    _options: CodegenOptions = {},
  ): BackendOutput {
    if (!isProgram(ast)) {
      return {
        target: this.id,
        shaders: [],
        diagnostics: [{
          file: _file,
          span: { line: 1, column: 1 },
          message: "Invalid program passed to GLSL ES 3.00 backend",
          code: "INVALID_PROGRAM",
          severity: "error",
        }],
      };
    }
    const program = ast;
    const diagnostics: Diagnostic[] = [];
    let code: string | null = null;

    // GLSL ES 3.00 does not support double precision.
    // validateGLSLModule already catches all f64 types via collectTypes
    // (vectors, matrices, arrays, structs, etc.), so no separate scan is needed.

    try {
      const glsl = generateGLSL(program, "glsl-es-300");
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
      const mainStmt = program.statements.find(
        (s): s is Extract<Statement, { kind: "FnDecl" }> =>
          s.kind === "FnDecl" && s.name === "main",
      );
      const stage = mainStmt?.stage ?? "fragment";
      shaders.push({
        stage,
        entryPoint: "main",
        code,
        reflection: {
          entryPoints: [],
          resources: [],
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

export const glslEs300Backend = new GlslEs300Backend();
defaultRegistry.register(glslEs300Backend);
