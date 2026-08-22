# Help facility design

This is a plan, not an implementation — matching [LAYOUT_UPGRADE.md](LAYOUT_UPGRADE.md)'s
precedent of a design doc preceding a build. It records every user interaction this
app currently exposes, most of which have no help affordance at all today, and
proposes a help facility covering them: a persistent reference panel plus a
first-visit guided tour. See [DESIGN_SPEC.md](DESIGN_SPEC.md) for the product this
sits on top of and [CLAUDE.md](CLAUDE.md) for the module layout it has to fit into.

## Problem

The app has no help facility. The only in-app affordances are native `title`
tooltips (satellite descriptions, spoke/arc relationship labels, level-tick
descriptions) — discoverable only by hovering, which touch users can't do at all.
Several interactions have no visual affordance suggesting they're interactive:

- The center card's kind badge and acronym chips look like static labels, not
  buttons — clicking either navigates to a different view entirely.
- Dragging the level bar's current tick live-scrubs through levels; this isn't
  suggested by anything short of trying it.
- The diagram supports pinch-zoom/pan, with no on-screen hint that it does.
- Search silently searches beyond what's on screen and dims out-of-level matches
  — the "why is this one grayed out" question has no in-app answer.
- The legend encodes both a color family and an arrow direction per relationship
  type, and (per `CLAUDE.md`'s own callout) a spoke's arrow/label always reads
  source→target regardless of which end is centered — the single most
  non-obvious piece of this app's data model.

## Goals

1. A persistent, always-available reference covering every interaction below,
   plus a short glossary of the data-model concepts needed to *read* the
   diagram (the legend, audience levels, concept kinds), plus an about/credits
   section.
2. A first-visit guided tour that spotlights the real, live controls for the
   highest-value non-obvious interactions — skippable at every step, replayable
   later from the reference panel.
3. Two entry points: a floating corner button, and a `?` keyboard shortcut.
4. Copy adapts to touch vs. pointer input where the interaction itself differs
   (pinch/tap vs. hover/click/drag).
5. Ships as static, hardcoded content in `src/`, the same way `search.ts` and
   `share.ts` already work — no `data/` pipeline involvement.

## Non-goals

- **Not data-driven.** No `data/help.yaml`, no `schema.yaml`/`manifest.yaml`
  changes, no `build-data.ts` changes. Help copy isn't graph data; it doesn't
  need Ajv validation or graph-level checks, and routing it through the build
  pipeline would be heavier machinery than the content warrants.
- **Design only in this pass.** No code changes here — see Migration phases
  below for how this would actually get built.
- **No deep-linkable help/tour state.** Whether the panel or tour is open is
  local UI state, not part of the shareable view identity `share.ts` copies —
  no `?help=1` or `?tour=3` param.
- **Existing native tooltips are untouched.** Satellite/spoke/arc/level-tick
  `title` tooltips stay exactly as they are; the help panel documents that they
  exist rather than replacing them with something else.
- **No localization.** English only, matching the rest of the app.

## Interaction inventory

Every user-facing interaction in the app today, by area — this is the checklist
the help content in the next section has to cover.

**Center card**
- Kind badge (`.center-card-kind`) — click navigates to the kind browser for
  this concept's kind, highlighting it (`render.ts`'s `buildCenterCard`,
  `onSelectKind`).
- Acronym chips (`.acronym-link`) — click navigates to the acronym word cloud,
  highlighting that acronym (`onSelectAcronym`).
- Description text, when visually clamped — click, tap, or Enter/Space (it's
  a focusable element with `role="button"`) opens a full-text popover
  (`showDescriptionPopover`); Escape or clicking the backdrop closes it.

**Diagram / satellites**
- Click/tap a satellite node or its label — re-centers the view on that concept
  (`onSelectConcept`).
- Hover (pointer) or long-press (touch) a satellite — native tooltip with its
  description (or full label + description, when the visible text is an
  acronym substitution or was truncated).
- Hover a spoke or a satellite-satellite arc — native tooltip with the
  relationship's canonical label.
- Spoke/arc color and arrowhead direction encode relationship type and
  direction, per the legend; arcs are visually subordinate to spokes (drawn
  first, thinner).
- Pinch-zoom (touch) / scroll or trackpad pinch (pointer) zooms the diagram;
  drag pans it (`d3.zoom`, scale range 0.25×–4×) — resets on every navigation
  or resize, since the whole SVG is rebuilt then.
- The legend itself is a static reference, not interactive: one entry per
  relationship-type family, combining both directions' labels when both are
  present among the concepts on screen.

**Search**
- Type-ahead box, matching label/alias/acronym across every concept in the
  dataset, not just what's currently on screen.
- Arrow keys move the highlighted suggestion, Enter selects it, Escape closes
  the dropdown.
- A muted/grayed suggestion is above the current audience level — still
  selectable, but a hint that most of its satellites will be filtered out on
  arrival.
- In compact landscape, the box collapses to a tap/click-to-expand icon.

**Share**
- "Copy link" button copies the current URL (already kept in sync with the
  centered view) to the clipboard, with copied/failed feedback text.

**Level bar**
- Five ticks, "Essential" → "Deep dive"; each has a native tooltip with a
  longer per-level description (`LEVEL_LABELS`, `level-bar.ts`).
- Click a non-current tick to jump straight to that level.
- Drag the current tick to live-scrub through levels (each tick crossed
  redraws a preview, without touching browser history) until released.
- Non-current ticks show a `+N`/`-N` annotation: how many concepts in the
  current view would appear or disappear jumping straight there.
- In compact landscape, the bar rotates to a vertical strip on the right edge.

**Kind browser** (opened via the center card's kind badge)
- Left sidebar lists every concept kind; the active one is highlighted; kinds
  with nothing at the current level render faint but stay clickable.
- Right pane lists every concept of the selected kind, alphabetically; clicking
  one re-centers the diagram there.
- A kind with genuinely no concepts (vs. none *at this level*) shows a
  distinct message.

**Acronym cloud** (opened via a center-card acronym chip)
- A word cloud of every acronym in the dataset (level 5) or a level-filtered
  subset, sized by the concept's graph degree.
- Clicking a word re-centers the diagram on that concept.
- Arriving via a specific acronym enlarges/highlights that word.

**Navigation / URL**
- Every view (concept, kind list, acronym cloud) is a deep link
  (`?concept=`, `?kind=`, `?tla=`, plus `?hilite=` and `?level=`) — bookmarkable
  and shareable via the Copy link button.
- Browser back/forward moves through view history (`popstate`).
- No `?concept=` on first load picks a random concept, then rewrites the URL so
  the random pick is itself bookmarkable.
- An unknown concept/kind/acronym in the URL shows an explicit error with a
  hint to use search, rather than silently substituting something else.

**Platform**
- Installable as a PWA (manifest, iOS home-screen icon); works offline after
  first load via a service worker — production builds only.

## Proposed design

### A. Entry points

- A floating circular help button (`?` glyph), bottom-right in normal/portrait
  layout — visually related to `.share-button` (`--card-bg`/`--card-border`/
  shadow) but circular and icon-only so it doesn't compete with the level bar's
  centered position at the bottom. In compact landscape, where the level bar
  claims the right edge as a vertical strip (`style.css:565-588`), it relocates
  to bottom-left instead — the same breakpoint-driven repositioning already
  applied to `#search-root`/`#share-root` there.
- A new `#help-root`, sibling of `#app` in `index.html`, initialized once from
  `main.ts` (`initHelp(helpRoot, options)`) — same reasoning as
  `#search-root`/`#share-root`/`#level-bar-root`: `#app` is fully torn down on
  every redraw, so anything meant to persist across navigations has to live
  outside it (`CLAUDE.md`).
- A global `keydown` listener for `?` (i.e. `Shift+/`) that opens the panel,
  guarded to skip while a text input (the search box, in particular) has
  focus — `?` is an ordinary typeable character, unlike the single-purpose
  shortcut keys used elsewhere (Escape, arrow keys), so this needs an explicit
  "am I inside a text field" check rather than firing unconditionally.

### B. Help panel (persistent reference)

Reuses the backdrop/panel/focus-trap idiom `render.ts`'s
`showDescriptionPopover` already established, rather than inventing a second
overlay pattern: a focus-trapped backdrop, closed by Escape or clicking outside
it. One scrollable panel, not multi-page navigation — the content below fits
one skim-able screen:

1. **Getting started** — one line per major control, phrased as actions
   ("Click a satellite to explore it," "Drag the bar at the bottom to show
   more or less detail"), input-mode-adapted (see D below).
2. **Reading the diagram** — what the legend's colors and arrows mean, that
   satellite-satellite arcs are relationships between neighbors (not to the
   center), and that a spoke's direction and label always read
   source → target regardless of which end happens to be centered — the one
   genuinely subtle part of this app's model, called out explicitly rather
   than left implicit.
3. **Audience levels** — the five level labels/descriptions, reused verbatim
   from `LEVEL_LABELS` (`level-bar.ts`) rather than re-authored, and what the
   filter does and doesn't affect (only satellites — the centered concept
   always shows regardless of its own level).
4. **Concept kinds** — a short note that every concept has one of 14 kinds
   (`CONCEPT_KINDS`, `types.ts`), and that clicking a kind badge browses every
   concept sharing it.
5. **About** — project purpose (from `README.md`'s opening paragraph), a link
   to the GitHub repo (`https://github.com/dkirkby/ai4sci-map`), a note on how
   the data is curated (hand-authored YAML, validated by a build pipeline —
   from `DATA_README.md`), and a link to the repo's Issues page for reporting a
   wrong description or a missing concept.
6. A **"Take the tour"** control at the top of the panel, to (re)start the
   guided tour on demand regardless of the first-visit flag's state.

### C. Guided tour (spotlight/coach-marks)

A live overlay that dims the page and highlights the *real* DOM element for
each step (not a mockup), with a callout bubble anchored to it — chosen over a
static slide deck because it lets someone verify "yes, that's the thing" in
place rather than translating a picture to the live UI themselves.

Step sequence. Because it points at live elements, every step has to tolerate
the concept actually on screen — some elements legitimately don't exist for a
given concept or viewport, and the tour should skip past those rather than
force a detour to a concept that happens to have one:

1. The center card — "this is the concept you're viewing."
2. The search box — "jump to any concept by name."
3. A satellite (any one present) — "click to explore it." **Skipped** if the
   current concept has zero visible satellites at the current level (possible
   for an isolated concept at level 1).
4. The kind badge — "browse everything of this kind." (Never skipped — every
   concept has a kind.)
5. An acronym chip — "click to see this abbreviation's word cloud." **Skipped**
   if the current concept has no acronyms; presented as an optional step, not
   a numbered gap the visitor notices missing.
6. The level bar — "drag to reveal more or less detail."
7. The Copy link button — "get a link straight to this view." **Skipped**
   below the 760px width where the button itself is hidden
   (`style.css:518-522`).
8. Closing step, pointing back at the floating help button — "come back here
   anytime, or press `?`."

Every step shows a "Skip tour" control and responds to Escape, not just step
one — a first-visit modal that's hard to escape is worse than no tour at all.
Progress is shown as "N of M" rather than a fixed dot-per-step indicator, since
M varies with what got skipped.

On completion, skip, or dismissal, sets a namespaced `localStorage` flag (e.g.
`ai4sci-map:tour-seen`) so it never auto-shows again; the panel's "Take the
tour" control ignores that flag to allow a manual replay any time. Auto-shows
once, after the first real `render()` call completes (so step 3 has a live
satellite to point at), on whatever concept/URL the visitor actually landed on
— "first visit" means first time in this browser, not first time on the
default/random concept specifically.

### D. Input-mode adaptation

Detected once, at panel/tour build time, via
`window.matchMedia('(pointer: coarse)').matches` — a one-shot check rather than
a live listener, since input mode essentially never changes mid-session and
both the panel and tour are opt-in, on-demand UI that don't need to react to,
say, a mouse being plugged into a tablet mid-tour.

Copy pairs, selected by that flag:
- Satellite: "Tap a satellite" vs. "Click a satellite."
- Diagram zoom: "Pinch to zoom, drag to pan" vs. "Scroll or pinch the trackpad
  to zoom, drag to pan."
- Level ticks: "Tap a number to jump there" vs. "Click a number to jump
  there." (Dragging the current tick is phrased identically either way — the
  gesture itself doesn't differ.)
- Description popover: "Tap to read more" vs. "Click to read more."

Kept to phrasing only, via a shared `{ touch, pointer }` pair (or a single
template with a substituted token) per string — not a second content tree —
so `help.ts`/`tour.ts` don't end up maintaining two parallel copies of
everything.

### E. Accessibility

- Panel: same focus-trap/Escape/click-outside pattern as
  `showDescriptionPopover`, plus `role="dialog"`, `aria-modal="true"`, and a
  heading it's labelled by. Focus moves into the panel on open and back to the
  button that opened it on close — the existing popover only handles the
  open-side half of this (`backdrop.node()?.focus()`); worth doing the return
  trip properly here since this is longer-lived, more central UI.
- Tour: each step needs an `aria-live` announcement of its callout text —
  a visual spotlight alone conveys nothing to a screen-reader user. Tab stays
  confined to the callout's own controls (Next/Back/Skip) while a step is
  active.
- Floating button: `aria-label="Help"` plus `aria-keyshortcuts="?"` so its
  accessible name reflects the shortcut too.

### F. Visual design

- New CSS lives in `style.css` beside the other persistent-root rules
  (`#search-root`, `#share-root`, `#level-bar-root`), reusing the existing
  custom properties (`--card-bg`, `--card-border`, `--shadow`, `--accent`,
  `--highlight-bg`) rather than a parallel palette — dark mode then falls out
  for free, same as every other control.
- Button: `border-radius: 999px`, same shadow treatment as `.share-button`,
  sized to the ~44px accessible touch-target minimum already used elsewhere
  (`SATELLITE_HIT_RADIUS`, level ticks).
- Panel: built on `.description-popover`'s existing backdrop/panel styling
  rather than a third bespoke overlay component.
- Spotlight cutout: a theme-aware semi-opaque backdrop with a `box-shadow`
  cutout (a transparent shape with an oversized spread shadow) around the live
  target — plain CSS, no canvas/SVG masking needed.

### G. New files

- `src/help.ts` — floating button, panel markup/content, the `?` keydown
  listener; shaped like `share.ts` (`initHelp(container, options)`), owns the
  persistent (non-tour) half of the feature.
- `src/tour.ts` — the spotlight engine: step sequencing and skip logic,
  positioning the callout against a live element's `getBoundingClientRect()`,
  the `localStorage` flag. Kept separate from `help.ts` since its lifecycle
  (transient, DOM-position-dependent, needs to re-run per redraw if a step's
  target moves or a step's own action — e.g. step 3's "click a satellite" —
  triggers a full redraw via `onSelectConcept`) is different enough from the
  panel's (static content, open/closed, indifferent to diagram layout) that
  sharing one module wouldn't simplify either.
- `main.ts` wiring: `initHelp(helpRoot, { onStartTour })` alongside the
  existing `initSearch`/`initShareButton` calls; `startTour` needs the same
  `app`/`index` references `renderRoute` already closes over, to locate each
  step's live target after every render rather than holding a stale node
  reference across a mid-tour navigation.

## Content outline

A starting draft, not final copy — enough for implementation to have a script
rather than empty scaffolding.

| Area | Panel line |
|---|---|
| Satellites | "{Click/Tap} a satellite to make it the new center." |
| Kind badge | "{Click/Tap} the kind label (e.g. \"architecture\") to browse every concept of that kind." |
| Acronyms | "{Click/Tap} an acronym to see where else it's used." |
| Description | "Long descriptions are cut off — {click/tap} to read the rest." |
| Diagram zoom | "{Pinch/Scroll} to zoom, drag to pan." |
| Search | "Search matches every concept, not just what's on screen. Dimmed results are above your current detail level." |
| Share | "Copy link grabs a URL for exactly what you're looking at." |
| Level bar | "Drag the marker to show more (\"Deep dive\") or less (\"Essential\") detail. The +/− numbers preview what a jump would change." |
| Legend | "Colors and arrows show how concepts relate; hover any line for its exact relationship." |
| Direction | "A line always reads the same way — source → target — no matter which end is in the center." |

## Migration phases

1. **Help panel + floating button + `?` shortcut** (B, A, most of E/F/G) —
   ships value standalone, no tour dependency.
2. **Guided tour engine + step content** (C, D) — layered on top once the
   panel exists (it owns the "Take the tour" entry point and is where the
   `localStorage` flag's effect is visible/resettable).
3. **Accessibility pass + cross-device QA** — touch-phrasing correctness,
   focus management, screen-reader announcements.

## Testing / validation

No test suite in this repo (`CLAUDE.md`); validation is manual via
`npm run dev`. Per this repo's working conventions, don't use a headless
browser or Playwright to verify the visual result — describe the manual checks
below for the user to run themselves:

- First visit (cleared `localStorage`) at each viewport shape: tour auto-shows,
  targets the right live elements, and skips gracefully when a step's target
  is absent (an isolated concept with no satellites at level 1, a concept with
  no acronyms, a viewport under 760px hiding the share button).
- Second visit: tour does not auto-show; "Take the tour" in the panel replays
  it on demand.
- `?` opens the panel from anywhere except while typing in the search box.
- Panel content reads correctly from all three views (concept diagram, kind
  browser, acronym cloud) and at each of the 5 audience levels.
- Dark mode.
- Keyboard-only pass: reach the help button via Tab, open it with Enter/Space,
  navigate both the panel and the tour using Tab/Escape alone.
- Compact landscape: the floating button relocates to bottom-left without
  colliding with the vertical level-bar strip or the collapsed search capsule.

## Open questions

- Exact tour/panel copy — this doc drafts structure and a starting outline,
  not final wording.
- Should the tour's "click a satellite" step let the click go through for real
  (triggering an actual navigation, per note G) or point at a disabled/inert
  mock target instead? A real click is more honest but complicates
  re-anchoring the rest of the tour afterward; worth prototyping both before
  committing.

## Future work (explicitly deferred)

- Contextual `?` affordances on individual controls (progressive disclosure),
  instead of everything living in one central panel.
- Searchable panel content, if it ever grows past a single skim-able scroll.
- Per-relationship-type help reachable from the legend itself (currently only
  available via hover tooltip on a line already in the diagram).
- Localization.
