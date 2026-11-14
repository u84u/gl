export type ScalarTypeName =
  | "i8" | "u8" | "i16" | "u16" | "i32" | "u32" | "i64" | "u64"
  | "f16" | "f32" | "f64" | "bf16" | "bool";

export type ShaderStage = "vertex" | "fragment" | "compute";

export type ShaderTarget = "wgsl" | "glsl-es-300" | "glsl-450" | "glsl";

export type ResourceKind =
  | "uniformBuffer"
  | "storageBuffer"
  | "sampledTexture"
  | "storageTexture"
  | "sampler";

export interface BackendCapabilities {
  readonly id: ShaderTarget;
  readonly version: string;
  readonly shaderStages: ReadonlySet<ShaderStage>;
  readonly scalarTypes: ReadonlySet<ScalarTypeName>;
  readonly resourceKinds: ReadonlySet<ResourceKind>;
  readonly supportsStorageBuffers: boolean;
  readonly supportsCompute: boolean;
  readonly supportsF16: boolean;
  readonly supportsF64: boolean;
  readonly supportsI64: boolean;
}

export const WGSL_CAPABILITIES: BackendCapabilities = {
  id: "wgsl",
  version: "1.0",
  shaderStages: new Set(["vertex", "fragment", "compute"]),
  scalarTypes: new Set(["i8", "u8", "i16", "u16", "i32", "u32", "f32", "f16", "bool"]),
  resourceKinds: new Set(["uniformBuffer", "storageBuffer", "sampledTexture", "storageTexture", "sampler"]),
  supportsStorageBuffers: true,
  supportsCompute: true,
  supportsF16: true,
  supportsF64: false,
  supportsI64: false,
};

export const GLSL_ES_300_CAPABILITIES: BackendCapabilities = {
  id: "glsl-es-300",
  version: "3.00",
  shaderStages: new Set(["vertex", "fragment"]),
  scalarTypes: new Set(["i32", "u32", "f32", "bool"]),
  resourceKinds: new Set(["uniformBuffer", "sampledTexture", "sampler"]),
  supportsStorageBuffers: false,
  supportsCompute: false,
  supportsF16: false,
  supportsF64: false,
  supportsI64: false,
};

export const GLSL_450_CAPABILITIES: BackendCapabilities = {
  id: "glsl-450",
  version: "4.50",
  shaderStages: new Set(["vertex", "fragment", "compute"]),
  scalarTypes: new Set([
    "i8", "u8", "i16", "u16", "i32", "u32", "i64", "u64",
    "f16", "f32", "f64", "bf16", "bool",
  ]),
  resourceKinds: new Set([
    "uniformBuffer", "storageBuffer", "sampledTexture", "storageTexture", "sampler",
  ]),
  supportsStorageBuffers: true,
  supportsCompute: true,
  supportsF16: false,
  supportsF64: true,
  supportsI64: true,
};

export function capabilitiesFor(target: ShaderTarget): BackendCapabilities {
  switch (target) {
    case "wgsl":
      return WGSL_CAPABILITIES;
    case "glsl-es-300":
      return GLSL_ES_300_CAPABILITIES;
    case "glsl-450":
    case "glsl":
      return GLSL_450_CAPABILITIES;
  }
}

export function scalarIsSupported(
  capabilities: BackendCapabilities,
  name: ScalarTypeName,
): boolean {
  return capabilities.scalarTypes.has(name);
}
