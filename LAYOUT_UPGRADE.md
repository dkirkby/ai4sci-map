# Layout upgrade plan

This is a plan, not an implementation. It records the problem, the proposed
design, and the open decisions for reworking how satellites are placed around
the center card. See [DESIGN_SPEC.md](DESIGN_SPEC.md) for the product
requirements this has to keep satisfying, and `src/layout.ts` / `src/render.ts`
for the code being replaced.

## Problem

**1. Fixed ellipse wastes space.** `render()` (`src/render.ts:249-352`) computes
one `radiusX`/`radiusY` pair per redraw from the container's current
width/height, then `computeRadialLayout()` (`src/layout.ts`) assigns every
satellite an angle and `pointForAngle()` places it on that single ellipse.
Every satellite is equidistant from the center along its own ray, so the
layout can't give a satellite in a sparse sector more room, or pull a
satellite in a crowded sector outward to avoid collision — the only lever is
angle. Label width is capped by dividing the *leftover* horizontal margin at
the ellipse's east/west extreme by a constant char-width estimate
(`maxLabelChars`, `render.ts:328-331`), and line count is hard-capped at 2
(`MAX_LABEL_LINES`, `render.ts:35`) regardless of how much vertical room is
actually free between rings — so long labels get truncated with an ellipsis
even when there's visibly empty space around them.

**2. The ellipse's aspect ratio is frozen at render time.** `radiusX`/`radiusY`
are derived once per call to `render()`/`renderRoute()`, and nothing in
`src/main.ts` calls `renderRoute()` in response to the viewport changing size.
There is currently no `resize` listener or `ResizeObserver` anywhere in `src/`
(confirmed by grep). Dragging a window edge (or rotating a device, or a mobile
browser's chrome showing/hiding) changes `container.getBoundingClientRect()`
but the SVG isn't redrawn, so the ellipse's aspect ratio silently goes stale
until the next navigation.

## Goals

1. Satellites are no longer constrained to a single ellipse. Radial distance
   from the center can vary per satellite (e.g. alternating near/far within a
   sector) so the algorithm can trade unused space in one direction for more
   room in another.
2. The viewport is watched for size changes and the current view is
   relaid-out (not just re-scaled) when it changes, debounced so a drag-resize
   doesn't thrash re-renders every frame.
3. Satellite titles display more completely: more than 2 wrapped lines where
   there's room, and/or substituting a concept's acronym for its full label
   where that's a better fit.

## Non-goals / constraints to preserve

- **Grouping and ordering stay.** DESIGN_SPEC.md requires satellites sharing a
  relationship type to be placed together, and the existing crossing-reduction
  heuristics (group ordering by cross-group weight, within-group barycenter
  passes) already do useful work that's independent of *how far out* a
  satellite sits. Steps 1-2 of `computeRadialLayout()` (grouping,
  `layout.ts:44-62`; group ordering, `layout.ts:64-105`) are kept as-is; only
  the "assign a fixed point on a fixed ellipse" part (steps 3-4,
  `layout.ts:107-177`) is replaced.
- **`render()` stays synchronous.** No visible "settling" animation is in
  scope — the layout should resolve to final positions before the SVG is
  drawn, same as today, not animate into place. (A settle transition is a
  plausible future polish item, not part of this plan.)
- **No new dependency.** `d3` (already a dependency, `package.json`) bundles
  `d3-force` (`forceSimulation`, `forceCollide`, `forceManyBody`, etc.) — no
  package addition needed for a force-directed approach.
- **Determinism.** The same concept + level + viewport size should always
  produce the same layout. `d3-force`'s default jitter uses an internal RNG;
  if that turns out to introduce visible run-to-run instability, seed
  positions explicitly before ticking (`simulation.randomSource(...)`) rather
  than relying on it.

## Proposed design

### A. Resize handling (independent of the layout algorithm change)

Add a `ResizeObserver` on the `#app` container in `src/main.ts`, debounced
(~150ms trailing), that calls `renderRoute(false)` — the same re-render path
`popstate` already uses, which doesn't push a history entry. `ResizeObserver`
on the container (rather than a `window` `resize` listener) also catches
container-size changes that aren't a window resize (mobile URL-bar
show/hide, orientation change, splitview resize on tablets/desktops).

Consequences to call out, not hide:
- A full re-render clears and rebuilds the SVG (already true for every
  navigation, per `CLAUDE.md`), which resets the D3 zoom/pan
  (`zoomBehavior`, `render.ts:405-413`) to identity. A mid-gesture pinch-zoom
  will visibly snap back on resize. Acceptable given it already happens on
  every click-through today; flagged as an open question below in case it's
  worth preserving the transform across a resize-triggered redraw
  specifically.
- Skip re-render if the observed size hasn't materially changed (e.g. a few
  px of scrollbar noise) to avoid redundant work.
- This part ships independently of the force-layout work — it's a small,
  low-risk fix and valuable on its own even against the current ellipse
  layout.

### B. Force-directed placement, replacing the fixed ellipse

Keep the existing angle assignment from steps 1-2/4 of
`computeRadialLayout()` as the *seed* angle for each satellite (it already
encodes "same relationship type stays together" and "interconnected groups
stay adjacent") — but stop treating it as the satellite's final angle *and*
radius on a shared curve. Instead:

1. For each satellite, compute its label footprint (line count × width, see
   part D below) before layout runs, since that determines how much
   clearance the node needs from its neighbors.
2. Seed each satellite's initial `(x, y)` from its group/barycenter angle at
   a nominal starting radius (e.g. today's `minRadiusX`/`minRadiusY` floor —
   just outside the center card).
3. Run a `d3.forceSimulation()` over the satellite nodes with:
   - `forceCollide`, radius derived per-node from its actual label footprint
     (plus the existing `SATELLITE_HIT_RADIUS` padding) — this is what lets
     radial distance vary: a satellite whose angular neighbors both have long
     labels gets pushed outward (or its neighbor does) to avoid overlap,
     rather than every satellite being squeezed onto the same ring regardless
     of label length.
   - An angle-preserving restoring force: pulls each node back toward the ray
     from the center at its seeded angle (project the node's current offset
     from center onto that ray's perpendicular and pull the perpendicular
     component toward zero). This keeps the grouping/ordering guarantee from
     part 1 intact — nodes may drift in *radius* under collision pressure,
     but not swap angular position with a different group's satellites.
   - A radial band constraint keeping each node's distance from center within
     `[minRadius, maxRadius]` — `minRadius` unchanged from today's card-clearance
     floor, `maxRadius` from the available safe-area extent — so nodes can't
     collide their way outside the safe area or back into the card.
   - Run a fixed number of ticks synchronously (`simulation.stop()` after N
     manual `simulation.tick()` calls) rather than the default async timer
     loop, so `render()` stays synchronous as today. N ≤ 18 satellites
     (per-concept max degree, per DESIGN_SPEC.md) makes this cheap regardless
     of tick count.
4. Each `SatellitePlacement` carries a resolved `{x, y}` (or radius + angle,
   equivalent) instead of implying a shared ellipse via a single global
   `angle`.

Downstream geometry in `render.ts` that currently assumes one shared
`radiusX`/`radiusY` needs to change to per-node radius:
- `pointForAngle()` (`render.ts:354-357`) goes away in favor of reading each
  placement's resolved point directly.
- The corner-clearance correction (`cornerRatio`, `render.ts:348-352`) — which
  exists to stop a *shared* ellipse from cutting back inside the card's
  padded corner — is superseded by the per-node radial-band floor in the
  force simulation (step 3 above); no global correction needed once every
  node individually respects `minRadius`.
- The satellite-satellite arc control point (`render.ts:415-441`) currently
  bulges outward from the shared ellipse by a factor of the pair's angular
  delta. Generalize it to bulge outward relative to the *larger* of the two
  endpoints' own radii, so arcs still route outside the (now irregular) ring
  rather than through the middle of it.
- The outer safe-area margins used to size `maxLabelChars` and the vertical
  label-block reservation (`render.ts:327-339`) were derived from the shared
  ellipse's fixed extremes; once radius varies per node, the per-node label
  budget should instead come from that node's actual clearance to the safe
  area boundary and to its angular neighbors (see part D).

### C. Label display: more lines, acronym substitution

- Raise `MAX_LABEL_LINES` (`render.ts:35`) from 2 to a larger cap (3-4 — see
  open question below), since the force layout's per-node collide radius
  already accounts for the taller label block when reserving space, unlike
  today's fixed-ring layout where every satellite has to fit the same
  vertical allowance regardless of need.
- Prefer a concept's acronym (`Concept.acronyms`, `src/types.ts:46`) as the
  visible satellite label when: the concept has at least one acronym, *and*
  its full label would need wrapping (i.e. doesn't already fit on one line
  within the per-node width budget). Short labels that already fit on one
  line keep displaying in full — an acronym is a space-saving fallback, not a
  universal replacement, matching how acronyms already work as a secondary,
  optional identifier elsewhere (search matching, the center card's acronym
  row, `render.ts:545-556`).
  - When an acronym is substituted, extend the existing tooltip pattern
    (`titleText`, `render.ts:526`) to always include the full label (today it
    only adds the description on truncation) so the full name is still one
    hover/tap away.
  - `resolveConceptId()` (`src/graph.ts:74-84`) already resolves acronyms to
    concept ids, so clicking an acronym-labeled satellite needs no change.

### D. Per-node label footprint (shared by collision sizing and wrapping)

Extract a function — candidate location `src/render.ts` near `wrapLabel()` —
that, given a concept and a width budget, returns the label text to display
(full label, wrapped full label, or acronym per part C's policy) plus its
resulting line count and rendered box size. This same footprint feeds both:
- the wrap/truncate decision (as `wrapLabel()` does today), and
- the `forceCollide` radius for that node (part B step 1).

The width budget itself no longer comes from a single global
`maxLabelChars` derived from the shared ellipse's east/west slack
(`render.ts:328-331`); use a simpler viewport-derived constant budget (e.g. a
fraction of view width divided by a target column count) as the *starting*
budget fed into the force simulation, independent of eventual node position.
Reflowing labels a second time after final positions settle (to reclaim any
extra slack a node ends up with) is an optional refinement, not required for
correctness — flagged in "Future work" below rather than committed to here.

## Migration phases

Suggested order, each independently shippable and testable:

1. **Resize handling only** (part A). No layout algorithm change; fixes the
   staleness bug against the *current* ellipse layout. Low risk.
2. **Extract label-footprint sizing** (part D) as a standalone function,
   still used only by the existing `wrapLabel()` call site — no behavior
   change yet, just a refactor to prepare a function the force layout will
   also need.
3. **Force-directed placement** (part B): replace `layout.ts` steps 3-4 and
   the corresponding `render.ts` geometry (spokes, arcs, hit-boxes, safe-area
   sizing). This is the largest and riskiest phase — needs visual QA across
   viewport shapes and satellite counts (see Testing below) before merging.
4. **Label display improvements** (part C): raise the line cap, add acronym
   substitution + tooltip fallback. Layer this on top of phase 3 since it
   changes the per-node footprint that phase 3's collide sizing depends on.
5. **Tuning pass**: force strengths, tick count, min/max radius band, and the
   line-cap/acronym thresholds, based on visual QA findings.

## Testing / validation

This repo has no test suite (`CLAUDE.md`); validation is manual, via
`npm run dev`:

- Resize: drag the window edge slowly and quickly; confirm the layout
  relaxes to the new aspect ratio without excessive redraw lag, and that
  rapid resize doesn't leave a stale or partially-updated SVG.
- High-degree concept (max degree 18, per DESIGN_SPEC.md — find current
  max via the built `public/graph.json`) at each viewport shape: portrait
  phone, compact landscape phone (`LANDSCAPE_COMPACT_MAX_HEIGHT`,
  `render.ts:84`), standard desktop, ultra-wide.
- Low-degree concept (1-2 satellites): force layout shouldn't collapse
  them awkwardly close to the card just because there's no collision
  pressure — likely needs a minimum-radius default independent of collision.
- A concept whose satellites include both concepts with and without
  acronyms, to check the mixed-label-style look reads cleanly rather than
  inconsistently.
- Confirm satellite-satellite arcs still route visibly outside the
  (now irregular) ring rather than crossing through satellite nodes closer
  to the center.
- Re-check the existing pinch-zoom/pan gesture still works post-change
  (unrelated to this plan but shares the `content-layer` transform code
  path touched by part B).

## Open questions

- **Line cap value**: 3 lines, or 4? Should it be a fixed constant like today
  (simplicity) or itself derived from each node's settled vertical slack
  (better space use, more complexity — ties into the optional second-pass
  reflow noted in part D)?
- **Acronym policy**: substitute whenever an acronym exists and the full
  label would wrap (this plan's default), or only when *multiple* wrapped
  lines would be needed, or make it a user-visible toggle? Also: which
  acronym when a concept has more than one (`acronyms` is an array,
  `types.ts:46`) — first-listed, as the center card already does
  (`render.ts:548`)?
- **Resize + zoom/pan**: acceptable for a resize-triggered redraw to reset
  any in-progress pinch-zoom/pan (matching today's behavior on navigation),
  or worth the extra complexity of re-applying the previous transform after
  a resize redraw specifically?
- **Settle animation**: confirmed out of scope for this pass (see Non-goals),
  but worth revisiting once the static layout is in place and validated.

## Future work (explicitly deferred)

- Second-pass label reflow using each node's actual settled clearance,
  rather than a fixed starting width budget.
- Animated transition between layouts on resize/navigation instead of an
  instant snap.
