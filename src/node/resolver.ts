import { readFile, realpath } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { SourceModule, SourceResolver } from "../modules/resolver";

/**
 * Node.js filesystem source resolver. Resolves `.gl` import specifiers
 * relative to the importing module's directory on disk.
 *
 * All file I/O is confined to this adapter; the compiler core never imports
 * `fs` or `path`.
 */
export class NodeFileSourceResolver implements SourceResolver {
  constructor(
    /** Root directory used to validate that resolved paths stay within bounds. */
    public readonly rootDir: string,
  ) {}

  async resolve(specifier: string, importer: SourceModule): Promise<SourceModule> {
    const importerDir = dirname(importer.id);
    const resolvedPath = resolve(importerDir, specifier);
    const canonicalRoot = await realpath(resolve(this.rootDir)).catch(() => resolve(this.rootDir));

    // Resolve the target path (must exist) to its canonical form to defeat
    // symlink-based escapes.
    let canonicalTarget: string;
    try {
      canonicalTarget = await realpath(resolvedPath);
    } catch {
      // File may not exist yet; fall back to resolved path for error reporting.
      canonicalTarget = resolvedPath;
    }

    const rel = relative(canonicalRoot, canonicalTarget);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(
        `Import "${specifier}" resolves outside configured root ${this.rootDir}`,
      );
    }

    let source: string;
    try {
      source = await readFile(resolvedPath, "utf-8");
    } catch (err) {
      throw new Error(
        `Failed to read imported module "${specifier}" from ${resolvedPath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return {
      id: resolvedPath,
      displayName: specifier,
      source,
    };
  }
}