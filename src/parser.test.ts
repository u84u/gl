import { describe, it, expect } from "vitest";
import { tokenize } from "../src/lexer";
import { parse } from "../src/parser";
import { CallExpr, AssignmentExpr, ReturnStmt } from "../src/types";

function parseSource(source: string) {
  return parse(tokenize(source));
}

describe("parser", () => {
  it("parses a simple main function returning vec4", () => {
    const program = parseSource(`
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(program.statements.length).toBe(1);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    expect(fn.name).toBe("main");
    expect(fn.params.length).toBe(0);
    expect(fn.returnType.kind).toBe("vector");
    if (fn.returnType.kind === "vector") {
      expect(fn.returnType.size).toBe(4);
    }
    expect(fn.body.statements.length).toBe(1);
    const ret = fn.body.statements[0]!;
    if (ret.kind !== "ReturnStmt") throw new Error("expected ReturnStmt");
    expect(ret.value?.kind).toBe("CallExpr");
  });

  it("parses struct declarations with fields", () => {
    const program = parseSource(`
      struct Point { i32 x, i32 y }
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(program.statements.length).toBe(2);
    const str = program.statements[0]!;
    if (str.kind !== "StructDecl") throw new Error("expected StructDecl");
    expect(str.name).toBe("Point");
    expect(str.fields.length).toBe(2);
    expect(str.fields[0]!.name).toBe("x");
    expect(str.fields[0]!.type.kind).toBe("scalar");
    if (str.fields[0]!.type.kind === "scalar") {
      expect(str.fields[0]!.type.name).toBe("i32");
    }
  });

  it("parses variable declarations with initializers", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: f32 = 1.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const decl = fn.body.statements[0]!;
    if (decl.kind !== "VarDecl") throw new Error("expected VarDecl");
    expect(decl.name).toBe("x");
    expect(decl.type.kind).toBe("scalar");
    if (decl.type.kind === "scalar") {
      expect(decl.type.name).toBe("f32");
    }
    expect(decl.initializer?.kind).toBe("Literal");
  });

  it("parses struct literals with designated initializers", () => {
    const program = parseSource(`
      struct Color { f32 r, f32 g, f32 b, f32 a }
      fn main(): vec4 {
        let c: Color = { .r = 1.0, .g = 0.5, .b = 0.25, .a = 1.0 }
        return c
      }
    `);
    const fn = program.statements[1]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const decl = fn.body.statements[0]!;
    if (decl.kind !== "VarDecl") throw new Error("expected VarDecl");
    const init = decl.initializer;
    if (!init || init.kind !== "StructLiteral") throw new Error("expected StructLiteral");
    expect(init.fields.length).toBe(4);
    expect(init.fields[0]!.name).toBe("r");
  });

  it("parses if-else statements", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: f32 = 1.0
        if (x > 0.5) {
          return vec4(1.0, 0.0, 0.0, 1.0)
        } else {
          return vec4(0.0, 0.0, 0.0, 1.0)
        }
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[1]!;
    if (stmt.kind !== "IfStmt") throw new Error("expected IfStmt");
    expect(stmt.elseBranch).not.toBeNull();
    expect(stmt.thenBranch.statements.length).toBe(1);
    expect(stmt.elseBranch!.statements.length).toBe(1);
  });

  it("parses if without else", () => {
    const program = parseSource(`
      fn main(): vec4 {
        if (true) {
          return vec4(1.0, 0.0, 0.0, 1.0)
        }
        return vec4(0.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "IfStmt") throw new Error("expected IfStmt");
    expect(stmt.elseBranch).toBeNull();
  });

  it("parses member access", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let v: vec4 = vec4(1.0, 0.0, 0.0, 1.0)
        return vec4(v.x, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[1]!;
    if (stmt.kind !== "ReturnStmt") throw new Error("expected ReturnStmt");
    const ret = stmt as ReturnStmt;
    const call = ret.value as CallExpr | null;
    if (!call || call.kind !== "CallExpr") throw new Error("expected CallExpr");
    if (!call.args) throw new Error("expected args");
    const firstArg = call.args[0]!;
    if (firstArg.kind !== "MemberExpr") throw new Error("expected MemberExpr");
    expect(firstArg.property).toBe("x");
  });

  it("parses swizzle expressions", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let v: vec4 = vec4(1.0, 0.0, 0.0, 1.0)
        return vec4(v.rgb, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[1]!;
    if (stmt.kind !== "ReturnStmt") throw new Error("expected ReturnStmt");
    const ret = stmt as ReturnStmt;
    const call = ret.value as CallExpr | null;
    if (!call || call.kind !== "CallExpr") throw new Error("expected CallExpr");
    const firstArg = call.args[0]!;
    if (firstArg.kind !== "SwizzleExpr") throw new Error("expected SwizzleExpr");
    expect(firstArg.components).toEqual(["r", "g", "b"]);
  });

  it("parses binary expressions with precedence", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: f32 = 1.0 + 2.0 * 3.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const decl = fn.body.statements[0]!;
    if (decl.kind !== "VarDecl") throw new Error("expected VarDecl");
    const init = decl.initializer;
    if (!init || init.kind !== "BinaryExpr") throw new Error("expected BinaryExpr");
    expect(init.operator).toBe("+");
    expect((init.right as { kind: string }).kind).toBe("BinaryExpr");
    expect((init.right as { operator?: string }).operator).toBe("*");
  });

  it("parses unary expressions", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: f32 = -1.0
        let b: bool = !true
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const decl1 = fn.body.statements[0]!;
    if (decl1.kind !== "VarDecl") throw new Error("expected VarDecl");
    const init1 = decl1.initializer;
    if (!init1 || init1.kind !== "UnaryExpr") throw new Error("expected UnaryExpr");
    expect(init1.operator).toBe("-");
  });

  it("parses function calls with arguments", () => {
    const program = parseSource(`
      fn main(): vec4 {
        return dot(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0))
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "ReturnStmt") throw new Error("expected ReturnStmt");
    const ret = stmt as ReturnStmt;
    const call = ret.value as CallExpr | null;
    if (!call || call.kind !== "CallExpr") throw new Error("expected CallExpr");
    if (!call.args) throw new Error("expected args");
    expect(call.args.length).toBe(2);
  });

  it("parses helper functions", () => {
    const program = parseSource(`
      fn helper(x: f32): f32 {
        return x * 2.0
      }
      fn main(): vec4 {
        return vec4(helper(1.0), 0.0, 0.0, 1.0)
      }
    `);
    expect(program.statements.length).toBe(2);
    const helper = program.statements[0]!;
    if (helper.kind !== "FnDecl") throw new Error("expected FnDecl");
    expect(helper.name).toBe("helper");
    expect(helper.params.length).toBe(1);
    expect(helper.params[0]!.name).toBe("x");
  });

  it("throws on unexpected token", () => {
    expect(() => parseSource("fn main(): vec4 { return 1.0 }")).not.toThrow();
    expect(() => parseSource("fn main(): vec4 {")).toThrow();
  });

  it("parses integer and float literals with correct types", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let a: i32 = 42
        let b: f32 = 3.14
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const declA = fn.body.statements[0]!;
    if (declA.kind !== "VarDecl") throw new Error("expected VarDecl");
    const initA = declA.initializer as { kind: string; literalKind?: string };
    expect(initA.literalKind).toBe("int");
    const declB = fn.body.statements[1]!;
    if (declB.kind !== "VarDecl") throw new Error("expected VarDecl");
    const initB = declB.initializer as { kind: string; literalKind?: string };
    expect(initB.literalKind).toBe("float");
  });

  it("parses boolean literals", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let b: bool = true
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const decl = fn.body.statements[0]!;
    if (decl.kind !== "VarDecl") throw new Error("expected VarDecl");
    const init = decl.initializer as { kind: string; literalKind?: string; value?: boolean };
    expect(init.literalKind).toBe("bool");
    expect(init.value).toBe(true);
  });

  it("throws on unclosed brace", () => {
    expect(() => parseSource("fn main(): vec4 {")).toThrow();
  });

  it("throws on unexpected token in expression", () => {
    expect(() => parseSource("fn main(): vec4 { return }")).not.toThrow();
    expect(() => parseSource("fn main(): vec4 { let x: f32 = }")).toThrow();
  });

  it("parses equality operators", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let b: bool = 1.0 == 2.0
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const decl = fn.body.statements[0]!;
    if (decl.kind !== "VarDecl") throw new Error("expected VarDecl");
    const init = decl.initializer;
    if (!init || init.kind !== "BinaryExpr") throw new Error("expected BinaryExpr");
    expect(init.operator).toBe("==");
  });

  it("parses logical and operator", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let b: bool = true && false
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const decl = fn.body.statements[0]!;
    if (decl.kind !== "VarDecl") throw new Error("expected VarDecl");
    const init = decl.initializer;
    if (!init || init.kind !== "BinaryExpr") throw new Error("expected BinaryExpr");
    expect(init.operator).toBe("&&");
  });

  it("parses logical or operator", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let b: bool = true || false
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const decl = fn.body.statements[0]!;
    if (decl.kind !== "VarDecl") throw new Error("expected VarDecl");
    const init = decl.initializer;
    if (!init || init.kind !== "BinaryExpr") throw new Error("expected BinaryExpr");
    expect(init.operator).toBe("||");
  });

  it("parses boolean false literal", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let b: bool = false
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const decl = fn.body.statements[0]!;
    if (decl.kind !== "VarDecl") throw new Error("expected VarDecl");
    const init = decl.initializer as { kind: string; literalKind?: string; value?: boolean };
    expect(init.literalKind).toBe("bool");
    expect(init.value).toBe(false);
  });

  it("parses else-if chain", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: f32 = 1.0
        if (x > 0.5) {
          return vec4(1.0, 0.0, 0.0, 1.0)
        } else if (x > 0.25) {
          return vec4(0.0, 1.0, 0.0, 1.0)
        } else {
          return vec4(0.0, 0.0, 1.0, 1.0)
        }
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[1]!;
    if (stmt.kind !== "IfStmt") throw new Error("expected IfStmt");
    if (!stmt.elseBranch) throw new Error("expected else branch");
    const elseIf = stmt.elseBranch.statements[0]!;
    if (elseIf.kind !== "IfStmt") throw new Error("expected else-if");
  });

  it("parses variable reassignment", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: f32 = 1.0
        x = 2.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[1]!;
    if (stmt.kind !== "ExpressionStmt") throw new Error("expected ExpressionStmt");
    const expr = stmt.expression;
    if (expr.kind !== "assignment") throw new Error("expected AssignmentExpr");
    const assign = expr as AssignmentExpr;
    expect(assign.target).toMatchObject({ kind: "Identifier", name: "x" });
    expect(assign.value).toMatchObject({ kind: "Literal", literalKind: "float", value: 2.0 });
  });

  it("parses binding declaration", () => {
    const program = parseSource(`
      @binding(0) uniform time: f32
      @binding(1) uniform color: vec4
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(program.statements.length).toBe(3);
    const b0 = program.statements[0]!;
    if (b0.kind !== "BindingDecl") throw new Error("expected BindingDecl");
    expect(b0.binding).toBe(0);
    expect(b0.name).toBe("time");
    expect(b0.type.kind).toBe("scalar");
    if (b0.type.kind === "scalar") {
      expect(b0.type.name).toBe("f32");
    }

    const b1 = program.statements[1]!;
    if (b1.kind !== "BindingDecl") throw new Error("expected BindingDecl");
    expect(b1.binding).toBe(1);
    expect(b1.name).toBe("color");
    expect(b1.type.kind).toBe("vector");
    if (b1.type.kind === "vector") {
      expect(b1.type.size).toBe(4);
    }
  });

  it("parses binding declaration with struct type", () => {
    const program = parseSource(`
      struct Light { f32 r, f32 g, f32 b }
      @binding(0) uniform light: Light
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(program.statements.length).toBe(3);
    const b = program.statements[1]!;
    if (b.kind !== "BindingDecl") throw new Error("expected BindingDecl");
    expect(b.binding).toBe(0);
    expect(b.name).toBe("light");
    expect(b.type.kind).toBe("struct");
    if (b.type.kind === "struct") {
      expect(b.type.name).toBe("Light");
    }
  });

  it("parses sampler2D binding declaration", () => {
    const program = parseSource(`
      @binding(0) uniform tex: sampler2D
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(program.statements.length).toBe(2);
    const b = program.statements[0]!;
    if (b.kind !== "BindingDecl") throw new Error("expected BindingDecl");
    expect(b.binding).toBe(0);
    expect(b.name).toBe("tex");
    expect(b.type.kind).toBe("sampler");
    if (b.type.kind === "sampler") {
      expect(b.type.name).toBe("sampler2D");
    }
  });

  it("parses sampler3D and samplerCube binding declarations", () => {
    const program = parseSource(`
      @binding(0) uniform tex3d: sampler3D
      @binding(1) uniform env: samplerCube
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(program.statements.length).toBe(3);
    const b0 = program.statements[0]!;
    if (b0.kind !== "BindingDecl") throw new Error("expected BindingDecl");
    expect(b0.type.kind).toBe("sampler");
    if (b0.type.kind === "sampler") {
      expect(b0.type.name).toBe("sampler3D");
    }
    const b1 = program.statements[1]!;
    if (b1.kind !== "BindingDecl") throw new Error("expected BindingDecl");
    expect(b1.type.kind).toBe("sampler");
    if (b1.type.kind === "sampler") {
      expect(b1.type.name).toBe("samplerCube");
    }
  });

  it("throws on invalid binding declaration", () => {
    expect(() => parseSource("@binding(0) x: f32")).toThrow();
  });

  it("throws on invalid assignment target", () => {
    expect(() => parseSource("fn main(): vec4 { 5 = 3 }")).toThrow();
  });

  it("parses empty return in main", () => {
    expect(() => parseSource("fn main(): vec4 { return }")).not.toThrow();
  });

  it("parses array type declaration", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let arr: [f32; 4]
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const decl = fn.body.statements[0]!;
    if (decl.kind !== "VarDecl") throw new Error("expected VarDecl");
    expect(decl.type.kind).toBe("array");
    if (decl.type.kind === "array") {
      expect(decl.type.element.kind).toBe("scalar");
      if (decl.type.element.kind === "scalar") {
        expect(decl.type.element.name).toBe("f32");
      }
      expect(decl.type.size).toBe(4);
    }
  });

  it("parses nested array type", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let arr: [[f32; 3]; 2]
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const decl = fn.body.statements[0]!;
    if (decl.kind !== "VarDecl") throw new Error("expected VarDecl");
    expect(decl.type.kind).toBe("array");
    if (decl.type.kind === "array") {
      expect(decl.type.size).toBe(2);
      expect(decl.type.element.kind).toBe("array");
      if (decl.type.element.kind === "array") {
        expect(decl.type.element.size).toBe(3);
      }
    }
  });

  it("parses array index expression", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let arr: [f32; 4]
        return vec4(arr[0], 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[1]!;
    if (stmt.kind !== "ReturnStmt") throw new Error("expected ReturnStmt");
    const ret = stmt as ReturnStmt;
    const call = ret.value as CallExpr | null;
    if (!call || call.kind !== "CallExpr") throw new Error("expected CallExpr");
    const firstArg = call.args[0]!;
    if (firstArg.kind !== "IndexExpr") throw new Error("expected IndexExpr");
    if (firstArg.object.kind !== "Identifier") throw new Error("expected Identifier");
    expect(firstArg.object.name).toBe("arr");
    if (firstArg.index.kind !== "Literal") throw new Error("expected Literal");
    expect(firstArg.index.value).toBe(0);
  });

  it("throws on invalid array type", () => {
    expect(() => parseSource("fn main(): vec4 { let arr: [f32; ] }")).toThrow();
  });

  it("parses method call expression", () => {
    const program = parseSource(`
      fn main(): vec4 {
        obj.method()
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "ExpressionStmt") throw new Error("expected ExpressionStmt");
    const expr = stmt.expression;
    if (expr.kind !== "CallExpr") throw new Error("expected CallExpr");
    if (expr.callee.kind !== "MemberExpr") throw new Error("expected MemberExpr callee");
    expect(expr.callee.property).toBe("method");
    expect(expr.args.length).toBe(0);
  });

  it("parses nested function declaration", () => {
    const program = parseSource(`
      fn main(): vec4 {
        fn helper(): f32 { return 1.0 }
        return vec4(helper(), 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "FnDecl") throw new Error("expected FnDecl");
    expect(stmt.name).toBe("helper");
  });

  it("parses semicolons in statements", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: f32 = 1.0;
        return vec4(x, 0.0, 0.0, 1.0);
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    expect(fn.body.statements.length).toBe(2);
  });

  it("parses import declaration with relative path", () => {
    const program = parseSource(`
      import "./utils.gl"
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(program.statements.length).toBe(2);
    const imp = program.statements[0]!;
    if (imp.kind !== "ImportDecl") throw new Error("expected ImportDecl");
    expect(imp.path).toBe("./utils.gl");
  });

  it("parses multiple import declarations", () => {
    const program = parseSource(`
      import "./a.gl"
      import "./b.gl"
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(program.statements.length).toBe(3);
    const imp0 = program.statements[0]!;
    if (imp0.kind !== "ImportDecl") throw new Error("expected ImportDecl");
    expect(imp0.path).toBe("./a.gl");
    const imp1 = program.statements[1]!;
    if (imp1.kind !== "ImportDecl") throw new Error("expected ImportDecl");
    expect(imp1.path).toBe("./b.gl");
  });

  it("parses parenthesized expression", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: f32 = (1.0 + 2.0)
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "VarDecl") throw new Error("expected VarDecl");
    if (!stmt.initializer) throw new Error("expected initializer");
    if (stmt.initializer.kind !== "BinaryExpr") throw new Error("expected BinaryExpr");
  });

  it("throws on import without string path", () => {
    expect(() => parseSource("import ./utils.gl")).toThrow();
  });

  it("parses dvec2 type", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: dvec2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "VarDecl") throw new Error("expected VarDecl");
    if (stmt.type.kind !== "vector") throw new Error("expected vector type");
    expect(stmt.type.element).toBe("f64");
    expect(stmt.type.size).toBe(2);
  });

  it("parses bvec2 type", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: bvec2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "VarDecl") throw new Error("expected VarDecl");
    if (stmt.type.kind !== "vector") throw new Error("expected vector type");
    expect(stmt.type.element).toBe("bool");
    expect(stmt.type.size).toBe(2);
  });

  it("parses bvec3 type", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: bvec3
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "VarDecl") throw new Error("expected VarDecl");
    if (stmt.type.kind !== "vector") throw new Error("expected vector type");
    expect(stmt.type.element).toBe("bool");
    expect(stmt.type.size).toBe(3);
  });

  it("parses dvec3 type", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: dvec3
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "VarDecl") throw new Error("expected VarDecl");
    if (stmt.type.kind !== "vector") throw new Error("expected vector type");
    expect(stmt.type.element).toBe("f64");
    expect(stmt.type.size).toBe(3);
  });

  it("parses ivec2 type", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: ivec2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "VarDecl") throw new Error("expected VarDecl");
    if (stmt.type.kind !== "vector") throw new Error("expected vector type");
    expect(stmt.type.element).toBe("i32");
    expect(stmt.type.size).toBe(2);
  });

  it("parses ivec3 type", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: ivec3
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "VarDecl") throw new Error("expected VarDecl");
    if (stmt.type.kind !== "vector") throw new Error("expected vector type");
    expect(stmt.type.element).toBe("i32");
    expect(stmt.type.size).toBe(3);
  });

  it("parses uvec2 type", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: uvec2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "VarDecl") throw new Error("expected VarDecl");
    if (stmt.type.kind !== "vector") throw new Error("expected vector type");
    expect(stmt.type.element).toBe("u32");
    expect(stmt.type.size).toBe(2);
  });

  it("parses uvec3 type", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: uvec3
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "VarDecl") throw new Error("expected VarDecl");
    if (stmt.type.kind !== "vector") throw new Error("expected vector type");
    expect(stmt.type.element).toBe("u32");
    expect(stmt.type.size).toBe(3);
  });

  it("parses sampler2DArray type", () => {
    const program = parseSource(`
      @binding(0) uniform tex: sampler2DArray
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const decl = program.statements[0]!;
    if (decl.kind !== "BindingDecl") throw new Error("expected BindingDecl");
    if (decl.type.kind !== "sampler") throw new Error("expected sampler type");
    expect(decl.type.name).toBe("sampler2DArray");
  });

  it("parses samplerCubeArray type", () => {
    const program = parseSource(`
      @binding(0) uniform tex: samplerCubeArray
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const decl = program.statements[0]!;
    if (decl.kind !== "BindingDecl") throw new Error("expected BindingDecl");
    if (decl.type.kind !== "sampler") throw new Error("expected sampler type");
    expect(decl.type.name).toBe("samplerCubeArray");
  });

  it("parses sampler2DShadow type", () => {
    const program = parseSource(`
      @binding(0) uniform tex: sampler2DShadow
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const decl = program.statements[0]!;
    if (decl.kind !== "BindingDecl") throw new Error("expected BindingDecl");
    if (decl.type.kind !== "sampler") throw new Error("expected sampler type");
    expect(decl.type.name).toBe("sampler2DShadow");
  });

  it("parses samplerCubeShadow type", () => {
    const program = parseSource(`
      @binding(0) uniform tex: samplerCubeShadow
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const decl = program.statements[0]!;
    if (decl.kind !== "BindingDecl") throw new Error("expected BindingDecl");
    if (decl.type.kind !== "sampler") throw new Error("expected sampler type");
    expect(decl.type.name).toBe("samplerCubeShadow");
  });

  it("parses samplerBuffer type", () => {
    const program = parseSource(`
      @binding(0) uniform tex: samplerBuffer
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const decl = program.statements[0]!;
    if (decl.kind !== "BindingDecl") throw new Error("expected BindingDecl");
    if (decl.type.kind !== "sampler") throw new Error("expected sampler type");
    expect(decl.type.name).toBe("samplerBuffer");
  });

  it("parses mat2 type", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: mat2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "VarDecl") throw new Error("expected VarDecl");
    if (stmt.type.kind !== "matrix") throw new Error("expected matrix type");
    expect(stmt.type.element).toBe("f32");
    expect(stmt.type.rows).toBe(2);
    expect(stmt.type.columns).toBe(2);
  });

  it("parses mat4 type", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: mat4
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "VarDecl") throw new Error("expected VarDecl");
    if (stmt.type.kind !== "matrix") throw new Error("expected matrix type");
    expect(stmt.type.element).toBe("f32");
    expect(stmt.type.rows).toBe(4);
    expect(stmt.type.columns).toBe(4);
  });

  it("parses dmat3 type", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: dmat3
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "VarDecl") throw new Error("expected VarDecl");
    if (stmt.type.kind !== "matrix") throw new Error("expected matrix type");
    expect(stmt.type.element).toBe("f64");
    expect(stmt.type.rows).toBe(3);
    expect(stmt.type.columns).toBe(3);
  });

  it("parses imat2 type", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: imat2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "VarDecl") throw new Error("expected VarDecl");
    if (stmt.type.kind !== "matrix") throw new Error("expected matrix type");
    expect(stmt.type.element).toBe("i32");
    expect(stmt.type.rows).toBe(2);
    expect(stmt.type.columns).toBe(2);
  });

  it("parses umat4 type", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: umat4
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "VarDecl") throw new Error("expected VarDecl");
    if (stmt.type.kind !== "matrix") throw new Error("expected matrix type");
    expect(stmt.type.element).toBe("u32");
    expect(stmt.type.rows).toBe(4);
    expect(stmt.type.columns).toBe(4);
  });

  it("parses non-square mat2x3 type", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: mat2x3
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "VarDecl") throw new Error("expected VarDecl");
    if (stmt.type.kind !== "matrix") throw new Error("expected matrix type");
    expect(stmt.type.element).toBe("f32");
    expect(stmt.type.rows).toBe(3);
    expect(stmt.type.columns).toBe(2);
  });

  it("parses non-square mat4x2 type", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: mat4x2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "VarDecl") throw new Error("expected VarDecl");
    if (stmt.type.kind !== "matrix") throw new Error("expected matrix type");
    expect(stmt.type.element).toBe("f32");
    expect(stmt.type.rows).toBe(2);
    expect(stmt.type.columns).toBe(4);
  });

  it("parses array literal", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let arr: [f32; 3] = [1.0, 2.0, 3.0]
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "VarDecl") throw new Error("expected VarDecl");
    if (!stmt.initializer) throw new Error("expected initializer");
    if (stmt.initializer.kind !== "ArrayLiteral") throw new Error("expected ArrayLiteral");
    expect(stmt.initializer.elements.length).toBe(3);
  });

  it("parses empty array literal", () => {
    expect(() => parseSource("fn main(): vec4 { let x: [f32; 0] = [] return vec4(1.0, 0.0, 0.0, 1.0) }")).not.toThrow();
  });

  it("parses mutable variable declaration", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let mut x: f32 = 1.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const decl = fn.body.statements[0]!;
    if (decl.kind !== "VarDecl") throw new Error("expected VarDecl");
    expect(decl.mutable).toBe(true);
  });

  it("parses compound assignment", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let mut x: f32 = 1.0
        x += 2.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[1]!;
    if (stmt.kind !== "ExpressionStmt") throw new Error("expected ExpressionStmt");
    const expr = stmt.expression;
    if (expr.kind !== "CompoundAssignExpr") throw new Error("expected CompoundAssignExpr");
    expect(expr.operator).toBe("+=");
  });

  it("parses increment and decrement", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let mut x: i32 = 1
        ++x
        x--
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt1 = fn.body.statements[1]!;
    if (stmt1.kind !== "ExpressionStmt") throw new Error("expected ExpressionStmt");
    const expr1 = stmt1.expression;
    if (expr1.kind !== "UpdateExpr") throw new Error("expected UpdateExpr");
    expect(expr1.operator).toBe("++");
    expect(expr1.prefix).toBe(true);

    const stmt2 = fn.body.statements[2]!;
    if (stmt2.kind !== "ExpressionStmt") throw new Error("expected ExpressionStmt");
    const expr2 = stmt2.expression;
    if (expr2.kind !== "UpdateExpr") throw new Error("expected UpdateExpr");
    expect(expr2.operator).toBe("--");
    expect(expr2.prefix).toBe(false);
  });

  it("parses ternary conditional", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let b: bool = true
        let x: f32 = b ? 1.0 : 2.0
        return vec4(x, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const decl = fn.body.statements[1]!;
    if (decl.kind !== "VarDecl") throw new Error("expected VarDecl");
    const init = decl.initializer;
    if (!init || init.kind !== "ConditionalExpr") throw new Error("expected ConditionalExpr");
    expect(init.test.kind).toBe("Identifier");
  });

  it("parses null coalescing", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: i32 = 1 ?? 2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const decl = fn.body.statements[0]!;
    if (decl.kind !== "VarDecl") throw new Error("expected VarDecl");
    const init = decl.initializer;
    if (!init || init.kind !== "NullCoalescingExpr") throw new Error("expected NullCoalescingExpr");
  });

  it("parses spaceship operator", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: i32 = 1 <=> 2
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const decl = fn.body.statements[0]!;
    if (decl.kind !== "VarDecl") throw new Error("expected VarDecl");
    const init = decl.initializer;
    if (!init || init.kind !== "BinaryExpr") throw new Error("expected BinaryExpr");
    expect(init.operator).toBe("<=>");
  });

  it("parses bitwise operators", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let a: i32 = 1 & 2
        let b: i32 = 3 | 4
        let c: i32 = 5 ^ 6
        let d: i32 = ~1
        let e: i32 = 2 << 1
        let f: i32 = 4 >> 1
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const decls = fn.body.statements.filter((s) => s.kind === "VarDecl");
    expect(decls.length).toBe(6);
  });

  it("parses while loop", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let mut i: i32 = 0
        while (i < 5) {
          i += 1
        }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[1]!;
    if (stmt.kind !== "WhileStmt") throw new Error("expected WhileStmt");
    expect(stmt.condition.kind).toBe("BinaryExpr");
  });

  it("parses for loop", () => {
    const program = parseSource(`
      fn main(): vec4 {
        for (let mut i: i32 = 0; i < 5; i += 1) {
          i
        }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "ForStmt") throw new Error("expected ForStmt");
    expect(stmt.init).not.toBeNull();
    expect(stmt.condition).not.toBeNull();
    expect(stmt.increment).not.toBeNull();
  });

  it("parses do-while loop", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let mut i: i32 = 0
        do {
          i += 1
        } while (i < 5)
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[1]!;
    if (stmt.kind !== "DoWhileStmt") throw new Error("expected DoWhileStmt");
  });

  it("parses loop with break and continue", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let mut i: i32 = 0
        loop {
          i += 1
          if (i > 5) { break }
          continue
        }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[1]!;
    if (stmt.kind !== "LoopStmt") throw new Error("expected LoopStmt");
    const inner = stmt.body.statements[1]!;
    if (inner.kind !== "IfStmt") throw new Error("expected IfStmt");
    const breakStmt = inner.thenBranch.statements[0]!;
    if (breakStmt.kind !== "BreakStmt") throw new Error("expected BreakStmt");
  });

  it("parses labeled loop with break", () => {
    const program = parseSource(`
      fn main(): vec4 {
        outer: loop {
          break outer
        }
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "LoopStmt") throw new Error("expected LoopStmt");
    expect(stmt.label).toBe("outer");
    const breakStmt = stmt.body.statements[0]!;
    if (breakStmt.kind !== "BreakStmt") throw new Error("expected BreakStmt");
    expect(breakStmt.label).toBe("outer");
  });

  it("parses match expression", () => {
    const program = parseSource(`
      fn main(): vec4 {
        let x: i32 = 1
        match x {
          1 => { return vec4(1.0, 0.0, 0.0, 1.0) }
          _ => { return vec4(0.0, 0.0, 0.0, 1.0) }
        }
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const decl = fn.body.statements[0]!;
    if (decl.kind !== "VarDecl") throw new Error("expected VarDecl");
    const matchStmt = fn.body.statements[1]!;
    if (matchStmt.kind !== "ExpressionStmt") throw new Error("expected ExpressionStmt");
    const matchExpr = matchStmt.expression;
    if (matchExpr.kind !== "MatchExpr") throw new Error("expected MatchExpr");
    expect(matchExpr.arms.length).toBe(2);
  });

  it("parses panic and unreachable", () => {
    const program = parseSource(`
      fn main(): vec4 {
        panic
        unreachable
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt1 = fn.body.statements[0]!;
    if (stmt1.kind !== "PanicStmt") throw new Error("expected PanicStmt");
    const stmt2 = fn.body.statements[1]!;
    if (stmt2.kind !== "UnreachableStmt") throw new Error("expected UnreachableStmt");
  });

  it("parses discard", () => {
    const program = parseSource(`
      fn main(): vec4 {
        discard
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const fn = program.statements[0]!;
    if (fn.kind !== "FnDecl") throw new Error("expected FnDecl");
    const stmt = fn.body.statements[0]!;
    if (stmt.kind !== "DiscardStmt") throw new Error("expected DiscardStmt");
  });

  it("parses enum declaration", () => {
    const program = parseSource(`
      enum Color { Red, Green, Blue }
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(program.statements.length).toBe(2);
    const decl = program.statements[0]!;
    if (decl.kind !== "EnumDecl") throw new Error("expected EnumDecl");
    expect(decl.name).toBe("Color");
    expect(decl.variants.length).toBe(3);
  });

  it("parses enum with data variants", () => {
    const program = parseSource(`
      enum Result { Ok(f32), Err(i32) }
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    const decl = program.statements[0]!;
    if (decl.kind !== "EnumDecl") throw new Error("expected EnumDecl");
    expect(decl.variants[0]!.type).not.toBeNull();
    expect(decl.variants[1]!.type).not.toBeNull();
  });

  it("parses type alias", () => {
    const program = parseSource(`
      type MyColor = vec4
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(program.statements.length).toBe(2);
    const decl = program.statements[0]!;
    if (decl.kind !== "TypeAlias") throw new Error("expected TypeAlias");
    expect(decl.name).toBe("MyColor");
  });

  it("parses impl block", () => {
    const program = parseSource(`
      impl MyStruct {
        fn method(): f32 { return 1.0 }
      }
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(program.statements.length).toBe(2);
    const decl = program.statements[0]!;
    if (decl.kind !== "ImplBlock") throw new Error("expected ImplBlock");
    expect(decl.methods.length).toBe(1);
  });

  it("parses trait declaration", () => {
    const program = parseSource(`
      trait Drawable {
        fn draw(): f32
      }
      fn main(): vec4 {
        return vec4(1.0, 0.0, 0.0, 1.0)
      }
    `);
    expect(program.statements.length).toBe(2);
    const decl = program.statements[0]!;
    if (decl.kind !== "TraitDecl") throw new Error("expected TraitDecl");
    expect(decl.name).toBe("Drawable");
    expect(decl.methods.length).toBe(1);
  });
});
