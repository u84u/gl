export type TokenKind =
  | "Fn"
  | "Struct"
  | "Return"
  | "If"
  | "Else"
  | "True"
  | "False"
  | "Let"
  | "Mut"
  | "Binding"
  | "Uniform"
  | "Import"
  | "Ident"
  | "Int"
  | "Float"
  | "String"
  | "Char"
  | "Color"
  | "LParen"
  | "RParen"
  | "LBrace"
  | "RBrace"
  | "LBracket"
  | "RBracket"
  | "Comma"
  | "Dot"
  | "Colon"
  | "Semicolon"
  | "Question"
  | "Assign"
  | "PlusEq"
  | "MinusEq"
  | "StarEq"
  | "SlashEq"
  | "PercentEq"
  | "AmpEq"
  | "PipeEq"
  | "CaretEq"
  | "LtLtEq"
  | "GtGtEq"
  | "Plus"
  | "Minus"
  | "Star"
  | "Slash"
  | "Percent"
  | "PlusPlus"
  | "MinusMinus"
  | "Eq"
  | "Neq"
  | "Lt"
  | "Gt"
  | "Lte"
  | "Gte"
  | "LtLt"
  | "GtGt"
  | "Spaceship"
  | "Range"
  | "And"
  | "Or"
  | "Not"
  | "Amp"
  | "Pipe"
  | "Caret"
  | "Tilde"
  | "NullCoalescing"
  | "Arrow"
  | "In"
  | "Opaque"
  | "Self"
  | "Ref"
  | "Deref"
  | "EOF"
  | "Illegal"
  | "While"
  | "For"
  | "Do"
  | "Loop"
  | "Break"
  | "Continue"
  | "Match"
  | "Panic"
  | "Unreachable"
  | "Discard"
  | "Kill"
  | "Enum"
  | "Impl"
  | "Trait"
  | "Type";

export interface Token {
  kind: TokenKind;
  lexeme: string;
  line: number;
  column: number;
}

const KEYWORDS: Record<string, TokenKind> = {
  fn: "Fn",
  struct: "Struct",
  return: "Return",
  if: "If",
  else: "Else",
  true: "True",
  false: "False",
  let: "Let",
  mut: "Mut",
  uniform: "Uniform",
  import: "Import",
  and: "And",
  or: "Or",
  while: "While",
  for: "For",
  do: "Do",
  loop: "Loop",
  break: "Break",
  continue: "Continue",
  match: "Match",
  panic: "Panic",
  unreachable: "Unreachable",
  discard: "Discard",
  kill: "Kill",
  enum: "Enum",
  impl: "Impl",
  trait: "Trait",
  type: "Type",
  in: "In",
  opaque: "Opaque",
  self: "Self",
  ref: "Ref",
  deref: "Deref",
};

export class Lexer {
  private source: string;
  private tokens: Token[] = [];
  private start = 0;
  private current = 0;
  private line = 1;
  private column = 1;

  constructor(source: string) {
    this.source = source;
  }

  scanTokens(): Token[] {
    while (!this.isAtEnd()) {
      this.start = this.current;
      const startColumn = this.column;
      const startLine = this.line;
      this.scanToken(startColumn, startLine);
    }
    this.tokens.push({ kind: "EOF", lexeme: "", line: this.line, column: this.column });
    return this.tokens;
  }

  private isAtEnd(): boolean {
    return this.current >= this.source.length;
  }

  private scanToken(startColumn: number, startLine: number): void {
    const c = this.advance();
    switch (c) {
      case "(": this.addToken("LParen", startColumn, startLine, "("); break;
      case ")": this.addToken("RParen", startColumn, startLine, ")"); break;
      case "{": this.addToken("LBrace", startColumn, startLine, "{"); break;
      case "}": this.addToken("RBrace", startColumn, startLine, "}"); break;
      case "[": this.addToken("LBracket", startColumn, startLine, "["); break;
      case "]": this.addToken("RBracket", startColumn, startLine, "]"); break;
      case ",": this.addToken("Comma", startColumn, startLine, ","); break;
      case ".": this.addToken(this.match(".") ? "Range" : "Dot", startColumn, startLine, "."); break;
      case ";": this.addToken("Semicolon", startColumn, startLine, ";"); break;
      case ":": this.addToken("Colon", startColumn, startLine, ":"); break;
      case "+": this.addToken(this.match("=") ? "PlusEq" : this.match("+") ? "PlusPlus" : "Plus", startColumn, startLine); break;
      case "-": this.addToken(this.match("=") ? "MinusEq" : this.match("-") ? "MinusMinus" : "Minus", startColumn, startLine); break;
      case "*": this.addToken(this.match("=") ? "StarEq" : "Star", startColumn, startLine); break;
      case "/": this.addToken(this.match("=") ? "SlashEq" : "Slash", startColumn, startLine); break;
      case "%": this.addToken(this.match("=") ? "PercentEq" : "Percent", startColumn, startLine); break;
      case "!": this.addToken(this.match("=") ? "Neq" : "Not", startColumn, startLine); break;
      case "=": this.addToken(this.match("=") ? "Eq" : this.match(">") ? "Arrow" : "Assign", startColumn, startLine); break;
      case "<": {
        if (this.match("<")) {
          this.addToken(this.match("=") ? "LtLtEq" : "LtLt", startColumn, startLine);
        } else if (this.match("=")) {
          if (this.match(">")) {
            this.addToken("Spaceship", startColumn, startLine);
          } else {
            this.addToken("Lte", startColumn, startLine);
          }
        } else {
          this.addToken("Lt", startColumn, startLine);
        }
        break;
      }
      case ">": {
        if (this.match(">")) {
          this.addToken(this.match("=") ? "GtGtEq" : "GtGt", startColumn, startLine);
        } else if (this.match("=")) {
          this.addToken("Gte", startColumn, startLine);
        } else {
          this.addToken("Gt", startColumn, startLine);
        }
        break;
      }
      case "&": this.addToken(this.match("&") ? "And" : this.match("=") ? "AmpEq" : "Amp", startColumn, startLine); break;
      case "|": this.addToken(this.match("|") ? "Or" : this.match("=") ? "PipeEq" : "Pipe", startColumn, startLine); break;
      case "^": this.addToken(this.match("=") ? "CaretEq" : "Caret", startColumn, startLine); break;
      case "~": this.addToken("Tilde", startColumn, startLine); break;
      case "?": this.addToken(this.match("?") ? "NullCoalescing" : "Question", startColumn, startLine); break;
      case "@": this.scanAttribute(startColumn, startLine); break;
      case " ":
      case "\r":
      case "\t":
        break;
      case "\n":
        this.line++;
        this.column = 1;
        break;
      case '"':
        this.scanString(startColumn, startLine);
        break;
      case "'":
        this.scanChar(startColumn, startLine);
        break;
      case "#":
        this.scanColor(startColumn, startLine);
        break;
      default:
        if (this.isDigit(c)) this.scanNumber(startColumn, startLine, c);
        else if (this.isAlpha(c)) this.scanIdentifier(startColumn, startLine);
        else this.addToken("Illegal", startColumn, startLine, c);
    }
  }

  private scanAttribute(startColumn: number, startLine: number): void {
    while (this.isAlpha(this.peek()) || this.isDigit(this.peek()) || this.peek() === "_") {
      this.advance();
    }
    const text = this.source.slice(this.start + 1, this.current);
    this.addToken("Binding", startColumn, startLine, text);
  }

  private scanIdentifier(startColumn: number, startLine: number): void {
    while (this.isAlphaNumeric(this.peek())) {
      this.advance();
    }
    const text = this.source.slice(this.start, this.current);
    const kind = KEYWORDS[text] ?? "Ident";
    this.addToken(kind, startColumn, startLine, text);
  }

  private scanNumber(startColumn: number, startLine: number, first: string): void {
    // Check for hex/octal/binary prefixes: 0x, 0o, 0b
    if (first === "0" && this.peek() !== "\0") {
      const next = this.peek();
      if (next === "x" || next === "X") {
        this.advance(); // consume 'x'
        while (this.isHexDigit(this.peek())) {
          this.advance();
        }
        const text = this.source.slice(this.start, this.current);
        this.addToken("Int", startColumn, startLine, text);
        return;
      }
      if (next === "o" || next === "O") {
        this.advance(); // consume 'o'
        while (this.isOctalDigit(this.peek())) {
          this.advance();
        }
        const text = this.source.slice(this.start, this.current);
        this.addToken("Int", startColumn, startLine, text);
        return;
      }
      if (next === "b" || next === "B") {
        this.advance(); // consume 'b'
        while (this.peek() === "0" || this.peek() === "1") {
          this.advance();
        }
        const text = this.source.slice(this.start, this.current);
        this.addToken("Int", startColumn, startLine, text);
        return;
      }
    }

    // Regular decimal integer
    while (this.isDigit(this.peek())) {
      this.advance();
    }

    let kind: TokenKind = "Int";

    // Check for float: '.' followed by digit, or 'e'/'E' exponent
    if (this.peek() === "." && this.isDigit(this.peekNext())) {
      kind = "Float";
      this.advance(); // consume '.'
      while (this.isDigit(this.peek())) {
        this.advance();
      }
    }

    if (this.peek() === "e" || this.peek() === "E") {
      kind = "Float";
      this.advance(); // consume 'e' or 'E'
      if (this.peek() === "+" || this.peek() === "-") {
        this.advance(); // consume sign
      }
      while (this.isDigit(this.peek())) {
        this.advance();
      }
    }

    const text = this.source.slice(this.start, this.current);
    this.addToken(kind, startColumn, startLine, text);
  }

  private scanChar(startColumn: number, startLine: number): void {
    // Scan a single character literal: 'a' or '\\n' etc.
    if (this.peek() === "\\") {
      this.advance(); // consume backslash
      this.advance(); // consume escaped char
    } else {
      this.advance(); // consume the char
    }
    if (this.peek() !== "'") {
      // Unterminated char literal - still produce a token but mark illegal
      this.addToken("Illegal", startColumn, startLine);
      return;
    }
    this.advance(); // consume closing quote
    const raw = this.source.slice(this.start, this.current);
    const text = raw.slice(1, -1);
    this.addToken("Char", startColumn, startLine, text);
  }

  private scanColor(startColumn: number, startLine: number): void {
    // Scan hex color: #RRGGBB or #RRGGBBAA
    const start = this.current;
    while (this.isHexDigit(this.peek())) {
      this.advance();
    }
    const text = this.source.slice(start, this.current);
    if (text.length !== 6 && text.length !== 8) {
      this.addToken("Illegal", startColumn, startLine);
      return;
    }
    this.addToken("Color", startColumn, startLine, text);
  }

  private scanString(startColumn: number, startLine: number): void {
    while (this.peek() !== '"' && !this.isAtEnd()) {
      if (this.peek() === "\n") this.line++;
      if (this.peek() === "\\") this.advance(); // skip escaped char
      this.advance();
    }
    if (this.isAtEnd()) {
      this.addToken("Illegal", startColumn, startLine);
      return;
    }
    this.advance(); // consume closing quote
    const raw = this.source.slice(this.start, this.current);
    const text = raw.slice(1, -1);
    this.addToken("String", startColumn, startLine, text);
  }

  private match(expected: string): boolean {
    if (this.isAtEnd()) return false;
    if (this.source.charAt(this.current) !== expected) return false;
    this.current++;
    this.column++;
    return true;
  }

  private advance(): string {
    const c = this.source.charAt(this.current++);
    if (c !== "\n") this.column++;
    return c;
  }

  private peek(): string {
    if (this.isAtEnd()) return "\0";
    return this.source.charAt(this.current);
  }

  private peekNext(): string {
    if (this.current + 1 >= this.source.length) return "\0";
    return this.source.charAt(this.current + 1);
  }

  private addToken(kind: TokenKind, startColumn: number, startLine: number, lexeme?: string): void {
    const text = lexeme ?? this.source.slice(this.start, this.current);
    this.tokens.push({ kind, lexeme: text, line: startLine, column: startColumn });
  }

  private isAlpha(c: string): boolean {
    return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
  }

  private isAlphaNumeric(c: string): boolean {
    return this.isAlpha(c) || this.isDigit(c);
  }

  private isDigit(c: string): boolean {
    return c >= "0" && c <= "9";
  }

  private isHexDigit(c: string): boolean {
    return c >= "0" && c <= "9" || c >= "a" && c <= "f" || c >= "A" && c <= "F";
  }

  private isOctalDigit(c: string): boolean {
    return c >= "0" && c <= "7";
  }
}

export function tokenize(source: string): Token[] {
  return new Lexer(source).scanTokens();
}
