import { SourceModule, SourceResolver } from "../modules/resolver";

/**
 * Browser source resolver. Resolves `.gl` import specifiers relative to the
 * importing module's canonical URL using `fetch`.
 *
 * All network I/O is confined to this adapter; the compiler core never
 * accesses `fetch`, `window`, or `navigator`.
 */
export class FetchSourceResolver implements SourceResolver {
  constructor(
    /** Base URL used to resolve relative import specifiers. */
    public readonly baseUrl: string,
    /** Optional fetch implementation (defaults to global fetch). */
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async resolve(specifier: string, importer: SourceModule): Promise<SourceModule> {
    const importerUrl = new URL(importer.id, this.baseUrl);
    const resolvedUrl = new URL(specifier, importerUrl.href);

    let response: Response;
    try {
      response = await this.fetchFn(resolvedUrl.href);
    } catch (err) {
      throw new Error(
        `Failed to fetch imported module "${specifier}" from ${resolvedUrl.href}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch imported module "${specifier}": HTTP ${response.status} ${response.statusText}`,
      );
    }

    const source = await response.text();

    return {
      id: resolvedUrl.href,
      displayName: specifier,
      source,
    };
  }
}
