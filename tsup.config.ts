import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/node/resolver.ts", "src/browser/resolver.ts", "src/cli.ts"],
  format: ["esm"],
  splitting: false,
  clean: true,
});
