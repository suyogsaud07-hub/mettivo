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
    // Generated artefacts. These are gitignored and are NOT source: linting a
    // Playwright trace bundle reports hundreds of errors from minified vendored
    // JS and drowns the real result.
    "test-results/**",
    "playwright-report/**",
    ".playwright-browsers/**",
    ".vitest/**",
    ".npm-cache/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
