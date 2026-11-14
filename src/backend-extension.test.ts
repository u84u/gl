import { describe, it, expect } from "vitest";
import {
  compileSync,
  createDefaultBackendRegistry,
  BackendRegistry,
  type ShaderCodegenBackend,
  type IRModule,
} from "./index";

const customBackend: ShaderCodegenBackend = {
  id: "custom-test-target",
  version: "1.0",
  capabilities: {
    id: "custom-test-target",
    version: "1.0",
    shaderStages: new Set(["fragment"]),
    scalarTypes: new Set(["f32", "bool"]),
    resourceKinds: new Set([]),
    supportsStorageBuffers: false,
    supportsCompute: false,
    supportsF16: false,
    supportsF64: false,
    supportsI64: false,
  },
  validate(_module: IRModule, _file: string) {
    return [];
  },
  generate(_module: IRModule, _file: string) {
    return {
      target: "custom-test-target",
      shaders: [
        {
          stage: "fragment" as const,
          entryPoint: "main",
          code: "CUSTOM OUTPUT",
          reflection: { entryPoints: [], resources: [], uniforms: [] },
        },
      ],
      diagnostics: [],
    };
  },
};

describe("backend extension API", () => {
  it("registers and uses a custom backend via isolated registry", () => {
    const registry = createDefaultBackendRegistry();
    registry.register(customBackend);

    const result = compileSync({
      target: "custom-test-target",
      source: "fn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }",
      file: "test.gl",
      registry,
    });

    expect(result.diagnostics).toHaveLength(0);
    expect(result.code).toBe("CUSTOM OUTPUT");
    expect(result.shaders).toHaveLength(1);
    expect(result.shaders[0]!.stage).toBe("fragment");
    expect(result.shaders[0]!.entryPoint).toBe("main");
  });

  it("does not leak custom backend across isolated registries", () => {
    const registry = createDefaultBackendRegistry();
    const result = compileSync({
      target: "custom-test-target",
      source: "fn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }",
      file: "test.gl",
      registry,
    });

    expect(result.code).toBeNull();
    expect(result.diagnostics.some((d) => d.message.includes("Unknown target"))).toBe(true);
  });

  it("throws on duplicate registration", () => {
    const registry = new BackendRegistry();
    registry.register(customBackend);
    expect(() => registry.register(customBackend)).toThrow();
  });

  it("supports replace for an existing target", () => {
    const registry = new BackendRegistry();
    registry.register(customBackend);
    const replacement: ShaderCodegenBackend = {
      ...customBackend,
      version: "2.0",
      generate() {
        return {
          target: "custom-test-target",
          shaders: [
            {
              stage: "fragment" as const,
              entryPoint: "main",
              code: "REPLACED",
              reflection: { entryPoints: [], resources: [], uniforms: [] },
            },
          ],
          diagnostics: [],
        };
      },
    };
    registry.replace(replacement);

    const result = compileSync({
      target: "custom-test-target",
      source: "fn main(): vec4 { return vec4(1.0, 0.0, 0.0, 1.0) }",
      file: "test.gl",
      registry,
    });

    expect(result.code).toBe("REPLACED");
  });

  it("exposes all built-in targets in default registry", () => {
    const registry = createDefaultBackendRegistry();
    expect(registry.ids()).toContain("glsl");
    expect(registry.ids()).toContain("glsl-450");
    expect(registry.ids()).toContain("glsl-es-300");
    expect(registry.ids()).toContain("wgsl");
  });

  it("rejects capability-inconsistent backend registration", () => {
    const registry = new BackendRegistry();
    const bad: ShaderCodegenBackend = {
      ...customBackend,
      id: "bad-target",
      capabilities: {
        ...customBackend.capabilities,
        id: "bad-target",
        supportsF16: true, // inconsistent: scalarTypes lacks f16
      },
    };
    expect(() => registry.register(bad)).toThrow();
  });
});
