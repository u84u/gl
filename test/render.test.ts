import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { compile } from "../src/index";

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
