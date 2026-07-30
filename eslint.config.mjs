import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "coverage/**",
    "supabase/functions/**",
    // Local scratch payloads from MCP deploy sessions — not app code.
    ".deploy-payloads/**",
  ]),
]);
