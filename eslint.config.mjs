import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Separate standalone CommonJS Node project (its own package.json/deps, runs on the
    // admin's own PC, not part of this app's build) — not this config's concern.
    "pc-photo-server/**",
  ]),
]);

export default eslintConfig;
