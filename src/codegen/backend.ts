import { Diagnostic } from "../typechecker";
import {
  BackendCapabilities,
  ShaderTarget,
  ShaderStage,
} from "./capabilities";

export interface CodegenOptions {
  /** Formatting style: "compact" or "pretty". Defaults to "pretty". */
  format?: "compact" | "pretty";
}

export interface ShaderArtifact {
  stage: ShaderStage;
  entryPoint: string;
  code: string;
  sourceMap?: ShaderSourceMap;
  reflection: ShaderReflection;
}

export interface ShaderSourceMap {
  mappings: string;
  sources: string[];
  names: string[];
}

export interface ShaderReflection {
  entryPoints: ShaderEntryPointReflection[];
  resources: ShaderResourceReflection[];
  uniforms: ShaderUniformReflection[];
}

export interface ShaderEntryPointReflection {
  name: string;
  stage: ShaderStage;
  inputs: ShaderInterfaceVariable[];
  outputs: ShaderInterfaceVariable[];
}

export interface ShaderInterfaceVariable {
  name: string;
  type: string;
  location?: number;
  builtin?: string;
}

export interface ShaderResourceReflection {
  name: string;
  kind: string;
  binding: number;
  set: number;
  stageVisibility: ShaderStage[];
}

export interface ShaderUniformReflection {
  name: string;
  type: string;
  offset: number;
  size: number;
}

export interface BackendOutput {
  target: ShaderTarget;
  shaders: ShaderArtifact[];
  diagnostics: Diagnostic[];
}

/**
 * Contract for a shader code-generation backend. Each backend converts the
 * lowered IR (raised to AST for compatibility) into target-specific shader
 * source code, validates target capabilities, and reports structured
 * diagnostics for unsupported constructs.
 */
export interface ShaderCodegenBackend {
  readonly id: ShaderTarget;
  readonly version: string;
  readonly capabilities: BackendCapabilities;

  validate(ast: unknown, file: string): Diagnostic[];
  generate(ast: unknown, file: string, options?: CodegenOptions): BackendOutput;
}

/**
 * Global backend registry. Backends register themselves here; consumers look
 * them up by target ID. Prevents duplicate registrations.
 */
export class BackendRegistry {
  private backends = new Map<ShaderTarget, ShaderCodegenBackend>();

  register(backend: ShaderCodegenBackend): void {
    if (this.backends.has(backend.id)) {
      throw new Error(`Backend already registered for target '${backend.id}'`);
    }
    this.backends.set(backend.id, backend);
  }

  get(id: ShaderTarget): ShaderCodegenBackend | undefined {
    return this.backends.get(id);
  }

  has(id: ShaderTarget): boolean {
    return this.backends.has(id);
  }

  ids(): ShaderTarget[] {
    return Array.from(this.backends.keys());
  }
}

export const defaultRegistry = new BackendRegistry();

export function getBackend(id: ShaderTarget): ShaderCodegenBackend | undefined {
  return defaultRegistry.get(id);
}
