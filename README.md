# AI/ML Concept Browser

An interactive, zoomable visualization of a graph of AI/ML concepts. One concept
is shown at a time, front and center, surrounded by every concept it's directly
related to; clicking a related concept re-centers the view on it, so you can
explore the graph one hop at a time. Lines and arrows are styled and colored by
relationship type (e.g. "is a", "uses", "trained by"), and relationships between
neighboring concepts are drawn as curved arcs around the outside.

The full requirements are in [DESIGN_SPEC.md](DESIGN_SPEC.md); the concept
database format and editing conventions are in [DATA_README.md](DATA_README.md).

## Scope

This is a **proof of concept**. Currently implemented:

- The full zoomable browsing interaction described in `DESIGN_SPEC.md`: a
  central concept with grouped, relationship-styled satellites; satellite-satellite
  arcs; click-to-recenter; URL-based deep linking (`?concept=<id>`), with a random
  concept chosen when none is given.
- A data build pipeline that validates the hand-authored YAML concept database
  (`data/`) and compiles it into the JSON the app loads.

Not yet implemented:

- Automated deployment (see [Deployment](#deployment) below for the manual path).
- Automated tests.
- Search or filter UI for jumping to a concept without knowing its id.
- Any visual styling based on a concept's `kind` (field, task, architecture, ...).

## Requirements

- Node.js `^18.0.0 || ^20.0.0 || >=22.0.0` (per Vite's supported range) and npm.

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

This regenerates `public/graph.json` from `data/` and starts the Vite dev server
(prints a local URL to open, e.g. `http://localhost:5173`). The server hot-reloads
on source changes. If you edit anything under `data/`, re-run the app (or just
`npm run build:data`) to pick up the change — the browser doesn't read the YAML
directly.

To type-check without emitting anything:

```bash
npm run typecheck
```

## Building for production

```bash
npm run build     # regenerates public/graph.json, then builds to dist/
npm run preview   # serves the dist/ build locally, for a final check
```

`dist/` is a fully static site (HTML/CSS/JS + `graph.json`) — no server-side code
is involved.

## Deployment

There's no CI/CD set up yet, so deployment is manual for now. `dist/` (produced by
`npm run build`) can be uploaded to any static file host. For GitHub Pages
specifically:

1. Run `npm run build`.
2. Publish the contents of `dist/` to the branch/path your repo's Pages settings
   serve from (e.g. via `git subtree push`, the `gh-pages` npm package, or a manual
   copy) — or wire up GitHub's "Deploy from a branch"/Actions Pages flow once one
   exists in this repo.

**If deploying to a project page** (`https://<user>.github.io/<repo>/`, as opposed
to a user/org page or custom domain), set `base: "/<repo>/"` in `vite.config.ts`
first — it currently defaults to `/`, which only serves correctly from a domain
root.
