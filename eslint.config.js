import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Renderer subpaths: each owns its packages; nothing else imports them. */
const renderers = {
  r3f: ["three", "three/*", "@react-three/*"],
  dom: ["react-dom", "react-dom/*"],
  "its-fine": ["its-fine"],
};

/** Bans every renderer's packages and directory except `own`. */
function restrict(own) {
  return {
    "@typescript-eslint/no-restricted-imports": [
      "error",
      {
        patterns: Object.entries(renderers)
          .filter(([dir]) => dir !== own)
          .map(([dir, packages]) => ({
            group: [...packages, `**/${dir}/*`],
            message: `${dir} imports belong under ./${dir}.`,
          })),
      },
    ],
  };
}

export default defineConfig([
  globalIgnores(["dist", "dist-*", "pack", "examples/routeTree.gen.ts"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      eslintPluginPrettier,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["**/*.{js,ts,tsx}"],
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
    },
  },
  {
    // Route files export `Route` beside local components; TanStack
    // Router's plugin owns their hot reload.
    files: ["examples/routes/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      ...Object.keys(renderers).map((dir) => `src/${dir}/**`),
      "**/*.test.{ts,tsx}",
    ],
    rules: restrict(undefined),
  },
  ...Object.keys(renderers).map((dir) => ({
    files: [`src/${dir}/**/*.{ts,tsx}`],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: restrict(dir),
  })),
]);
