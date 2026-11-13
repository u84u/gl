import { describe, it, expect } from "vitest";
import { tokenize } from "../src/lexer";

function tokensOf(source: string) {
  return tokenize(source);
}

describe("lexer", () => {
  it("tokenizes keywords", () => {
    const tokens = tokensOf("fn struct return if else let true false");
    expect(tokens.map((t) => t.kind)).toEqual([
      "Fn", "Struct", "Return", "If", "Else", "Let", "True", "False", "EOF",
    ]);
  });

  it("tokenizes identifiers and type names", () => {
    const tokens = tokensOf("my_var myStruct i32 f32 vec4");
    expect(tokens.map((t) => t.kind)).toEqual([
      "Ident", "Ident", "Ident", "Ident", "Ident", "EOF",
    ]);
  });

  it("tokenizes integer literals", () => {
    const tokens = tokensOf("42 0 100");
    expect(tokens.map((t) => t.kind)).toEqual(["Int", "Int", "Int", "EOF"]);
    expect(tokens[0]!.lexeme).toBe("42");
  });

  it("tokenizes float literals", () => {
    const tokens = tokensOf("1.0 0.5 3.14");
    expect(tokens.map((t) => t.kind)).toEqual(["Float", "Float", "Float", "EOF"]);
  });

  it("tokenizes boolean literals", () => {
    const tokens = tokensOf("true false");
    expect(tokens.map((t) => t.kind)).toEqual(["True", "False", "EOF"]);
  });

  it("tokenizes punctuation", () => {
    const tokens = tokensOf("(){}[],.;:");
    expect(tokens.map((t) => t.kind)).toEqual([
      "LParen", "RParen", "LBrace", "RBrace", "LBracket", "RBracket",
      "Comma", "Dot", "Semicolon", "Colon", "EOF",
    ]);
  });

  it("tokenizes assignment", () => {
    const tokens = tokensOf("=");
    expect(tokens.map((t) => t.kind)).toEqual(["Assign", "EOF"]);
  });

  it("tokenizes equality", () => {
    const tokens = tokensOf("==");
    expect(tokens.map((t) => t.kind)).toEqual(["Eq", "EOF"]);
  });

  it("tokenizes inequality", () => {
    const tokens = tokensOf("!=");
    expect(tokens.map((t) => t.kind)).toEqual(["Neq", "EOF"]);
  });

  it("tokenizes less than and less equal", () => {
    expect(tokensOf("<").map((t) => t.kind)).toEqual(["Lt", "EOF"]);
    expect(tokensOf("<=").map((t) => t.kind)).toEqual(["Lte", "EOF"]);
  });

  it("tokenizes greater than and greater equal", () => {
    expect(tokensOf(">").map((t) => t.kind)).toEqual(["Gt", "EOF"]);
    expect(tokensOf(">=").map((t) => t.kind)).toEqual(["Gte", "EOF"]);
  });

  it("tokenizes logical and", () => {
    const tokens = tokensOf("&&");
    expect(tokens.map((t) => t.kind)).toEqual(["And", "EOF"]);
  });

  it("tokenizes logical or", () => {
    const tokens = tokensOf("||");
    expect(tokens.map((t) => t.kind)).toEqual(["Or", "EOF"]);
  });

  it("tokenizes arithmetic operators", () => {
    expect(tokensOf("+").map((t) => t.kind)).toEqual(["Plus", "EOF"]);
    expect(tokensOf("-").map((t) => t.kind)).toEqual(["Minus", "EOF"]);
    expect(tokensOf("*").map((t) => t.kind)).toEqual(["Star", "EOF"]);
    expect(tokensOf("/").map((t) => t.kind)).toEqual(["Slash", "EOF"]);
    expect(tokensOf("%").map((t) => t.kind)).toEqual(["Percent", "EOF"]);
  });

  it("tokenizes not", () => {
    const tokens = tokensOf("!");
    expect(tokens.map((t) => t.kind)).toEqual(["Not", "EOF"]);
  });

  it("tokenizes binding attribute", () => {
    const tokens = tokensOf("@binding(0)");
    expect(tokens.map((t) => t.kind)).toEqual(["Binding", "LParen", "Int", "RParen", "EOF"]);
    expect(tokens[0]!.lexeme).toBe("binding");
  });

  it("tracks line and column", () => {
    const tokens = tokensOf("fn\n  main");
    const fnTok = tokens[0]!;
    const mainTok = tokens[1]!;
    expect(fnTok.line).toBe(1);
    expect(fnTok.column).toBe(1);
    expect(mainTok.line).toBe(2);
    expect(mainTok.column).toBe(3);
  });

  it("skips whitespace", () => {
    const tokens = tokensOf("  fn\t  main  ");
    expect(tokens.map((t) => t.kind)).toEqual(["Fn", "Ident", "EOF"]);
  });

  it("returns empty on empty source", () => {
    const tokens = tokensOf("");
    expect(tokens.length).toBe(1);
    expect(tokens[0]!.kind).toBe("EOF");
  });

  it("tokenizes string literals", () => {
    const tokens = tokensOf('"hello"');
    expect(tokens.map((t) => t.kind)).toEqual(["String", "EOF"]);
    expect(tokens[0]!.lexeme).toBe("hello");
  });

  it("tokenizes string literal with path-like content", () => {
    const tokens = tokensOf('"./utils.gl"');
    expect(tokens.map((t) => t.kind)).toEqual(["String", "EOF"]);
    expect(tokens[0]!.lexeme).toBe("./utils.gl");
  });

  it("tokenizes unterminated string as illegal", () => {
    const tokens = tokensOf('"hello');
    expect(tokens.map((t) => t.kind)).toEqual(["Illegal", "EOF"]);
  });

  it("tokenizes unterminated char literal as illegal", () => {
    const tokens = tokensOf("'abc");
    expect(tokens.some((t) => t.kind === "Illegal")).toBe(true);
  });

  it("tokenizes invalid color as illegal", () => {
    const tokens = tokensOf("#GG");
    expect(tokens.some((t) => t.kind === "Illegal")).toBe(true);
  });

  it("tokenizes short color as illegal", () => {
    const tokens = tokensOf("#12");
    expect(tokens.some((t) => t.kind === "Illegal")).toBe(true);
  });

  it("tokenizes tilde as bitwise not", () => {
    const tokens = tokensOf("~");
    expect(tokens.map((t) => t.kind)).toEqual(["Tilde", "EOF"]);
    expect(tokens[0]!.lexeme).toBe("~");
  });

  it("tokenizes char literals", () => {
    const tokens = tokensOf("'A' '\\n'");
    expect(tokens.map((t) => t.kind)).toEqual(["Char", "Char", "EOF"]);
    expect(tokens[0]!.lexeme).toBe("A");
    expect(tokens[1]!.lexeme).toBe("\\n");
  });

  it("tokenizes char literal with escaped char", () => {
    const tokens = tokensOf("'\\t'");
    expect(tokens.map((t) => t.kind)).toEqual(["Char", "EOF"]);
    expect(tokens[0]!.lexeme).toBe("\\t");
  });

  it("tokenizes scientific float with exponent sign", () => {
    const tokens = tokensOf("1.5e-3 1e+2");
    expect(tokens.map((t) => t.kind)).toEqual(["Float", "Float", "EOF"]);
    expect(tokens[0]!.lexeme).toBe("1.5e-3");
    expect(tokens[1]!.lexeme).toBe("1e+2");
  });

  it("tokenizes string with backslash escape", () => {
    const tokens = tokensOf('"a\\nb"');
    expect(tokens.map((t) => t.kind)).toEqual(["String", "EOF"]);
    expect(tokens[0]!.lexeme).toBe("a\\nb");
  });

  it("tokenizes single ampersand as bitwise and", () => {
    const tokens = tokensOf("&");
    expect(tokens.map((t) => t.kind)).toEqual(["Amp", "EOF"]);
    expect(tokens[0]!.lexeme).toBe("&");
  });

  it("tokenizes single pipe as bitwise or", () => {
    const tokens = tokensOf("|");
    expect(tokens.map((t) => t.kind)).toEqual(["Pipe", "EOF"]);
    expect(tokens[0]!.lexeme).toBe("|");
  });

  it("tokenizes multi-line string", () => {
    const tokens = tokensOf('"a\nb"');
    expect(tokens.map((t) => t.kind)).toEqual(["String", "EOF"]);
  });

  it("tokenizes compound assignment operators", () => {
    expect(tokensOf("+=").map((t) => t.kind)).toEqual(["PlusEq", "EOF"]);
    expect(tokensOf("-=").map((t) => t.kind)).toEqual(["MinusEq", "EOF"]);
    expect(tokensOf("*=").map((t) => t.kind)).toEqual(["StarEq", "EOF"]);
    expect(tokensOf("/=").map((t) => t.kind)).toEqual(["SlashEq", "EOF"]);
    expect(tokensOf("%=").map((t) => t.kind)).toEqual(["PercentEq", "EOF"]);
    expect(tokensOf("&=").map((t) => t.kind)).toEqual(["AmpEq", "EOF"]);
    expect(tokensOf("|=").map((t) => t.kind)).toEqual(["PipeEq", "EOF"]);
    expect(tokensOf("^=").map((t) => t.kind)).toEqual(["CaretEq", "EOF"]);
    expect(tokensOf("<<=").map((t) => t.kind)).toEqual(["LtLtEq", "EOF"]);
    expect(tokensOf(">>=").map((t) => t.kind)).toEqual(["GtGtEq", "EOF"]);
  });

  it("tokenizes increment decrement operators", () => {
    expect(tokensOf("++").map((t) => t.kind)).toEqual(["PlusPlus", "EOF"]);
    expect(tokensOf("--").map((t) => t.kind)).toEqual(["MinusMinus", "EOF"]);
  });

  it("tokenizes bitwise operators", () => {
    expect(tokensOf("&").map((t) => t.kind)).toEqual(["Amp", "EOF"]);
    expect(tokensOf("|").map((t) => t.kind)).toEqual(["Pipe", "EOF"]);
    expect(tokensOf("^").map((t) => t.kind)).toEqual(["Caret", "EOF"]);
    expect(tokensOf("~").map((t) => t.kind)).toEqual(["Tilde", "EOF"]);
    expect(tokensOf("<<").map((t) => t.kind)).toEqual(["LtLt", "EOF"]);
    expect(tokensOf(">>").map((t) => t.kind)).toEqual(["GtGt", "EOF"]);
  });

  it("tokenizes spaceship operator", () => {
    expect(tokensOf("<=>").map((t) => t.kind)).toEqual(["Spaceship", "EOF"]);
  });

  it("tokenizes null coalescing and ternary", () => {
    expect(tokensOf("??").map((t) => t.kind)).toEqual(["NullCoalescing", "EOF"]);
    expect(tokensOf("?").map((t) => t.kind)).toEqual(["Question", "EOF"]);
  });

  it("tokenizes match arrow", () => {
    expect(tokensOf("=>").map((t) => t.kind)).toEqual(["Arrow", "EOF"]);
  });

  it("tokenizes control flow keywords", () => {
    expect(tokensOf("while for do loop break continue match mut panic unreachable discard kill").map((t) => t.kind)).toEqual([
      "While", "For", "Do", "Loop", "Break", "Continue", "Match", "Mut", "Panic", "Unreachable", "Discard", "Kill", "EOF",
    ]);
  });

  it("tokenizes uniform keyword", () => {
    const tokens = tokensOf("uniform");
    expect(tokens.map((t) => t.kind)).toEqual(["Uniform", "EOF"]);
  });

  it("tokenizes brackets", () => {
    const tokens = tokensOf("[]");
    expect(tokens.map((t) => t.kind)).toEqual(["LBracket", "RBracket", "EOF"]);
  });

  it("peekNext returns null at end of source", () => {
    // "42." triggers peekNext() when current+1 >= source.length
    const tokens = tokensOf("42.");
    expect(tokens.map((t) => t.kind)).toEqual(["Int", "Dot", "EOF"]);
  });
});
