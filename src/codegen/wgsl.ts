import { Program } from "../types";

export function generateWGSL(_program: Program): string {
  // WGSL backend deferred to v2 — reuses the same IR/AST
  throw new Error("WGSL backend not yet implemented");
}
