import { defineConfig } from "vite";

// Served from https://dkirkby.github.io/ai4sci-map/ (a GitHub Pages project
// page), so production builds need that path prefix. `vite preview` serves the
// already-built dist/ output (which has the prefix baked into index.html), so it
// needs the prefix too -- only the `vite dev` server should stay at "/".
export default defineConfig(({ command, isPreview }) => ({
  root: ".",
  publicDir: "public",
  base: command === "build" || isPreview ? "/ai4sci-map/" : "/",
}));
