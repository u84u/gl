import { describe, it, expect } from "vitest";
import { compile, generateGLSL, generateWGSL } from "./index";
import * as ast from "./ast";
import type { Program } from "./types";

function compileAst(program: Program, target: "glsl" | "wgsl") {
  const result = compile({ target, ast: program, file: "test.gl" });
  if (result.diagnostics.length > 0) {
    throw new Error(
      `Compile errors: ${result.diagnostics.map((d) => d.message).join(", ")}`,
    );
  }
  if (!result.code) {
    throw new Error("No code generated");
  }
  return result.code;
}

describe("AST builder API", () => {
  it("compiles a simple vec4 main to GLSL", () => {
    const program = ast.program([
      ast.mainVec4([ast.returnStmt(ast.call(ast.ident("vec4"), [ast.float(1.0), ast.float(0.0), ast.float(0.0), ast.float(1.0)]))]),
    ]);

    const glsl = compileAst(program, "glsl");
    expect(glsl).toContain("#version 450 core");
    expect(glsl).toContain("out vec4 fragColor;");
    expect(glsl).toContain("fragColor = vec4(1.0, 0.0, 0.0, 1.0);");

    const wgsl = compileAst(program, "wgsl");
    expect(wgsl).toContain("@fragment");
    expect(wgsl).toContain("fn main() -> @location(0) vec4<f32>");
    expect(wgsl).toContain("return vec4<f32>(1.0, 0.0, 0.0, 1.0);");
  });

  it("compiles struct declaration and literal to GLSL and WGSL", () => {
    const program = ast.program([
      ast.structDecl("Color", [
        ast.field("r", ast.f32()),
        ast.field("g", ast.f32()),
        ast.field("b", ast.f32()),
        ast.field("a", ast.f32()),
      ]),
      ast.mainVec4([
        ast.varDecl(
          "c",
          ast.structType("Color"),
          ast.structLiteral("Color", [
            { name: "r", value: ast.float(1.0) },
            { name: "g", value: ast.float(0.5) },
            { name: "b", value: ast.float(0.25) },
            { name: "a", value: ast.float(1.0) },
          ]),
        ),
        ast.returnStmt(
          ast.call(ast.ident("vec4"), [
            ast.member(ast.ident("c"), "r"),
            ast.member(ast.ident("c"), "g"),
            ast.member(ast.ident("c"), "b"),
            ast.member(ast.ident("c"), "a"),
          ]),
        ),
      ]),
    ]);

    const glsl = compileAst(program, "glsl");
    expect(glsl).toContain("struct Color {");
    expect(glsl).toContain("float r;");
    expect(glsl).toContain("Color c = Color(1.0, 0.5, 0.25, 1.0);");

    const wgsl = compileAst(program, "wgsl");
    expect(wgsl).toContain("struct Color {");
    expect(wgsl).toContain("r: f32,");
    expect(wgsl).toContain("Color(1.0, 0.5, 0.25, 1.0)");
  });

  it("compiles variable declarations with types", () => {
    const program = ast.program([
      ast.mainVec4([
        ast.varDecl("x", ast.f32(), ast.float(1.0)),
        ast.varDecl("mutY", ast.i32(), ast.int(5), true),
        ast.returnStmt(
          ast.call(ast.ident("vec4"), [
            ast.ident("x"),
            ast.float(0.0),
            ast.float(0.0),
            ast.float(1.0),
          ]),
        ),
      ]),
    ]);

    const glsl = compileAst(program, "glsl");
    expect(glsl).toContain("float x = 1.0;");
    expect(glsl).toContain("int mutY = 5;");

    const wgsl = compileAst(program, "wgsl");
    expect(wgsl).toContain("let x: f32 = 1.0;");
    expect(wgsl).toContain("var mutY: i32 = 5;");
  });

  it("compiles if-else statements", () => {
    const program = ast.program([
      ast.mainVec4([
        ast.varDecl("x", ast.f32(), ast.float(1.0)),
        ast.ifStmt(
          ast.binary(ast.ident("x"), ">", ast.float(0.5)),
          ast.block([ast.returnStmt(ast.call(ast.ident("vec4"), [ast.float(1.0), ast.float(0.0), ast.float(0.0), ast.float(1.0)]))]),
          ast.block([ast.returnStmt(ast.call(ast.ident("vec4"), [ast.float(0.0), ast.float(0.0), ast.float(1.0), ast.float(1.0)]))]),
        ),
      ]),
    ]);

    const glsl = compileAst(program, "glsl");
    expect(glsl).toContain("if ((x > 0.5))");
    expect(glsl).toContain("else");

    const wgsl = compileAst(program, "wgsl");
    expect(wgsl).toContain("if (x > 0.5) {");
    expect(wgsl).toContain("else {");
  });

  it("compiles while loops", () => {
    const program = ast.program([
      ast.mainVec4([
        ast.varDecl("i", ast.i32(), ast.int(0), true),
        ast.whileStmt(
          ast.binary(ast.ident("i"), "<", ast.int(5)),
          ast.block([ast.expressionStmt(ast.compoundAssign(ast.ident("i"), "+=", ast.int(1)))]),
        ),
        ast.returnStmt(ast.call(ast.ident("vec4"), [ast.float(1.0), ast.float(0.0), ast.float(0.0), ast.float(1.0)])),
      ]),
    ]);

    const glsl = compileAst(program, "glsl");
    expect(glsl).toContain("while");

    const wgsl = compileAst(program, "wgsl");
    expect(wgsl).toContain("while (i < 5) {");
    expect(wgsl).toContain("i = i + 1;");
  });

  it("compiles range-based for loops", () => {
    const program = ast.program([
      ast.mainVec4([
        ast.varDecl("i", ast.i32(), ast.int(0), true),
        ast.rangeForStmt("x", ast.int(0), ast.int(3), false, ast.block([
          ast.expressionStmt(ast.compoundAssign(ast.ident("i"), "+=", ast.int(1))),
        ])),
        ast.returnStmt(ast.call(ast.ident("vec4"), [ast.float(1.0), ast.float(0.0), ast.float(0.0), ast.float(1.0)])),
      ]),
    ]);

    const glsl = compileAst(program, "glsl");
    expect(glsl).toContain("for");

    const wgsl = compileAst(program, "wgsl");
    expect(wgsl).toContain("var x = 0;");
    expect(wgsl).toContain("loop {");
    expect(wgsl).toContain("if (!(x < 3)) {");
    expect(wgsl).toContain("x = x + 1;");
  });

  it("compiles inclusive range-based for loops", () => {
    const program = ast.program([
      ast.mainVec4([
        ast.varDecl("i", ast.i32(), ast.int(0), true),
        ast.rangeForStmt("x", ast.int(0), ast.int(3), true, ast.block([
          ast.expressionStmt(ast.compoundAssign(ast.ident("i"), "+=", ast.int(1))),
        ])),
        ast.returnStmt(ast.call(ast.ident("vec4"), [ast.float(1.0), ast.float(0.0), ast.float(0.0), ast.float(1.0)])),
      ]),
    ]);

    const wgsl = compileAst(program, "wgsl");
    expect(wgsl).toContain("if (!(x <= 3)) {");
  });

  it("compiles binding uniforms", () => {
    const program = ast.program([
      ast.bindingDecl(0, "time", ast.f32()),
      ast.bindingDecl(1, "color", ast.vec4()),
      ast.mainVec4([
        ast.returnStmt(ast.ident("color")),
      ]),
    ]);

    const glsl = compileAst(program, "glsl");
    expect(glsl).toContain("uniform float time;");
    expect(glsl).toContain("uniform vec4 color;");

    const wgsl = compileAst(program, "wgsl");
    expect(wgsl).toContain("@group(0) @binding(0) var<uniform> time: f32;");
    expect(wgsl).toContain("@group(0) @binding(1) var<uniform> color: vec4<f32>;");
  });

  it("compiles sampler textures", () => {
    const program = ast.program([
      ast.bindingDecl(0, "tex", ast.sampler2D()),
      ast.mainVec4([
        ast.varDecl("uv", ast.vec2(), ast.call(ast.ident("vec2"), [ast.float(0.5), ast.float(0.5)])),
        ast.varDecl("col", ast.vec4(), ast.call(ast.ident("texture"), [ast.ident("tex"), ast.ident("uv")])),
        ast.returnStmt(ast.ident("col")),
      ]),
    ]);

    const glsl = compileAst(program, "glsl");
    expect(glsl).toContain("uniform sampler2D tex;");
    expect(glsl).toContain("texture(tex, uv)");

    const wgsl = compileAst(program, "wgsl");
    expect(wgsl).toContain("var tex: texture_2d<f32>;");
    expect(wgsl).toContain("textureSample(tex, tex_sampler, uv)");
  });

  it("compiles match expressions as statements", () => {
    const program = ast.program([
      ast.mainVec4([
        ast.varDecl("x", ast.i32(), ast.int(1)),
        ast.expressionStmt(ast.match(ast.ident("x"), [
          ast.arm(ast.literalPattern(1), ast.block([ast.returnStmt(ast.call(ast.ident("vec4"), [ast.float(1.0), ast.float(0.0), ast.float(0.0), ast.float(1.0)]))])),
          ast.arm(ast.literalPattern(2), ast.block([ast.returnStmt(ast.call(ast.ident("vec4"), [ast.float(0.0), ast.float(1.0), ast.float(0.0), ast.float(1.0)]))])),
          ast.arm(ast.wildcardPattern(), ast.block([ast.returnStmt(ast.call(ast.ident("vec4"), [ast.float(0.0), ast.float(0.0), ast.float(1.0), ast.float(1.0)]))])),
        ])),
        ast.returnStmt(ast.call(ast.ident("vec4"), [ast.float(0.0), ast.float(0.0), ast.float(0.0), ast.float(1.0)])),
      ]),
    ]);

    const glsl = compileAst(program, "glsl");
    expect(glsl).toContain("if");

    const wgsl = compileAst(program, "wgsl");
    expect(wgsl).toContain("if ((x == 1)) {");
    expect(wgsl).toContain("else if ((x == 2)) {");
    expect(wgsl).toContain("else {");
  });

  it("compiles match expressions as expression values", () => {
    const program = ast.program([
      ast.mainVec4([
        ast.varDecl("x", ast.i32(), ast.int(1)),
        ast.varDecl(
          "result",
          ast.f32(),
          ast.match(ast.ident("x"), [
            ast.arm(ast.literalPattern(1), ast.block([ast.expressionStmt(ast.float(10.0))])),
            ast.arm(ast.wildcardPattern(), ast.block([ast.expressionStmt(ast.float(0.0))])),
          ]),
        ),
        ast.returnStmt(ast.call(ast.ident("vec4"), [ast.ident("result"), ast.float(0.0), ast.float(0.0), ast.float(1.0)])),
      ]),
    ]);

    const wgsl = compileAst(program, "wgsl");
    expect(wgsl).toContain("var result: f32;");
    expect(wgsl).toContain("result = 10.0;");
    expect(wgsl).toContain("result = 0.0;");
  });

  it("compiles discard", () => {
    const program = ast.program([
      ast.mainVec4([
        ast.discardStmt(),
        ast.returnStmt(ast.call(ast.ident("vec4"), [ast.float(1.0), ast.float(0.0), ast.float(0.0), ast.float(1.0)])),
      ]),
    ]);

    const wgsl = compileAst(program, "wgsl");
    expect(wgsl).toContain("discard;");
  });

  it("compiles loop break and continue", () => {
    const program = ast.program([
      ast.mainVec4([
        ast.loopStmt(ast.block([ast.breakStmt(), ast.continueStmt()])),
        ast.returnStmt(ast.call(ast.ident("vec4"), [ast.float(1.0), ast.float(0.0), ast.float(0.0), ast.float(1.0)])),
      ]),
    ]);

    const wgsl = compileAst(program, "wgsl");
    expect(wgsl).toContain("loop {");
    expect(wgsl).toContain("break;");
    expect(wgsl).toContain("continue;");
  });

  it("compiles do-while loops", () => {
    const program = ast.program([
      ast.mainVec4([
        ast.varDecl("i", ast.i32(), ast.int(0), true),
        ast.doWhileStmt(
          ast.block([ast.expressionStmt(ast.compoundAssign(ast.ident("i"), "+=", ast.int(1)))]),
          ast.binary(ast.ident("i"), "<", ast.int(3)),
        ),
        ast.returnStmt(ast.call(ast.ident("vec4"), [ast.float(1.0), ast.float(0.0), ast.float(0.0), ast.float(1.0)])),
      ]),
    ]);

    const wgsl = compileAst(program, "wgsl");
    expect(wgsl).toContain("loop {");
    expect(wgsl).toContain("if (!((i < 3))) {");
    expect(wgsl).toContain("break;");
  });

  it("compiles struct returns with locations", () => {
    const program = ast.program([
      ast.structDecl("FragOutput", [
        ast.field("r", ast.f32()),
        ast.field("g", ast.f32()),
        ast.field("b", ast.f32()),
        ast.field("a", ast.f32()),
        ast.field("depth", ast.f32()),
      ]),
      ast.fnDecl(
        "main",
        [],
        ast.structType("FragOutput"),
        ast.block([ast.returnStmt(ast.structLiteral("FragOutput", [
          { name: "r", value: ast.float(1.0) },
          { name: "g", value: ast.float(0.5) },
          { name: "b", value: ast.float(0.25) },
          { name: "a", value: ast.float(1.0) },
          { name: "depth", value: ast.float(0.5) },
        ]))]),
      ),
    ]);

    const glsl = compileAst(program, "glsl");
    expect(glsl).toContain("layout(location = 0) out float r;");
    expect(glsl).toContain("layout(location = 4) out float depth;");

    const wgsl = compileAst(program, "wgsl");
    expect(wgsl).toContain("@location(0) r: f32,");
    expect(wgsl).toContain("@location(4) depth: f32,");
    expect(wgsl).toContain("fn main() -> FragOutput {");
  });

  it("generates code directly via generateGLSL and generateWGSL", () => {
    const program = ast.program([
      ast.mainVec4([ast.returnStmt(ast.call(ast.ident("vec4"), [ast.float(1.0), ast.float(0.0), ast.float(0.0), ast.float(1.0)]))]),
    ]);

    const glsl = generateGLSL(program);
    expect(glsl).toContain("#version 450 core");

    const wgsl = generateWGSL(program);
    expect(wgsl).toContain("@fragment");
  });

  it("returns diagnostics for invalid AST", () => {
    const program = ast.program([
      ast.fnDecl(
        "main",
        [],
        ast.i32(),
        ast.block([ast.returnStmt(ast.int(42))]),
      ),
    ]);

    const result = compile({ target: "glsl", ast: program, file: "test.gl" });
    expect(result.code).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]!.message).toContain("main must return vec4");
  });

  it("requires either source or ast", () => {
    const result = compile({ target: "glsl", file: "test.gl" });
    expect(result.code).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]!.message).toContain("Either 'source' or 'ast' must be provided");
  });
});
