import { Diagnostic } from "../typechecker";
import { IRModule } from "../ir/shader-ir";
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
  readonly id: string;
  readonly version: string;
  readonly capabilities: BackendCapabilities;

  validate(module: IRModule, file: string): Diagnostic[];
  generate(module: IRModule, file: string, options?: CodegenOptions): BackendOutput;
}

/**
 * Global backend registry. Backends register themselves here; consumers look
 * them up by target ID. Prevents duplicate registrations.
 */
export class BackendRegistry {
  private backends = new Map<string, ShaderCodegenBackend>();

  register(backend: ShaderCodegenBackend): void {
    if (this.backends.has(backend.id)) {
      throw new Error(`Backend already registered for target '${backend.id}'`);
    }
    // Validate capability consistency: advertised booleans must agree with the
    // canonical scalar/resource sets.
    const caps = backend.capabilities;
    if (caps.supportsF16 !== caps.scalarTypes.has("f16")) {
      throw new Error(
        `Backend '${backend.id}' has inconsistent f16 capability (supportsF16=${caps.supportsF16}, scalarTypes has f16=${caps.scalarTypes.has("f16")})`,
      );
    }
    if (caps.supportsF64 !== caps.scalarTypes.has("f64")) {
      throw new Error(
        `Backend '${backend.id}' has inconsistent f64 capability (supportsF64=${caps.supportsF64}, scalarTypes has f64=${caps.scalarTypes.has("f64")})`,
      );
    }
    if (caps.supportsI64 !== caps.scalarTypes.has("i64")) {
      throw new Error(
        `Backend '${backend.id}' has inconsistent i64 capability (supportsI64=${caps.supportsI64}, scalarTypes has i64=${caps.scalarTypes.has("i64")})`,
      );
    }
    if (caps.supportsStorageBuffers !== caps.resourceKinds.has("storageBuffer")) {
      throw new Error(
        `Backend '${backend.id}' has inconsistent storage buffer capability (supportsStorageBuffers=${caps.supportsStorageBuffers}, resourceKinds has storageBuffer=${caps.resourceKinds.has("storageBuffer")})`,
      );
    }
    if (caps.supportsCompute !== caps.shaderStages.has("compute")) {
      throw new Error(
        `Backend '${backend.id}' has inconsistent compute capability (supportsCompute=${caps.supportsCompute}, shaderStages has compute=${caps.shaderStages.has("compute")})`,
      );
    }
    this.backends.set(backend.id, backend);
  }

  /** Replace an existing backend for a target. */
  replace(backend: ShaderCodegenBackend): void {
    // Validate capability consistency (same rules as register).
    const caps = backend.capabilities;
    if (caps.supportsF16 !== caps.scalarTypes.has("f16")) throw new Error(`Backend '${backend.id}' has inconsistent f16 capability`);
    if (caps.supportsF64 !== caps.scalarTypes.has("f64")) throw new Error(`Backend '${backend.id}' has inconsistent f64 capability`);
    if (caps.supportsI64 !== caps.scalarTypes.has("i64")) throw new Error(`Backend '${backend.id}' has inconsistent i64 capability`);
    if (caps.supportsStorageBuffers !== caps.resourceKinds.has("storageBuffer")) throw new Error(`Backend '${backend.id}' has inconsistent storage buffer capability`);
    if (caps.supportsCompute !== caps.shaderStages.has("compute")) throw new Error(`Backend '${backend.id}' has inconsistent compute capability`);
    this.backends.set(backend.id, backend);
  }

  get(id: string): ShaderCodegenBackend | undefined {
    return this.backends.get(id);
  }

  has(id: string): boolean {
    return this.backends.has(id);
  }

  ids(): string[] {
    return Array.from(this.backends.keys());
  }
}

export function createDefaultBackendRegistry(): BackendRegistry {
  const registry = new BackendRegistry();
  for (const id of defaultRegistry.ids()) {
    const backend = defaultRegistry.get(id);
    if (backend) registry.register(backend);
  }
  return registry;
}

export const defaultRegistry = new BackendRegistry();

export function getBackend(id: ShaderTarget): ShaderCodegenBackend | undefined {
  return defaultRegistry.get(id);
}
