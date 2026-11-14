import { readFileSync } from "fs";
import { resolve, dirname } from "path";
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
    const canonicalRoot = resolve(this.rootDir);

    // Prevent path traversal outside the configured root.
    const relative = resolvedPath.startsWith(canonicalRoot + "/")
      ? resolvedPath.slice(canonicalRoot.length + 1)
      : resolvedPath === canonicalRoot
        ? ""
        : null;

    if (relative === null) {
      throw new Error(
        `Import "${specifier}" resolves outside configured root ${this.rootDir}`,
      );
    }

    let source: string;
    try {
      source = readFileSync(resolvedPath, "utf-8");
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
