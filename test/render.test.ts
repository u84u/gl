import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compile, compileAsync } from "../src/index";
import { NodeFileSourceResolver } from "../src/node/resolver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE_URL = pathToFileURL(join(__dirname, "webgl", "index.html")).href;

interface RenderResult {
  ok: boolean;
  stage?: string;
  error?: string;
  pixel?: string;
  pixels?: number[];
  width?: number;
  height?: number;
  glError?: number;
}

let browser: Browser | undefined;
let page: Page | undefined;

async function openPage(target: Browser): Promise<Page> {
  const next = await target.newPage();
  await next.goto(PAGE_URL);
  return next;
}

async function hasWebGL2(target: Page): Promise<boolean> {
  return target.evaluate(() => document.createElement("canvas").getContext("webgl2") !== null);
}

async function validateProgram(vertex: string, fragment: string): Promise<RenderResult> {
  if (!page) throw new Error("Playwright page is not initialized");
  return page.evaluate(({ vertexSource, fragmentSource }) => {
    const validator = (window as unknown as {
      validateProgram: (vertex: string, fragment: string) => RenderResult;
    }).validateProgram;
    return validator(vertexSource, fragmentSource);
  }, { vertexSource: vertex, fragmentSource: fragment });
}

async function validateShader(source: string, stage: "vertex" | "fragment"): Promise<RenderResult> {
  if (!page) throw new Error("Playwright page is not initialized");
  return page.evaluate(({ shaderSource, shaderStage }) => {
    const validator = (window as unknown as {
      validateShader: (shader: string, stage: "vertex" | "fragment") => RenderResult;
    }).validateShader;
    return validator(shaderSource, shaderStage);
  }, { shaderSource: source, shaderStage: stage });
}

async function launchRenderer(): Promise<{ browser: Browser; page: Page }> {
  const attempts = [
    ["--enable-unsafe-swiftshader"],
    ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  ];
  let lastError: unknown;
  for (const args of attempts) {
    let candidate: Browser;
    try {
      candidate = await chromium.launch({ headless: true, args });
    } catch (err) {
      lastError = err;
      continue;
    }
    try {
      const candidatePage = await openPage(candidate);
      if (await hasWebGL2(candidatePage)) {
        return { browser: candidate, page: candidatePage };
      }
      lastError = new Error("Chromium launched but WebGL2 is unavailable");
    } catch (err) {
      lastError = err;
    }
    await candidate.close().catch(() => {});
  }
  throw new Error(
    "Could not create a WebGL2 context in Playwright Chromium. " +
      "Install the browser with `npx playwright install chromium`; on Linux CI also run " +
      "`npx playwright install --with-deps chromium`. " +
      (lastError instanceof Error ? lastError.message : String(lastError ?? "")),
  );
}

beforeAll(async () => {
  const launched = await launchRenderer();
  browser = launched.browser;
  page = launched.page;
}, 180_000);

afterAll(async () => {
  await browser?.close();
});

function compileFragment(source: string): string {
  const result = compile({ source, target: "glsl-es-300", file: "test.gl" });
  if (result.diagnostics.length > 0) {
    throw new Error(`Compile errors: ${result.diagnostics.map((d) => d.message).join(", ")}`);
  }
  if (!result.code) {
    throw new Error("No code generated");
  }
  return result.code;
}

async function render(fragmentSource: string, width = 8, height = 8): Promise<RenderResult> {
  if (!page) {
    throw new Error("Playwright page is not initialized");
  }
  return page.evaluate(
    ({ source, w, h }) => {
      const renderer = (window as unknown as {
        renderShader: (fragment: string, options: { width: number; height: number }) => RenderResult;
      }).renderShader;
      return renderer(source, { width: w, height: h });
    },
    { source: fragmentSource, w: width, h: height },
  );
}

function renderGlsl(source: string): Promise<RenderResult> {
  return render(compileFragment(source));
}

function expectPixel(
  result: RenderResult,
  expected: [number, number, number, number],
  tolerance = 1,
): void {
  expect(result.ok, result.error ?? "render failed").toBe(true);
  expect(result.glError ?? 0).toBe(0);
  expect(result.pixels).toHaveLength(4);
  for (let channel = 0; channel < 4; channel++) {
    expect(
      Math.abs(result.pixels![channel]! - expected[channel]!),
      `channel ${channel}: got ${result.pixels!.join(", ")}`,
    ).toBeLessThanOrEqual(tolerance);
  }
}

describe("headless WebGL2 render validation (Playwright + Chromium)", () => {
  it("compiles GLSL ES 3.00 fixture shaders and links compatible stage pairs", async () => {
    const fixturesDir = join(__dirname, "fixtures", "gl");
    const sources = readdirSync(fixturesDir).filter((name) => name.endsWith(".gl")).sort();
    let validatedShaders = 0;
    let linkedPrograms = 0;
    let rejectedMultipleOutputs = 0;

    for (const sourceName of sources) {
      const sourcePath = join(fixturesDir, sourceName);
      const source = readFileSync(sourcePath, "utf8");
      if (!/\bfn\s+main\b/.test(source)) continue;
      const options = {
        source,
        target: "glsl-es-300",
        file: sourcePath,
        sourceId: sourcePath,
        resolver: new NodeFileSourceResolver(fixturesDir),
      };
      const result = source.includes("import")
        ? await compileAsync(options)
        : compile(options);
      if (sourceName === "glsl_struct_return_locations.gl" || sourceName === "multi_output.gl") {
        expect(result.code, sourceName).toBeNull();
        expect(result.shaders, sourceName).toHaveLength(0);
        expect(result.diagnostics.map((diagnostic) => diagnostic.code), sourceName)
          .toContain("GLSL_ES_300_MULTIPLE_FRAGMENT_OUTPUTS");
        rejectedMultipleOutputs++;
        continue;
      }
      expect(result.diagnostics, sourceName).toEqual([]);
      expect(result.shaders.length, sourceName).toBeGreaterThan(0);
      for (const shader of result.shaders) {
        const compiled = await validateShader(shader.code, shader.stage);
        expect(compiled.ok, `${sourceName} (${shader.stage}): ${compiled.error ?? ""}`).toBe(true);
        validatedShaders++;
      }
      const vertex = result.shaders.find((shader) => shader.stage === "vertex");
      const fragment = result.shaders.find((shader) => shader.stage === "fragment");
      if (vertex && fragment) {
        const linked = await validateProgram(vertex.code, fragment.code);
        expect(linked.ok, `${sourceName} link: ${linked.error ?? ""}`).toBe(true);
        linkedPrograms++;
      }
    }

    expect(validatedShaders).toBeGreaterThan(40);
    expect(linkedPrograms).toBeGreaterThan(0);
    expect(rejectedMultipleOutputs).toBe(2);
  }, 120_000);

  it("links GLSL ES 3.00 stages using implicit vertex output locations", async () => {
    const result = compile({
      source: `struct VertexOutput {\n  @builtin(position) vec4 position,\n  vec2 uv,\n}\n@vertex\nfn main(@location(0) position: vec2): VertexOutput {\n  let mut output: VertexOutput;\n  output.position = vec4(position, 0.0, 1.0);\n  output.uv = position;\n  return output;\n}\n@fragment\nfn main(@location(1) uv: vec2): vec4 {\n  return vec4(uv, 0.0, 1.0);\n}`,
      target: "glsl-es-300",
      file: "implicit-interface-location.gl",
    });
    expect(result.diagnostics).toEqual([]);
    const vertex = result.shaders.find((shader) => shader.stage === "vertex")!;
    const fragment = result.shaders.find((shader) => shader.stage === "fragment")!;
    expect(vertex.code).toContain("out vec2 _gl_varying_1;");
    expect(fragment.code).toContain("in vec2 _gl_varying_1;");
    expect(vertex.reflection.entryPoints[0]!.outputs.find((output) => output.location === 1)!.name)
      .toBe("_gl_varying_1");
    expect(fragment.reflection.entryPoints[0]!.inputs.find((input) => input.location === 1)!.name)
      .toBe("_gl_varying_1");
    const linked = await validateProgram(vertex.code, fragment.code);
    expect(linked.ok, linked.error).toBe(true);
  });

  it("keeps generated ES 3.00 interface names collision-free", async () => {
    const result = compile({
      source: `struct VertexOutput {\n  @builtin(position) vec4 position,\n  @location(0) vec2 _gl_varying_0,\n}\n@vertex\nfn main(@location(0) _gl_output: vec2): VertexOutput {\n  let mut output: VertexOutput;\n  output.position = vec4(_gl_output, 0.0, 1.0);\n  output._gl_varying_0 = _gl_output;\n  return output;\n}\n@fragment\nfn main(@location(0) _gl_varying_0: vec2): vec4 {\n  return vec4(_gl_varying_0, 0.0, 1.0);\n}`,
      target: "glsl-es-300",
      file: "interface-collisions.gl",
    });
    expect(result.diagnostics).toEqual([]);
    const vertex = result.shaders.find((shader) => shader.stage === "vertex")!;
    const fragment = result.shaders.find((shader) => shader.stage === "fragment")!;
    expect(vertex.code).toContain("out vec2 _gl_varying_0_1;");
    expect(vertex.code).toContain("VertexOutput _gl_output_1;");
    expect(fragment.code).toContain("vec2 _gl_varying_0 = _gl_varying_0_1;");
    expect(vertex.reflection.entryPoints[0]!.outputs.find((output) => output.location === 0)!.name)
      .toBe("_gl_varying_0_1");
    expect(fragment.reflection.entryPoints[0]!.inputs.find((input) => input.location === 0)!.name)
      .toBe("_gl_varying_0_1");
    const linked = await validateProgram(vertex.code, fragment.code);
    expect(linked.ok, linked.error).toBe(true);
  });

  it("renders solid color shader", async () => {
    const result = await renderGlsl(`
      fn main(): vec4 {
        return vec4(1.0, 0.5, 0.25, 1.0)
      }
    `);
    expectPixel(result, [255, 128, 64, 255]);
  });

  it("renders black color", async () => {
    const result = await renderGlsl(`
      fn main(): vec4 {
        return vec4(0.0, 0.0, 0.0, 1.0)
      }
    `);
    expectPixel(result, [0, 0, 0, 255]);
  });

  it("renders white color", async () => {
    const result = await renderGlsl(`
      fn main(): vec4 {
        return vec4(1.0, 1.0, 1.0, 1.0)
      }
    `);
    expectPixel(result, [255, 255, 255, 255]);
  });

  it("renders conditional shader (true branch)", async () => {
    const result = await renderGlsl(`
      fn main(): vec4 {
        let x: f32 = 1.0
        if (x > 0.5) {
          return vec4(1.0, 0.0, 0.0, 1.0)
        } else {
          return vec4(0.0, 0.0, 1.0, 1.0)
        }
      }
    `);
    expectPixel(result, [255, 0, 0, 255]);
  });

  it("renders conditional shader (false branch)", async () => {
    const result = await renderGlsl(`
      fn main(): vec4 {
        let x: f32 = 0.1
        if (x > 0.5) {
          return vec4(1.0, 0.0, 0.0, 1.0)
        } else {
          return vec4(0.0, 0.0, 1.0, 1.0)
        }
      }
    `);
    expectPixel(result, [0, 0, 255, 255]);
  });

  it("renders binary operations", async () => {
    const result = await renderGlsl(`
      fn main(): vec4 {
        let a: f32 = 1.0
        let b: f32 = 2.0
        let c: f32 = a + b
        return vec4(c / 3.0, 0.0, 0.0, 1.0)
      }
    `);
    expectPixel(result, [255, 0, 0, 255]);
  });

  it("renders a while loop", async () => {
    const result = await renderGlsl(`
      fn main(): vec4 {
        let mut i: i32 = 0
        let mut total: f32 = 0.0
        while (i < 4) {
          total += 0.25
          i += 1
        }
        return vec4(total, 0.0, 0.0, 1.0)
      }
    `);
    expectPixel(result, [255, 0, 0, 255]);
  });

  it("reports GLSL that fails to compile", async () => {
    const result = await render("#version 300 es\nout vec4 fragColor;\nvoid main() { fragColor = ;\n}");
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("fragment");
    expect(result.error).toBeTruthy();
  });
});
