export interface SourceModule {
  id: string;
  displayName: string;
  source: string;
}

export interface SourceResolver {
  resolve(specifier: string, importer: SourceModule): Promise<SourceModule>;
}

export class MemorySourceResolver implements SourceResolver {
  private modules = new Map<string, SourceModule>();

  set(id: string, source: string, displayName?: string): void {
    this.modules.set(id, {
      id,
      displayName: displayName ?? id,
      source,
    });
  }

  get(id: string): SourceModule | undefined {
    return this.modules.get(id);
  }

  async resolve(specifier: string, importer: SourceModule): Promise<SourceModule> {
    let resolvedId = specifier;
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const baseSegments = importer.id.split("/");
      baseSegments.pop();
      const specSegments = specifier.split("/");
      for (const seg of specSegments) {
        if (seg === "" || seg === ".") continue;
        if (seg === "..") {
          baseSegments.pop();
        } else {
          baseSegments.push(seg);
        }
      }
      resolvedId = baseSegments.join("/");
    }
    const module = this.modules.get(resolvedId);
    if (!module) {
      throw new Error(
        `Module not found in memory resolver: ${specifier} (resolved '${resolvedId}', imported from ${importer.displayName})`,
      );
    }
    return module;
  }

  ids(): string[] {
    return Array.from(this.modules.keys());
  }
}
