# Design specification

Implement an interactive visualization of a concept map.

See [DATA_README.md](DATA_README.md) for the concept database. The database is
managed via YAML files and built following the steps described there.

This is a web-based tool deployed as a static web site via a service like GitHub
Pages.

Code is written in TypeScript and managed using npm.

## Zoomable concept browser

The current view is always focused on one concept, displayed prominently in the
center of the view, along with its description. The initial concept is set via the
URL query string. If none is provided, pick one at random.

Each concept that is directly connected to the central concept via a relationship
is displayed surrounding the central concept, with satellite concepts sharing the
same relationship placed next to each other. A line is displayed between the
central concept and each satellite concept with a style indicating the type of
relationship.

Relationships between pairs of satellite concepts are indicated with curved arcs
that connect the concepts outside the ring of satellite concepts. These arcs use
the same styling scheme as relationships to the central concept, but are less
visually prominent. The placement of satellite concepts should be optimized to
minimize arc crossings, while keeping satellites sharing the same relationship to
the central concept together.

Clicking on a satellite concept designates it as the new central concept and
triggers a redraw.

## Implementation notes

The sections above are the requirements; this section records the choices made
to satisfy them in the current proof-of-concept implementation, so future changes
can tell intentional decisions from things still open for revisiting.

**Stack.** Vanilla TypeScript + [D3](https://d3js.org/) (no UI framework), bundled
with [Vite](https://vite.dev/). D3 handles layout math and directly manages the
SVG DOM; there is no virtual-DOM diffing — each redraw clears and rebuilds the SVG
(cheap at this graph's scale, ≤18 satellites per concept).

**Data build pipeline** (`scripts/build-data.ts`, run via `npm run build:data`
before `dev`/`build`): reads `data/manifest.yaml`, validates every fragment against
`data/schema.yaml` (Ajv, JSON Schema draft 2020-12), and performs the graph-level
checks from `DATA_README.md` (id uniqueness, dangling references, duplicate
relationships, `is_a`/`is_subfield_of` cycles) before emitting `public/graph.json`.
This is a Node-side build step, not something the browser does at runtime.

**Direction handling.** The data only ever stores one direction of each inverse
relationship-type pair (e.g. `is_a`, never the inverse `has_subtype`). `src/graph.ts`
resolves, per concept, which relationship type and arrow direction it experiences
depending on whether it is the stored `source` or `target`.

**Satellite layout** (`src/layout.ts`): satellites are grouped by their
center-relative relationship type; groups are ordered via a greedy max-weight
chaining heuristic (weighted by satellite-satellite relationship counts) to keep
interconnected groups adjacent; within a group, satellites are ordered via a
bounded (2-pass) barycenter heuristic. This is a cheap approximation, not an
optimal crossing minimizer — adequate given the dataset's max degree of 18.

**Rendering** (`src/render.ts`, `src/style.ts`): the 10 relationship-type inverse
pairs are collapsed to 10 color "families" (`d3.schemeTableau10`); direction is
shown via arrowheads. The SVG viewBox is sized per redraw based on the longest
label among the concepts on screen, so long labels (some concept labels exceed 40
characters) never clip against the viewBox edge.

**Current status.** Local development and production builds work
(`npm run dev`, `npm run build` + `npm run preview`); see [README.md](README.md)
for setup. Not yet implemented: GitHub Pages CI/deployment, automated tests,
search/filter UI, and any visual styling keyed on concept `kind`.
