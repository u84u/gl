/**
 * Generic declaration registry. Replaces the previous pattern of ten
 * parallel Map variables with a single generic store keyed by declaration
 * kind and name. Adding a new declaration kind requires no changes here.
 */
export class DeclarationRegistry {
  private maps = new Map<string, Map<string, unknown>>();

  private mapFor(kind: string): Map<string, unknown> {
    let m = this.maps.get(kind);
    if (!m) {
      m = new Map();
      this.maps.set(kind, m);
    }
    return m;
  }

  /** Returns true if a declaration of the given kind and key exists. */
  has(kind: string, key: string): boolean {
    return this.mapFor(kind).has(key);
  }

  /** Stores a declaration, returning true if it was newly added. */
  set<T extends { kind: string }>(decl: T, key: string): boolean {
    const m = this.mapFor(decl.kind);
    if (m.has(key)) return false;
    m.set(key, decl);
    return true;
  }

  /** Retrieves a declaration by kind and key. */
  get<T extends { kind: string }>(kind: string, key: string): T | undefined {
    return this.mapFor(kind).get(key) as T | undefined;
  }

  /** Returns all declarations of a given kind. */
  getAll(kind: string): unknown[] {
    const m = this.mapFor(kind);
    return Array.from(m.values());
  }
}
