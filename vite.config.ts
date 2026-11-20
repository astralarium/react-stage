/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import dts from "vite-plugin-dts";
import tsConfigPaths from "vite-tsconfig-paths";

const __dirname = dirname(fileURLToPath(import.meta.url));

const env = loadEnv("development", __dirname, "");

const readFile = (path: string | undefined) =>
  path ? readFileSync(path, "utf-8") : undefined;

const sslKey = readFile(env.SSL_KEY);
const sslCert = readFile(env.SSL_CERT);
const localDomain = env.LOCAL_DOMAIN;

/** Package entry points: `.` and each renderer subpath. */
const entries = {
  index: "src/index.ts",
  "dom/index": "src/dom/index.ts",
  "its-fine/index": "src/its-fine/index.ts",
  "r3f/index": "src/r3f/index.ts",
};

/** Peer packages and their subpaths stay external. */
const PEERS = /^(react|react-dom|three|@react-three\/fiber|its-fine)(\/|$)/;

// Pages config - for dev server and building the examples/docs site
export const pagesConfig = defineConfig({
  base: "/react-stage",
  publicDir: "dist-typedoc",
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.pages.json"] }),
    tanstackStart({
      srcDirectory: "examples",
      spa: { enabled: true },
      prerender: {
        enabled: true,
        autoStaticPathsDiscovery: true,
        filter: ({ path }) => !["/docs", "/react-stage/docs/"].includes(path),
      },
    }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  server: {
    https:
      sslKey && sslCert
        ? {
            key: sslKey,
            cert: sslCert,
          }
        : undefined,
    allowedHosts: localDomain ? [localDomain] : [],
    fs: {
      allow: [".", "dist-typedoc/docs"],
    },
  },
  build: {
    outDir: "dist-pages",
  },
});

// Pages preview config - for previewing the built examples/docs site
export const pagesPreviewConfig = defineConfig({
  base: "/react-stage",
  server: {
    https:
      sslKey && sslCert
        ? {
            key: sslKey,
            cert: sslCert,
          }
        : undefined,
    allowedHosts: localDomain ? [localDomain] : [],
  },
  preview: {
    allowedHosts: localDomain ? [localDomain] : [],
  },
  build: {
    outDir: "dist-pages/client",
  },
});

// Library config (default) - for building the npm package
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    dts({
      tsconfigPath: "./tsconfig.app.json",
      entryRoot: "src",
      exclude: ["**/*.test.*"],
    }),
  ],
  build: {
    outDir: "dist",
    copyPublicDir: false,
    // Consumers minify; readable names keep React DevTools and stacks legible.
    minify: false,
    lib: {
      entry: Object.fromEntries(
        Object.entries(entries).map(([name, path]) => [
          name,
          resolve(__dirname, path),
        ]),
      ),
      formats: ["es"],
    },
    rollupOptions: {
      external: (id) => PEERS.test(id),
      output: {
        preserveModules: true,
        preserveModulesRoot: "src",
        entryFileNames: "[name].js",
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
