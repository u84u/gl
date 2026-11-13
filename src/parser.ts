import {
  Program,
  Statement,
  Expression,
  Type,
  Field,
  Param,
  StructDecl,
  EnumDecl,
  ImplBlock,
  TraitDecl,
  TypeAlias,
  FnDecl,
  VarDecl,
  ReturnStmt,
  Block,
  ExpressionStmt,
  CallExpr,
  StructLiteral,
  ArrayLiteral,
  Span,
  BindingDecl,
  ImportDecl,
  CompoundAssignExpr,
  WhileStmt,
  ForStmt,
  DoWhileStmt,
  LoopStmt,
  BreakStmt,
  ContinueStmt,
  MatchExpr,
  MatchArm,
  PanicStmt,
  UnreachableStmt,
  DiscardStmt,
  Pattern,
  BlockExpr,
  NewtypeDecl,
  OpaqueDecl,
} from "./types";
import { Token, TokenKind } from "./lexer";

export class ParseError extends Error {
  constructor(public token: Token, message: string) {
    super(`[line ${token.line}] Error at '${token.lexeme}': ${message}`);
    this.name = "ParseError";
  }
}

export class Parser {
  private tokens: Token[];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  /**
   * Parses a list of tokens into a Program AST.
   *
   * @returns The parsed Program node.
   */
  parse(): Program {
    const statements: Statement[] = [];
    while (!this.isAtEnd()) {
      statements.push(this.declaration());
    }
    const span: Span = { line: 1, column: 1 };
    return { kind: "Program", statements, span };
  }

  private declaration(): Statement {
    if (this.match("Struct")) {
      // Check if this is a newtype: struct Name(Type)
      if (this.check("Ident") && this.peekNextKind() === "LParen") {
        return this.newtypeDeclaration();
      }
      return this.structDeclaration();
    }
    if (this.match("Fn")) return this.functionDeclaration();
    if (this.match("Binding")) return this.bindingDeclaration();
    if (this.match("Import")) return this.importDeclaration();
    if (this.match("Enum")) return this.enumDeclaration();
    if (this.match("Impl")) return this.implBlock();
    if (this.match("Trait")) return this.traitDeclaration();
    if (this.match("Type")) return this.typeAliasDeclaration();
    if (this.match("Opaque")) return this.opaqueDeclaration();
    return this.statement();
  }

  private structDeclaration(): StructDecl {
    const structToken = this.previous();
    const startSpan = this.spanOf(structToken);
    const name = this.consume("Ident", "Expect struct name after 'struct'.");
    this.consume("LBrace", "Expect '{' before struct body.");
    const fields: Field[] = [];
    while (!this.check("RBrace") && !this.isAtEnd()) {
      const fieldType = this.type();
      const fieldName = this.consume("Ident", "Expect field name.");
      fields.push({ name: fieldName.lexeme, type: fieldType });
      if (!this.check("RBrace")) {
        this.consume("Comma", "Expect ',' after field.");
      }
    }
    this.consume("RBrace", "Expect '}' after struct body.");
    return { kind: "StructDecl", name: name.lexeme, fields, span: startSpan };
  }

  private newtypeDeclaration(): NewtypeDecl {
    const startSpan = this.spanOf(this.previous());
    const name = this.consume("Ident", "Expect newtype name after 'struct'.");
    this.consume("LParen", "Expect '(' after newtype name.");
    const innerType = this.type();
    this.consume("RParen", "Expect ')' after newtype inner type.");
    this.optionalSemicolon();
    return { kind: "NewtypeDecl", name: name.lexeme, innerType, span: startSpan };
  }

  private functionDeclaration(selfType: Type | null = null): FnDecl {
    const fnToken = this.previous();
    const startSpan = this.spanOf(fnToken);
    const name = this.consume("Ident", "Expect function name after 'fn'.");
    this.consume("LParen", "Expect '(' after function name.");
    const params: Param[] = [];
    if (!this.check("RParen")) {
      do {
        const paramName = this.consume("Ident", "Expect parameter name.");
        this.consume("Colon", "Expect ':' after parameter name.");
        let paramType = this.type();
        if (paramName.lexeme === "self" && selfType) {
          paramType = selfType;
        }
        params.push({ name: paramName.lexeme, type: paramType });
      } while (this.match("Comma"));
    }
    this.consume("RParen", "Expect ')' after parameters.");
    this.consume("Colon", "Expect ':' before return type.");
    const returnType = this.type();
    this.consume("LBrace", "Expect '{' before function body.");
    const body = this.block();
    return { kind: "FnDecl", name: name.lexeme, params, returnType, body, span: startSpan };
  }

  private bindingDeclaration(): BindingDecl {
    const bindingToken = this.previous();
    const startSpan = this.spanOf(bindingToken);
    this.consume("LParen", "Expect '(' after '@binding'.");
    const bindingIndex = this.consume("Int", "Expect binding slot number.");
    const binding = parseInt(bindingIndex.lexeme, 10);
    this.consume("RParen", "Expect ')' after binding slot number.");
    this.consume("Uniform", "Expect 'uniform' after '@binding(N)'.");
    const name = this.consume("Ident", "Expect uniform name.");
    this.consume("Colon", "Expect ':' after uniform name.");
    const type = this.type();
    this.optionalSemicolon();
    return { kind: "BindingDecl", binding, name: name.lexeme, type, span: startSpan };
  }

  private importDeclaration(): ImportDecl {
    const importToken = this.previous();
    const startSpan = this.spanOf(importToken);
    const pathToken = this.consume("String", "Expect string path after 'import'.");
    this.optionalSemicolon();
    return { kind: "ImportDecl", path: pathToken.lexeme, span: startSpan };
  }

  private enumDeclaration(): EnumDecl {
    const enumToken = this.previous();
    const startSpan = this.spanOf(enumToken);
    const name = this.consume("Ident", "Expect enum name after 'enum'.");
    this.consume("LBrace", "Expect '{' before enum body.");
    const variants: { name: string; type: Type | null }[] = [];
    while (!this.check("RBrace") && !this.isAtEnd()) {
      const variantName = this.consume("Ident", "Expect variant name.");
      let variantType: Type | null = null;
      if (this.match("LParen")) {
        variantType = this.type();
        this.consume("RParen", "Expect ')' after variant type.");
      }
      variants.push({ name: variantName.lexeme, type: variantType });
      if (!this.check("RBrace")) {
        this.consume("Comma", "Expect ',' after variant.");
      }
    }
    this.consume("RBrace", "Expect '}' after enum body.");
    return { kind: "EnumDecl", name: name.lexeme, variants, span: startSpan };
  }

  private implBlock(): ImplBlock {
    const implToken = this.previous();
    const startSpan = this.spanOf(implToken);
    let trait: string | null = null;
    let type: Type;
    if (this.match("For")) {
      // impl for Type { ... } - not valid syntax, but handle gracefully
      type = this.typeTraitOrStruct();
    } else {
      // Could be "impl Trait for Type" or "impl Type { ... }"
      const firstIdent = this.consume("Ident", "Expect trait or type name after 'impl'.");
      if (this.match("For")) {
        type = this.type();
        trait = firstIdent.lexeme;
      } else {
        type = { kind: "struct", name: firstIdent.lexeme };
      }
    }
    this.consume("LBrace", "Expect '{' before impl body.");
    const methods: FnDecl[] = [];
    while (!this.check("RBrace") && !this.isAtEnd()) {
      if (this.match("Fn")) {
        methods.push(this.functionDeclaration(type));
      } else {
        throw new ParseError(this.peek(), "Expect 'fn' in impl block.");
      }
    }
    this.consume("RBrace", "Expect '}' after impl body.");
    return { kind: "ImplBlock", trait, type, methods, span: startSpan };
  }

  private typeTraitOrStruct(): Type {
    const token = this.consume("Ident", "Expect type name.");
    return { kind: "struct", name: token.lexeme };
  }

  private traitDeclaration(): TraitDecl {
    const traitToken = this.previous();
    const startSpan = this.spanOf(traitToken);
    const name = this.consume("Ident", "Expect trait name after 'trait'.");
    const bounds: string[] = [];
    if (this.match("Colon")) {
      do {
        bounds.push(this.consume("Ident", "Expect trait name after ':'.").lexeme);
      } while (this.match("Comma"));
    }
    this.consume("LBrace", "Expect '{' before trait body.");
    const methods: { name: string; params: Param[]; returnType: Type }[] = [];
    while (!this.check("RBrace") && !this.isAtEnd()) {
      this.consume("Fn", "Expect 'fn' before method name in trait.");
      const methodName = this.consume("Ident", "Expect method name.");
      this.consume("LParen", "Expect '(' after method name.");
      const params: Param[] = [];
      if (!this.check("RParen")) {
        do {
          const paramName = this.consume("Ident", "Expect parameter name.");
          this.consume("Colon", "Expect ':' after parameter name.");
          const paramType = this.type();
          params.push({ name: paramName.lexeme, type: paramType });
        } while (this.match("Comma"));
      }
      this.consume("RParen", "Expect ')' after parameters.");
      this.consume("Colon", "Expect ':' before return type.");
      const returnType = this.type();
      this.optionalSemicolon();
      methods.push({ name: methodName.lexeme, params, returnType });
    }
    this.consume("RBrace", "Expect '}' after trait body.");
    return { kind: "TraitDecl", name: name.lexeme, bounds, methods, span: startSpan };
  }

  private typeAliasDeclaration(): TypeAlias {
    const typeToken = this.previous();
    const startSpan = this.spanOf(typeToken);
    const name = this.consume("Ident", "Expect type alias name after 'type'.");
    this.consume("Assign", "Expect '=' after type alias name.");
    const type = this.type();
    this.optionalSemicolon();
    return { kind: "TypeAlias", name: name.lexeme, type, span: startSpan };
  }

  private opaqueDeclaration(): OpaqueDecl {
    const startSpan = this.spanOf(this.previous());
    const name = this.consume("Ident", "Expect opaque type name after 'opaque'.");
    this.optionalSemicolon();
    return { kind: "OpaqueDecl", name: name.lexeme, span: startSpan };
  }

  private statement(): Statement {
    if (this.match("Let")) return this.varDeclaration();
    if (this.match("Fn")) return this.functionDeclaration();
    if (this.match("If")) return this.ifStatement();
    if (this.match("While")) return this.whileStatement();
    if (this.match("For")) return this.forStatement();
    if (this.match("Do")) return this.doWhileStatement();
    if (this.match("Loop")) return this.loopStatement(null);
    if (this.check("Ident")) {
      if (this.peekNextKind() === "Colon" && this.peekNextNextKind() === "Loop") {
        const label = this.advance().lexeme;
        this.advance(); // Colon
        this.advance(); // Loop
        return this.loopStatement(label);
      }
    }
    if (this.match("Break")) return this.breakStatement();
    if (this.match("Continue")) return this.continueStatement();
    if (this.match("Return")) return this.returnStatement();
    if (this.match("Panic")) return this.panicStatement();
    if (this.match("Unreachable")) return this.unreachableStatement();
    if (this.match("Discard")) return this.discardStatement();
    if (this.match("Kill")) return this.discardStatement();
    if (this.match("Match")) {
      const matchExpr = this.matchExpression();
      return { kind: "ExpressionStmt", expression: matchExpr, span: matchExpr.span };
    }
    if (this.match("LBrace")) return this.block();
    return this.expressionStatement();
  }

  private varDeclaration(): VarDecl {
    const letToken = this.previous();
    const startSpan = this.spanOf(letToken);
    let mutable = false;
    if (this.match("Mut")) {
      mutable = true;
    }
    const name = this.consume("Ident", "Expect variable name.");
    this.consume("Colon", "Expect ':' after variable name.");
    const type = this.type();
    let initializer: Expression | null = null;
    if (this.match("Assign")) {
      initializer = this.expression();
    }
    this.optionalSemicolon();
    return { kind: "VarDecl", name: name.lexeme, type, initializer, mutable, span: startSpan };
  }

  private ifStatement(): Statement {
    const ifToken = this.previous();
    const startSpan = this.spanOf(ifToken);
    this.consume("LParen", "Expect '(' after 'if'.");
    const condition = this.expression();
    this.consume("RParen", "Expect ')' after if condition.");
    this.consume("LBrace", "Expect '{' before if body.");
    const thenBranch = this.block();
    let elseBranch: Block | null = null;
    if (this.match("Else")) {
      if (this.match("If")) {
        const nestedIf = this.ifStatement();
        elseBranch = {
          kind: "Block",
          statements: [nestedIf],
          span: startSpan,
        };
      } else {
        this.consume("LBrace", "Expect '{' before else body.");
        elseBranch = this.block();
      }
    }
    return { kind: "IfStmt", condition, thenBranch, elseBranch, span: startSpan };
  }

  private whileStatement(): WhileStmt {
    const whileToken = this.previous();
    const startSpan = this.spanOf(whileToken);
    this.consume("LParen", "Expect '(' after 'while'.");
    const condition = this.expression();
    this.consume("RParen", "Expect ')' after while condition.");
    this.consume("LBrace", "Expect '{' before while body.");
    const body = this.block();
    return { kind: "WhileStmt", condition, body, span: startSpan };
  }

  private forStatement(): ForStmt {
    const forToken = this.previous();
    const startSpan = this.spanOf(forToken);
    // Range-based for: for x in start..end { ... }
    if (this.check("Ident") && !this.check("LParen")) {
      this.consume("Ident", "Expect loop variable name.");
      this.consume("In", "Expect 'in' after loop variable name.");
      const start = this.expression();
      this.consume("Range", "Expect '..' in range expression.");
      const end = this.expression();
      const inclusive = this.match("Eq"); // optional = for inclusive range ..=
      this.consume("LBrace", "Expect '{' before for body.");
      const body = this.block();
      return {
        kind: "ForStmt",
        init: null,
        condition: null,
        increment: null,
        range: { start, end, inclusive },
        body,
        span: startSpan,
      };
    }
    // C-style for: for (init; cond; incr) { ... }
    this.consume("LParen", "Expect '(' after 'for'.");
    let init: VarDecl | ExpressionStmt | null = null;
    if (!this.check("Semicolon")) {
      if (this.match("Let")) {
        init = this.varDeclaration();
      } else {
        init = this.expressionStatement();
      }
    } else {
      this.advance();
    }
    let condition: Expression | null = null;
    if (!this.check("Semicolon")) {
      condition = this.expression();
    }
    this.consume("Semicolon", "Expect ';' after for condition.");
    let increment: Expression | null = null;
    if (!this.check("RParen")) {
      increment = this.expression();
    }
    this.consume("RParen", "Expect ')' after for clauses.");
    this.consume("LBrace", "Expect '{' before for body.");
    const body = this.block();
    return { kind: "ForStmt", init, condition, increment, range: null, body, span: startSpan };
  }

  private doWhileStatement(): DoWhileStmt {
    const doToken = this.previous();
    const startSpan = this.spanOf(doToken);
    this.consume("LBrace", "Expect '{' after 'do'.");
    const body = this.block();
    this.consume("While", "Expect 'while' after 'do' block.");
    this.consume("LParen", "Expect '(' after 'while'.");
    const condition = this.expression();
    this.consume("RParen", "Expect ')' after do-while condition.");
    this.optionalSemicolon();
    return { kind: "DoWhileStmt", body, condition, span: startSpan };
  }

  private loopStatement(label: string | null = null): LoopStmt {
    const loopToken = this.previous();
    const startSpan = this.spanOf(loopToken);
    this.consume("LBrace", "Expect '{' before loop body.");
    const body = this.block();
    return { kind: "LoopStmt", body, label, span: startSpan };
  }

  private breakStatement(): BreakStmt {
    const breakToken = this.previous();
    const startSpan = this.spanOf(breakToken);
    let label: string | null = null;
    if (this.check("Ident")) {
      label = this.advance().lexeme;
    }
    this.optionalSemicolon();
    return { kind: "BreakStmt", label, span: startSpan };
  }

  private continueStatement(): ContinueStmt {
    const continueToken = this.previous();
    const startSpan = this.spanOf(continueToken);
    let label: string | null = null;
    if (this.check("Ident")) {
      label = this.advance().lexeme;
    }
    this.optionalSemicolon();
    return { kind: "ContinueStmt", label, span: startSpan };
  }

  private panicStatement(): PanicStmt {
    const panicToken = this.previous();
    const startSpan = this.spanOf(panicToken);
    let message: Expression | null = null;
    const statementStart = new Set(["Semicolon", "RBrace", "Fn", "Struct", "Return", "If", "Else", "While", "For", "Do", "Loop", "Break", "Continue", "Panic", "Unreachable", "Discard", "Kill", "Match", "Let", "Binding", "Import", "Enum", "Impl", "Trait", "Type"]);
    if (!statementStart.has(this.peek().kind)) {
      message = this.expression();
    }
    this.optionalSemicolon();
    return { kind: "PanicStmt", message, span: startSpan };
  }

  private unreachableStatement(): UnreachableStmt {
    const unreachableToken = this.previous();
    const startSpan = this.spanOf(unreachableToken);
    this.optionalSemicolon();
    return { kind: "UnreachableStmt", span: startSpan };
  }

  private discardStatement(): DiscardStmt {
    const discardToken = this.previous();
    const startSpan = this.spanOf(discardToken);
    this.optionalSemicolon();
    return { kind: "DiscardStmt", span: startSpan };
  }

  private matchExpression(): MatchExpr {
    const matchToken = this.previous();
    const startSpan = this.spanOf(matchToken);
    const subject = this.expression();
    this.consume("LBrace", "Expect '{' after match subject.");
    const arms: MatchArm[] = [];
    while (!this.check("RBrace") && !this.isAtEnd()) {
      const pattern = this.parsePattern();
      let guard: Expression | null = null;
      if (this.match("If")) {
        guard = this.expression();
      }
      this.consume("Arrow", "Expect '=>' before match arm body.");
      this.consume("LBrace", "Expect '{' before match arm body.");
      const body = this.block();
      arms.push({ pattern, guard, body, span: startSpan });
    }
    this.consume("RBrace", "Expect '}' after match arms.");
    return { kind: "MatchExpr", subject, arms, span: startSpan };
  }

  private parsePattern(): Pattern {
    if (this.match("Ref")) {
      const sub = this.parsePattern();
      return { kind: "ref", binding: null, value: null, subPatterns: [sub], span: sub.span };
    }
    if (this.match("Deref")) {
      const sub = this.parsePattern();
      return { kind: "deref", binding: null, value: null, subPatterns: [sub], span: sub.span };
    }
    if (this.match("Ident")) {
      const name = this.previous().lexeme;
      if (name === "_") {
        return { kind: "wildcard", binding: null, value: null, subPatterns: [], span: this.spanOf(this.previous()) };
      }
      return { kind: "binding", binding: name, value: null, subPatterns: [], span: this.spanOf(this.previous()) };
    }
    if (this.match("Int")) {
      return { kind: "literal", binding: null, value: this.parseIntLiteral(this.previous().lexeme), subPatterns: [], span: this.spanOf(this.previous()) };
    }
    if (this.match("LBrace")) {
      const startSpan = this.spanOf(this.previous());
      const subPatterns: Pattern[] = [];
      while (!this.check("RBrace") && !this.isAtEnd()) {
        subPatterns.push(this.parsePattern());
        if (!this.check("RBrace")) this.consume("Comma", "Expect ',' after pattern.");
      }
      this.consume("RBrace", "Expect '}' after struct pattern.");
      return { kind: "struct", binding: null, value: null, subPatterns, span: startSpan };
    }
    if (this.match("LParen")) {
      const startSpan = this.spanOf(this.previous());
      const subPatterns: Pattern[] = [];
      while (!this.check("RParen") && !this.isAtEnd()) {
        subPatterns.push(this.parsePattern());
        if (!this.check("RParen")) this.consume("Comma", "Expect ',' after pattern.");
      }
      this.consume("RParen", "Expect ')' after tuple pattern.");
      return { kind: "tuple", binding: null, value: null, subPatterns, span: startSpan };
    }
    if (this.match("LBracket")) {
      const startSpan = this.spanOf(this.previous());
      const subPatterns: Pattern[] = [];
      while (!this.check("RBracket") && !this.isAtEnd()) {
        subPatterns.push(this.parsePattern());
        if (!this.check("RBracket")) this.consume("Comma", "Expect ',' after pattern.");
      }
      this.consume("RBracket", "Expect ']' after array pattern.");
      return { kind: "array", binding: null, value: null, subPatterns, span: startSpan };
    }
    throw new ParseError(this.peek(), "Expect pattern.");
  }

  private returnStatement(): ReturnStmt {
    const returnToken = this.previous();
    const startSpan = this.spanOf(returnToken);
    let value: Expression | null = null;
    if (
      !this.check("Semicolon") &&
      !this.check("RBrace") &&
      !this.check("Fn") &&
      !this.check("Struct")
    ) {
      value = this.expression();
    }
    this.optionalSemicolon();
    return { kind: "ReturnStmt", value, span: startSpan };
  }

  private block(): Block {
    const lbraceToken = this.previous();
    const startSpan = this.spanOf(lbraceToken);
    const statements: Statement[] = [];
    while (!this.check("RBrace") && !this.isAtEnd()) {
      statements.push(this.declaration());
    }
    this.consume("RBrace", "Expect '}' after block.");
    return { kind: "Block", statements, span: startSpan };
  }

  private expressionStatement(): ExpressionStmt {
    const expr = this.expression();
    this.optionalSemicolon();
    return { kind: "ExpressionStmt", expression: expr, span: expr.span };
  }

  private expression(): Expression {
    return this.assignment();
  }

  private assignment(): Expression {
    const expr = this.conditional();
    if (this.match("PlusEq", "MinusEq", "StarEq", "SlashEq", "PercentEq", "AmpEq", "PipeEq", "CaretEq", "LtLtEq", "GtGtEq")) {
      const operator = this.previous().lexeme as CompoundAssignExpr["operator"];
      const value = this.assignment();
      if (expr.kind === "Identifier" || expr.kind === "MemberExpr" || expr.kind === "IndexExpr") {
        return {
          kind: "CompoundAssignExpr",
          operator,
          target: expr,
          value,
          span: expr.span,
        };
      }
      throw new ParseError(this.previous(), "Invalid assignment target for compound assignment.");
    }
    if (this.match("Assign")) {
      const equals = this.previous();
      const value = this.assignment();
      if (expr.kind === "Identifier") {
        return {
          kind: "BinaryExpr",
          left: expr,
          operator: "=",
          right: value,
          span: expr.span,
        };
      }
      throw new ParseError(equals, "Invalid assignment target.");
    }
    return expr;
  }

  private conditional(): Expression {
    const test = this.logicalOr();
    if (this.match("Question")) {
      const consequent = this.expression();
      this.consume("Colon", "Expect ':' after ternary condition.");
      const alternate = this.expression();
      return {
        kind: "ConditionalExpr",
        test,
        consequent,
        alternate,
        span: test.span,
      };
    }
    if (this.match("NullCoalescing")) {
      const right = this.expression();
      return {
        kind: "NullCoalescingExpr",
        left: test,
        right,
        span: test.span,
      };
    }
    return test;
  }

  private logicalOr(): Expression {
    let expr = this.logicalAnd();
    while (this.match("Or")) {
      const operator = this.previous().lexeme;
      const right = this.logicalAnd();
      expr = {
        kind: "BinaryExpr",
        left: expr,
        operator,
        right,
        span: expr.span,
      };
    }
    return expr;
  }

  private logicalAnd(): Expression {
    let expr = this.bitOr();
    while (this.match("And")) {
      const operator = this.previous().lexeme;
      const right = this.bitOr();
      expr = {
        kind: "BinaryExpr",
        left: expr,
        operator,
        right,
        span: expr.span,
      };
    }
    return expr;
  }

  private bitOr(): Expression {
    let expr = this.bitXor();
    while (this.match("Pipe")) {
      const operator = this.previous().lexeme;
      const right = this.bitXor();
      expr = {
        kind: "BinaryExpr",
        left: expr,
        operator,
        right,
        span: expr.span,
      };
    }
    return expr;
  }

  private bitXor(): Expression {
    let expr = this.bitAnd();
    while (this.match("Caret")) {
      const operator = this.previous().lexeme;
      const right = this.bitAnd();
      expr = {
        kind: "BinaryExpr",
        left: expr,
        operator,
        right,
        span: expr.span,
      };
    }
    return expr;
  }

  private bitAnd(): Expression {
    let expr = this.equality();
    while (this.match("Amp")) {
      const operator = this.previous().lexeme;
      const right = this.equality();
      expr = {
        kind: "BinaryExpr",
        left: expr,
        operator,
        right,
        span: expr.span,
      };
    }
    return expr;
  }

  private equality(): Expression {
    let expr = this.comparison();
    while (this.match("Eq", "Neq")) {
      const operator = this.previous().lexeme;
      const right = this.comparison();
      expr = {
        kind: "BinaryExpr",
        left: expr,
        operator,
        right,
        span: expr.span,
      };
    }
    return expr;
  }

  private comparison(): Expression {
    let expr = this.shift();
    while (this.match("Lt", "Lte", "Gt", "Gte", "Spaceship")) {
      const operator = this.previous().lexeme;
      const right = this.shift();
      expr = {
        kind: "BinaryExpr",
        left: expr,
        operator,
        right,
        span: expr.span,
      };
    }
    return expr;
  }

  private shift(): Expression {
    let expr = this.term();
    while (this.match("LtLt", "GtGt")) {
      const operator = this.previous().lexeme;
      const right = this.term();
      expr = {
        kind: "BinaryExpr",
        left: expr,
        operator,
        right,
        span: expr.span,
      };
    }
    return expr;
  }

  private term(): Expression {
    let expr = this.factor();
    while (this.match("Plus", "Minus")) {
      const operator = this.previous().lexeme;
      const right = this.factor();
      expr = {
        kind: "BinaryExpr",
        left: expr,
        operator,
        right,
        span: expr.span,
      };
    }
    return expr;
  }

  private factor(): Expression {
    let expr = this.unary();
    while (this.match("Star", "Slash", "Percent")) {
      const operator = this.previous().lexeme;
      const right = this.unary();
      expr = {
        kind: "BinaryExpr",
        left: expr,
        operator,
        right,
        span: expr.span,
      };
    }
    return expr;
  }

  private unary(): Expression {
    if (this.match("PlusPlus", "MinusMinus")) {
      const operator = this.previous().lexeme as "++" | "--";
      const operand = this.unary();
      return { kind: "UpdateExpr", operator, operand, prefix: true, span: operand.span };
    }
    if (this.match("Minus", "Not", "Tilde")) {
      const operator = this.previous().lexeme;
      const operand = this.unary();
      return { kind: "UnaryExpr", operator, operand, span: operand.span };
    }
    let expr = this.call();
    if (this.check("PlusPlus") || this.check("MinusMinus")) {
      if (expr.kind === "Identifier" || expr.kind === "MemberExpr" || expr.kind === "IndexExpr") {
        const operator = this.advance().lexeme as "++" | "--";
        return { kind: "UpdateExpr", operator, operand: expr, prefix: false, span: expr.span };
      }
    }
    return expr;
  }

  private call(): Expression {
    let expr = this.primary();
    while (true) {
      if (this.match("LParen")) {
        expr = this.finishCall(expr);
      } else if (this.match("Dot")) {
        const name = this.consume("Ident", "Expect property name after '.'.");
        if (this.match("LParen")) {
          expr = this.finishCall({ kind: "MemberExpr", object: expr, property: name.lexeme, span: expr.span });
        } else if (this.isSwizzle(name.lexeme) && name.lexeme.length > 1) {
          expr = {
            kind: "SwizzleExpr",
            object: expr,
            components: name.lexeme.split(""),
            span: expr.span,
          };
        } else {
          expr = { kind: "MemberExpr", object: expr, property: name.lexeme, span: expr.span };
        }
      } else if (this.match("LBracket")) {
        const index = this.expression();
        this.consume("RBracket", "Expect ']' after array index.");
        expr = { kind: "IndexExpr", object: expr, index, span: expr.span };
      } else {
        break;
      }
    }
    return expr;
  }

  private finishCall(callee: Expression): CallExpr {
    const args: Expression[] = [];
    if (!this.check("RParen")) {
      do {
        args.push(this.expression());
      } while (this.match("Comma"));
    }
    this.consume("RParen", "Expect ')' after arguments.");
    return { kind: "CallExpr", callee, args, span: callee.span };
  }

  private primary(): Expression {
    if (this.match("False")) {
      return { kind: "Literal", value: false, literalKind: "bool", span: this.spanOf(this.previous()) };
    }
    if (this.match("True")) {
      return { kind: "Literal", value: true, literalKind: "bool", span: this.spanOf(this.previous()) };
    }
    if (this.match("Int")) {
      return {
        kind: "Literal",
        value: this.parseIntLiteral(this.previous().lexeme),
        literalKind: "int",
        span: this.spanOf(this.previous()),
      };
    }
    if (this.match("Float")) {
      return {
        kind: "Literal",
        value: parseFloat(this.previous().lexeme),
        literalKind: "float",
        span: this.spanOf(this.previous()),
      };
    }
    if (this.match("Char")) {
      return {
        kind: "Literal",
        value: this.previous().lexeme,
        literalKind: "char",
        span: this.spanOf(this.previous()),
      };
    }
    if (this.match("Color")) {
      return {
        kind: "Literal",
        value: this.previous().lexeme,
        literalKind: "color",
        span: this.spanOf(this.previous()),
      };
    }
    if (this.match("Ident")) {
      return { kind: "Identifier", name: this.previous().lexeme, span: this.spanOf(this.previous()) };
    }
    if (this.check("LBrace")) {
      if (this.peekNextKind() === "Dot" || (this.check("Ident") && this.peekNextNextKind() === "LBrace")) {
        return this.structLiteral();
      }
      return this.blockExpression();
    }
    if (this.match("LBracket")) {
      return this.arrayLiteral();
    }
    if (this.match("LParen")) {
      const expr = this.expression();
      this.consume("RParen", "Expect ')' after expression.");
      return expr;
    }
    throw new ParseError(this.peek(), "Expect expression.");
  }

  private parseIntLiteral(lexeme: string): number {
    if (lexeme.startsWith("0x") || lexeme.startsWith("0X")) {
      return parseInt(lexeme.slice(2), 16);
    }
    if (lexeme.startsWith("0o") || lexeme.startsWith("0O")) {
      return parseInt(lexeme.slice(2), 8);
    }
    if (lexeme.startsWith("0b") || lexeme.startsWith("0B")) {
      return parseInt(lexeme.slice(2), 2);
    }
    return parseInt(lexeme, 10);
  }

  private structLiteral(): StructLiteral {
    this.consume("LBrace", "Expect '{' before struct literal.");
    const startSpan = this.spanOf(this.previous());
    const fields: { name: string | null; value: Expression }[] = [];

    while (!this.check("RBrace") && !this.isAtEnd()) {
      if (this.check("Dot") && this.peekNextKind() === "Dot") {
        // Spread: ..expression
        this.advance(); // consume first Dot
        this.advance(); // consume second Dot
        const value = this.expression();
        fields.push({ name: null, value });
      } else {
        this.consume("Dot", "Expect '.' before field name.");
        const fieldName = this.consume("Ident", "Expect field name after '.'.").lexeme;
        this.consume("Assign", "Expect '=' after field name.");
        const value = this.expression();
        fields.push({ name: fieldName, value });
      }
      if (!this.check("RBrace")) {
        this.consume("Comma", "Expect ',' after field initializer.");
      }
    }

    this.consume("RBrace", "Expect '}' after struct literal.");
    return { kind: "StructLiteral", typeName: "", fields, span: startSpan };
  }

  private blockExpression(): BlockExpr {
    this.consume("LBrace", "Expect '{' before block expression.");
    const startSpan = this.spanOf(this.previous());
    const statements: Statement[] = [];
    while (!this.check("RBrace") && !this.isAtEnd()) {
      statements.push(this.statement());
    }
    this.consume("RBrace", "Expect '}' after block expression.");
    return { kind: "BlockExpr", block: { kind: "Block", statements, span: startSpan }, span: startSpan };
  }

  private arrayLiteral(): ArrayLiteral {
    const startSpan = this.spanOf(this.previous());
    const elements: Expression[] = [];
    if (!this.check("RBracket")) {
      do {
        elements.push(this.expression());
      } while (this.match("Comma"));
    }
    this.consume("RBracket", "Expect ']' after array literal elements.");
    return { kind: "ArrayLiteral", elements, span: startSpan };
  }

  private type(): Type {
    if (this.match("LBracket")) {
      const element = this.type();
      this.consume("Semicolon", "Expect ';' after array element type.");
      const sizeToken = this.consume("Int", "Expect array size.");
      const size = parseInt(sizeToken.lexeme, 10);
      this.consume("RBracket", "Expect ']' after array size.");
      return { kind: "array", element, size };
    }
    if (this.match("Struct")) {
      this.consume("LBrace", "Expect '{' after 'struct' in anonymous struct type.");
      const fields: Field[] = [];
      while (!this.check("RBrace") && !this.isAtEnd()) {
        const fieldType = this.type();
        const fieldName = this.consume("Ident", "Expect field name.");
        fields.push({ name: fieldName.lexeme, type: fieldType });
        if (!this.check("RBrace")) {
          this.consume("Comma", "Expect ',' after field.");
        }
      }
      this.consume("RBrace", "Expect '}' after anonymous struct type.");
      return { kind: "anonymousStruct", fields };
    }
    const token = this.consume("Ident", "Expect type name.");
    const typeName = token.lexeme;
    switch (typeName) {
      case "i8":
        return { kind: "scalar", name: "i8" };
      case "u8":
        return { kind: "scalar", name: "u8" };
      case "i16":
        return { kind: "scalar", name: "i16" };
      case "u16":
        return { kind: "scalar", name: "u16" };
      case "i32":
        return { kind: "scalar", name: "i32" };
      case "u32":
        return { kind: "scalar", name: "u32" };
      case "i64":
        return { kind: "scalar", name: "i64" };
      case "u64":
        return { kind: "scalar", name: "u64" };
      case "f16":
        return { kind: "scalar", name: "f16" };
      case "f32":
        return { kind: "scalar", name: "f32" };
      case "f64":
        return { kind: "scalar", name: "f64" };
      case "bf16":
        return { kind: "scalar", name: "bf16" };
      case "bool":
        return { kind: "scalar", name: "bool" };
      case "vec2":
        return { kind: "vector", element: "f32", size: 2 };
      case "vec3":
        return { kind: "vector", element: "f32", size: 3 };
      case "vec4":
        return { kind: "vector", element: "f32", size: 4 };
      case "ivec2":
        return { kind: "vector", element: "i32", size: 2 };
      case "ivec3":
        return { kind: "vector", element: "i32", size: 3 };
      case "ivec4":
        return { kind: "vector", element: "i32", size: 4 };
      case "uvec2":
        return { kind: "vector", element: "u32", size: 2 };
      case "uvec3":
        return { kind: "vector", element: "u32", size: 3 };
      case "uvec4":
        return { kind: "vector", element: "u32", size: 4 };
      case "bvec2":
        return { kind: "vector", element: "bool", size: 2 };
      case "bvec3":
        return { kind: "vector", element: "bool", size: 3 };
      case "bvec4":
        return { kind: "vector", element: "bool", size: 4 };
      case "dvec2":
        return { kind: "vector", element: "f64", size: 2 };
      case "dvec3":
        return { kind: "vector", element: "f64", size: 3 };
      case "dvec4":
        return { kind: "vector", element: "f64", size: 4 };
      case "quat":
        return { kind: "quaternion" };
      case "mat2":
        return { kind: "matrix", element: "f32", rows: 2, columns: 2 };
      case "mat3":
        return { kind: "matrix", element: "f32", rows: 3, columns: 3 };
      case "mat4":
        return { kind: "matrix", element: "f32", rows: 4, columns: 4 };
      case "dmat2":
        return { kind: "matrix", element: "f64", rows: 2, columns: 2 };
      case "dmat3":
        return { kind: "matrix", element: "f64", rows: 3, columns: 3 };
      case "dmat4":
        return { kind: "matrix", element: "f64", rows: 4, columns: 4 };
      case "imat2":
        return { kind: "matrix", element: "i32", rows: 2, columns: 2 };
      case "imat3":
        return { kind: "matrix", element: "i32", rows: 3, columns: 3 };
      case "imat4":
        return { kind: "matrix", element: "i32", rows: 4, columns: 4 };
      case "umat2":
        return { kind: "matrix", element: "u32", rows: 2, columns: 2 };
      case "umat3":
        return { kind: "matrix", element: "u32", rows: 3, columns: 3 };
      case "umat4":
        return { kind: "matrix", element: "u32", rows: 4, columns: 4 };
      case "mat2x2":
        return { kind: "matrix", element: "f32", rows: 2, columns: 2 };
      case "mat2x3":
        return { kind: "matrix", element: "f32", rows: 3, columns: 2 };
      case "mat2x4":
        return { kind: "matrix", element: "f32", rows: 4, columns: 2 };
      case "mat3x2":
        return { kind: "matrix", element: "f32", rows: 2, columns: 3 };
      case "mat3x3":
        return { kind: "matrix", element: "f32", rows: 3, columns: 3 };
      case "mat3x4":
        return { kind: "matrix", element: "f32", rows: 4, columns: 3 };
      case "mat4x2":
        return { kind: "matrix", element: "f32", rows: 2, columns: 4 };
      case "mat4x3":
        return { kind: "matrix", element: "f32", rows: 3, columns: 4 };
      case "mat4x4":
        return { kind: "matrix", element: "f32", rows: 4, columns: 4 };
      case "sampler2D":
        return { kind: "sampler", name: "sampler2D" };
      case "sampler3D":
        return { kind: "sampler", name: "sampler3D" };
      case "samplerCube":
        return { kind: "sampler", name: "samplerCube" };
      case "sampler2DArray":
        return { kind: "sampler", name: "sampler2DArray" };
      case "samplerCubeArray":
        return { kind: "sampler", name: "samplerCubeArray" };
      case "sampler2DShadow":
        return { kind: "sampler", name: "sampler2DShadow" };
      case "samplerCubeShadow":
        return { kind: "sampler", name: "samplerCubeShadow" };
      case "samplerBuffer":
        return { kind: "sampler", name: "samplerBuffer" };
      default:
        return { kind: "struct", name: typeName };
    }
  }

  private match(...kinds: TokenKind[]): boolean {
    for (const kind of kinds) {
      if (this.check(kind)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private consume(kind: TokenKind, message: string): Token {
    if (this.check(kind)) return this.advance();
    throw new ParseError(this.peek(), message);
  }

  private check(kind: TokenKind): boolean {
    if (this.isAtEnd()) return false;
    const token = this.tokens[this.current];
    if (!token) return false;
    return token.kind === kind;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    const token = this.tokens[this.current - 1];
    if (!token) throw new Error("Unexpected end of tokens");
    return token;
  }

  private isAtEnd(): boolean {
    return this.current >= this.tokens.length || this.tokens[this.current]!.kind === "EOF";
  }

  private previous(): Token {
    const index = this.current - 1;
    if (index < 0) throw new Error("No previous token");
    return this.tokens[index]!;
  }

  private peek(): Token {
    if (this.current >= this.tokens.length) throw new Error("No next token");
    const token = this.tokens[this.current]!;
    return token;
  }

  private peekNextKind(): TokenKind | null {
    if (this.current + 1 >= this.tokens.length) return null;
    return this.tokens[this.current + 1]!.kind;
  }

  private peekNextNextKind(): TokenKind | null {
    if (this.current + 2 >= this.tokens.length) return null;
    return this.tokens[this.current + 2]!.kind;
  }

  private spanOf(token: Token): Span {
    return { line: token.line, column: token.column };
  }

  private optionalSemicolon(): void {
    if (this.match("Semicolon")) {
      // consumed
    }
  }

  private isSwizzle(name: string): boolean {
    if (name.length < 1 || name.length > 4) return false;
    const swizzleChars = "xyzwrgba";
    for (const c of name) {
      if (!swizzleChars.includes(c)) return false;
    }
    return true;
  }
}

export function parse(tokens: Token[]): Program {
  return new Parser(tokens).parse();
}
