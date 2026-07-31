# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install         # install dependencies
npm run dev          # regenerate public/graph.json, then start the Vite dev server
npm run build        # regenerate public/graph.json, then produce a production build in dist/
npm run preview      # serve the dist/ build produced by `npm run build`
npm run build:data   # run only the data build/validation pipeline (scripts/build-data.ts)
npm run typecheck    # tsc --noEmit
```

There is no lint config and no test suite in this repo yet. `npm run dev` and
`npm run build` both run `build:data` first (via `predev`/`prebuild`); it does not
need to be run separately in normal workflows.

## Architecture

This app has two halves that only communicate through one generated file,
`public/graph.json`:

1. **`data/`** is the hand-authored source of truth: a concept graph split across
   YAML fragments (concepts, relationships, relationship types), assembled per
   `data/manifest.yaml` and validated against `data/schema.yaml`. See
   `DATA_README.md` for the data model and editing conventions, and
   `DESIGN_SPEC.md` for the product requirements and implementation notes.
2. **`scripts/build-data.ts`** (Node, run via `tsx`) reads the manifest, validates
   every fragment with Ajv (JSON Schema draft 2020-12), runs graph-level checks not
   expressible in JSON Schema (id uniqueness, dangling references, duplicate
   relationships, `is_a`/`is_subfield_of` cycle detection — accumulating *all*
   errors before reporting, rather than failing on the first), and writes
   `public/graph.json`. This never runs in the browser; the frontend only ever
   fetches the generated JSON. Re-run `npm run build:data` after editing any file
   under `data/` to see the change reflected in the app.

The frontend (`src/`) renders one concept at a time as a radial "hub and
satellites" diagram:

- **`src/types.ts`** — types mirroring `data/schema.yaml`.
- **`src/graph.ts`** — builds `GraphIndex` from the fetched `GraphData`: an
  adjacency map plus **direction/inverse resolution**. This is the least obvious
  part of the codebase: the data only ever stores one direction of each
  relationship-type pair (e.g. `is_a` is stored, its inverse `has_subtype` never
  is). When a concept is the stored `target` of a relationship, `graph.ts` resolves
  the type it *experiences* to the declared inverse (via `relationship-types.yaml`'s
  `inverse` field) and marks the edge direction `"backward"`; the stored `source`
  always experiences the type as-stored, direction `"forward"`. Rendering and
  layout code work entirely in terms of this per-concept experienced view, not the
  raw stored `source`/`type`/`target` triple.
- **`src/layout.ts`** — given a center concept's edges, groups satellites by their
  experienced relationship type, orders the groups with a greedy max-weight
  chaining heuristic (to keep satellite-groups that are cross-linked to each other
  adjacent on the ring), then orders satellites within a group via a bounded
  (2-pass) barycenter heuristic. This is a cheap approximation of crossing
  minimization, not an optimal solver — sized for the dataset's actual max degree
  (18), not for arbitrarily dense graphs.
- **`src/style.ts`** — collapses the 20 declared relationship types (10 inverse
  pairs) down to 10 color "families" via `d3.schemeTableau10`, so a relationship
  and its inverse always render in the same color.
- **`src/render.ts`** — D3/SVG rendering of the center card, spokes, satellite
  nodes, satellite-satellite arcs, and legend. The SVG `viewBox` is sized per
  redraw from the longest label among the concepts currently on screen (concept
  labels vary widely in length), not a fixed constant — this avoids clipping
  without needing per-label text measurement.
- **`src/search.ts`** — a search-as-you-type box matching every concept's label
  and aliases (e.g. "CNN" → "Convolutional neural network"), ranked prefix-first.
  Filters the already-fetched concept list client-side; at 182 concepts this needs
  no separate build-time search index. Built once against `#search-root`, a DOM
  node in `index.html` that's a *sibling* of `#app`, not a child of it — `#app`
  gets fully wiped on every graph redraw (see below), which would destroy the
  search box if it lived there.
- **`src/main.ts`** — entry point: fetches `graph.json`, resolves the initial
  concept from `?concept=<id>` (random fallback, written back via
  `history.replaceState` so the random pick is immediately bookmarkable), and
  defines `navigateTo(conceptId)` (pushes URL state, then redraws) as the single
  shared path used by both satellite clicks and search selection, plus a
  `popstate` listener for back/forward.

Every redraw fully clears and rebuilds the SVG (`innerHTML = ""` /
`selectAll('*').remove()`) rather than using D3's enter/update/exit pattern —
intentional at this scale, not an oversight.

## Deployment

`.github/workflows/deploy.yml` builds and deploys `main` to GitHub Pages
(`https://dkirkby.github.io/ai4sci-map/`) via GitHub's Actions-based Pages flow
(no `gh-pages` branch). Because it's a project page, `vite.config.ts` sets
`base: "/ai4sci-map/"` for the production build **and** `vite preview` (both serve
the built `dist/` output, which has that prefix baked into `index.html`) — but not
for `vite dev`. Distinguish these with the config function's `command`/`isPreview`
flags, not `command` alone: `vite preview` reports `command: "serve"`, the same as
`vite dev`, so `isPreview` is the only signal that tells them apart.
