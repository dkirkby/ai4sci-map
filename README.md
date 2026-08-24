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
  arcs; click-to-recenter; URL-based deep linking (`?concept=<id>`), defaulting to
  "Artificial intelligence" when none is given.
- A data build pipeline that validates the hand-authored YAML concept database
  (`data/`) and compiles it into the JSON the app loads.
- Automated deployment to GitHub Pages on every push to `main` (see
  [Deployment](#deployment)).
- A search box for jumping straight to any concept by label or alias (e.g. "CNN"),
  with keyboard and mouse-driven autocomplete.
- A "Copy link" button that copies a URL for the current view to the clipboard.

Not yet implemented:

- Automated tests.
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

### Adding concepts

The concept database in `data/` is hand-edited YAML — see
[DATA_README.md](DATA_README.md) for the format and
[AUDIENCE_LEVEL.md](AUDIENCE_LEVEL.md) for how `audience_level` is assigned.

If you're using [Claude Code](https://claude.com/claude-code), the
`add-concepts` skill (`.claude/skills/add-concepts/`) automates adding a batch
of candidate concepts: it checks each one for duplicates or heavy overlap with
the existing graph, flags anything out of scope or too unfamiliar to source
confidently and asks whether to keep or drop it, drafts a definition and
relationships for the rest, and validates the result with
`npm run build:data`. Invoke it with `/add-concepts <comma-separated list>`,
or just paste the list in your message and run `/add-concepts` with no
arguments — it asks for the list if one isn't already in the conversation.

## Building for production

```bash
npm run build     # regenerates public/graph.json, then builds to dist/
npm run preview   # serves the dist/ build locally, for a final check
```

`dist/` is a fully static site (HTML/CSS/JS + `graph.json`) — no server-side code
is involved.

## Deployment

Live at **<https://dkirkby.github.io/ai4sci-map/>**.

`.github/workflows/deploy.yml` builds the site and deploys it to GitHub Pages
(via `actions/upload-pages-artifact` + `actions/deploy-pages`) automatically on
every push to `main`, or on demand from the Actions tab (`workflow_dispatch`). The
repo's Pages source is set to "GitHub Actions" (not a branch), so nothing needs to
be pushed to a `gh-pages` branch.

This is a GitHub Pages *project* page (`https://<user>.github.io/<repo>/`, not a
domain root), so `vite.config.ts` sets `base: "/ai4sci-map/"` for both the
production build and `vite preview` — but not for `vite dev`, which stays at `/`
for a normal localhost experience. `src/main.ts` fetches data via
`import.meta.env.BASE_URL`, so it automatically respects whichever base is active.
If this repo is ever renamed, or the site moved to a different path, update `base`
in `vite.config.ts` to match.
