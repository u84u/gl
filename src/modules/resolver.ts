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
    const module = this.modules.get(specifier);
    if (!module) {
      throw new Error(
        `Module not found in memory resolver: ${specifier} (imported from ${importer.displayName})`,
      );
    }
    return module;
  }

  ids(): string[] {
    return Array.from(this.modules.keys());
  }
}
