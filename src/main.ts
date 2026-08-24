import "./style.css";
import { initAnalytics, trackPageView } from "./analytics.js";
import { buildGraphIndex, resolveConceptId } from "./graph.js";
import { initHelp } from "./help.js";
import { renderLevelBar } from "./level-bar.js";
import {
  render,
  renderAcronymCloud,
  renderKindList,
  type RenderOptions,
  type ViewResult,
} from "./render.js";
import { initSearch, setSearchLevel } from "./search.js";
import { initShareButton } from "./share.js";
import { hasSeenTour, notifyNavigation, startTour, type TourElements } from "./tour.js";
import type { ConceptKind, GraphData } from "./types.js";

const CONCEPT_PARAM = "concept";
const KIND_PARAM = "kind";
const TLA_PARAM = "tla";
const HILITE_PARAM = "hilite";
const LEVEL_PARAM = "level";
const DEFAULT_LEVEL = 3;
// Landing page for a bare URL (no query string at all) -- equivalent to
// `?concept=artificial-intelligence&level=3`, giving new visitors a
// consistent, curated starting point instead of a random concept.
const DEFAULT_CONCEPT_ID = "artificial-intelligence";
// Debounces re-layout while a resize is still in progress (e.g. a dragged
// window edge fires many times a second) rather than redrawing every frame.
const RESIZE_DEBOUNCE_MS = 150;
// Below this, a size change is layout noise (e.g. a scrollbar toggling), not
// a real resize worth redrawing for.
const RESIZE_EPSILON_PX = 1;

/** Parses and clamps the `level` query param, silently falling back to the default rather than erroring. */
function parseLevel(raw: string | null): number {
  const parsed = raw === null ? NaN : Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : DEFAULT_LEVEL;
}

async function main() {
  initAnalytics();

  const app = document.getElementById("app");
  const searchRoot = document.getElementById("search-root");
  const shareRoot = document.getElementById("share-root");
  const levelBarRoot = document.getElementById("level-bar-root");
  const helpRoot = document.getElementById("help-root");
  if (!app) throw new Error("Missing #app container");
  if (!searchRoot) throw new Error("Missing #search-root container");
  if (!shareRoot) throw new Error("Missing #share-root container");
  if (!levelBarRoot) throw new Error("Missing #level-bar-root container");
  if (!helpRoot) throw new Error("Missing #help-root container");

  const response = await fetch(`${import.meta.env.BASE_URL}graph.json`);
  if (!response.ok) {
    app.textContent = `Failed to load graph.json (${response.status})`;
    return;
  }
  const data = (await response.json()) as GraphData;
  const index = buildGraphIndex(data);

  /**
   * Builds a URL for a navigation that replaces the view (concept/kind/tla
   * params), carrying the current `level` param along unchanged since it's a
   * view-independent filter setting, not part of what identifies the view.
   */
  function navigationUrl(apply: (url: URL) => void): URL {
    const currentLevel = new URLSearchParams(location.search).get(LEVEL_PARAM);
    const url = new URL(location.href);
    url.search = "";
    apply(url);
    if (currentLevel !== null) url.searchParams.set(LEVEL_PARAM, currentLevel);
    return url;
  }

  /**
   * Commits a real navigation: pushes history, redraws, and tells a running
   * guided tour that the user just did something (see tour.ts's
   * notifyNavigation) so it can advance itself. Deliberately not used by the
   * resize-triggered or level-bar-preview redraws below, which redraw #app
   * without pushing history -- those aren't the user acting on a tour step.
   */
  function commitNavigation(url: URL): void {
    history.pushState(null, "", url);
    renderRoute(false);
    trackCurrentView();
    notifyNavigation();
  }

  function navigateTo(conceptId: string): void {
    const url = navigationUrl((u) => u.searchParams.set(CONCEPT_PARAM, conceptId));
    commitNavigation(url);
  }

  function navigateToKind(kind: ConceptKind, conceptId: string): void {
    const url = navigationUrl((u) => {
      u.searchParams.set(KIND_PARAM, kind);
      u.searchParams.set(HILITE_PARAM, conceptId);
    });
    commitNavigation(url);
  }

  function navigateToKindOnly(kind: ConceptKind): void {
    const url = navigationUrl((u) => u.searchParams.set(KIND_PARAM, kind));
    commitNavigation(url);
  }

  function navigateToAcronym(acronym: string, conceptId: string): void {
    const url = navigationUrl((u) => {
      u.searchParams.set(TLA_PARAM, acronym);
      u.searchParams.set(HILITE_PARAM, conceptId);
    });
    commitNavigation(url);
  }

  function navigateToLevel(level: number): void {
    const url = new URL(location.href);
    url.searchParams.set(LEVEL_PARAM, String(level));
    commitNavigation(url);
  }

  const renderOptions: RenderOptions = {
    onSelectConcept: navigateTo,
    onSelectKind: navigateToKind,
    onSwitchKind: navigateToKindOnly,
    onSelectAcronym: navigateToAcronym,
  };

  /**
   * Draws whichever view the current URL's query params describe: a kind
   * listing if `kind` is present, an acronym word cloud if `tla` is present,
   * otherwise the normal concept view (falling back to `DEFAULT_CONCEPT_ID`
   * if `concept` is absent).
   * `rewriteUrl` is only passed true for the initial page load, matching the
   * existing convention of canonicalizing the URL once via `replaceState`
   * rather than on every popstate. Returns the drawn view's per-level concept
   * counts (for the level bar's annotations) and legend layout (for the
   * search bar's compact-mode position, see renderRoute).
   */
  function renderCurrentView(params: URLSearchParams, level: number, rewriteUrl: boolean): ViewResult {
    const kind = params.get(KIND_PARAM);
    if (kind !== null) {
      return renderKindList(app!, index, kind, params.get(HILITE_PARAM), level, renderOptions);
    }

    const tla = params.get(TLA_PARAM);
    if (tla !== null) {
      return renderAcronymCloud(app!, index, tla, level, renderOptions);
    }

    const requested = params.get(CONCEPT_PARAM);
    // Falls back to the raw (unresolved) value when nothing matches, so
    // render() hits its "Unknown concept" error path instead of silently
    // substituting the default concept.
    const conceptId = requested ? (resolveConceptId(index, requested) ?? requested) : DEFAULT_CONCEPT_ID;

    if (rewriteUrl && conceptId !== requested) {
      const url = new URL(location.href);
      url.search = "";
      url.searchParams.set(CONCEPT_PARAM, conceptId);
      const currentLevel = params.get(LEVEL_PARAM);
      if (currentLevel !== null) url.searchParams.set(LEVEL_PARAM, currentLevel);
      history.replaceState(null, "", url);
    }

    return render(app!, index, conceptId, level, renderOptions);
  }

  /**
   * Redraws the current view at `level` without touching browser history --
   * used to live-preview each tick the level-bar drag crosses. The real URL
   * still names whichever level preceded the drag, so if the gesture ends
   * back where it started (or the tab is reloaded mid-drag), nothing here
   * needs to be undone.
   */
  function previewLevel(level: number): void {
    renderRoute(false, level);
  }

  /**
   * Human-readable GA4 page_title for the view `params` describes, mirroring
   * renderCurrentView's own kind/tla/concept branching (kept separate rather
   * than threading a title through ViewResult, since this is read-only and
   * analytics-specific). The path itself is just the current URL -- the query
   * params already fully identify the view, so there's no separate route
   * table to consult.
   */
  function describeCurrentView(params: URLSearchParams): { path: string; title: string } {
    const path = `${location.pathname}${location.search}`;

    const kind = params.get(KIND_PARAM);
    if (kind !== null) return { path, title: `Kind: ${kind}` };

    const tla = params.get(TLA_PARAM);
    if (tla !== null) return { path, title: `Acronym: ${tla}` };

    const requested = params.get(CONCEPT_PARAM);
    const conceptId = requested ? (resolveConceptId(index, requested) ?? requested) : DEFAULT_CONCEPT_ID;
    return { path, title: index.conceptsById.get(conceptId)?.label ?? conceptId };
  }

  function renderRoute(rewriteUrl: boolean, overrideLevel?: number): void {
    const params = new URLSearchParams(location.search);
    const level = overrideLevel ?? parseLevel(params.get(LEVEL_PARAM));
    const result = renderCurrentView(params, level, rewriteUrl);
    renderLevelBar(levelBarRoot!, { level, counts: result.counts, onChange: navigateToLevel, onPreview: previewLevel });
    setSearchLevel(level);

    // In compact landscape, the search bar collapses to a capsule sharing a
    // row with the legend (see render.ts); --legend-height lets its CSS
    // position center it on that row regardless of how tall the current
    // view's legend happens to be.
    searchRoot!.classList.toggle("is-compact", result.searchSharesRow);
    searchRoot!.style.setProperty("--legend-height", `${result.legendHeight}px`);
  }

  /**
   * Sends a GA4 virtual pageview for whatever renderRoute just drew. Called
   * only from real-navigation sites (commitNavigation, popstate, the initial
   * load) -- deliberately not from inside renderRoute itself, since that's
   * also invoked by the resize observer and by previewLevel's per-tick drag
   * preview, neither of which is a navigation worth counting.
   */
  function trackCurrentView(): void {
    const { path, title } = describeCurrentView(new URLSearchParams(location.search));
    trackPageView(path, title);
  }

  window.addEventListener("popstate", () => {
    renderRoute(false);
    trackCurrentView();
  });

  // The radial layout's ellipse is sized from #app's own rendered pixels (see
  // render.ts), which only stays correct if a viewport-size change (dragging
  // a window edge, rotating a device, a mobile browser's chrome showing or
  // hiding) triggers a redraw -- a plain `resize` listener would miss
  // container-size changes that aren't a window resize, so this watches #app
  // itself instead. Debounced, and the initial callback (which just reports
  // #app's starting size, not a change) is skipped so it doesn't cause a
  // redundant redraw right after the one below.
  let lastObservedSize: { width: number; height: number } | null = null;
  let resizeDebounceTimer: number | undefined;
  const resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const { width, height } = entry.contentRect;

    if (lastObservedSize === null) {
      lastObservedSize = { width, height };
      return;
    }
    if (
      Math.abs(width - lastObservedSize.width) < RESIZE_EPSILON_PX &&
      Math.abs(height - lastObservedSize.height) < RESIZE_EPSILON_PX
    ) {
      return;
    }
    lastObservedSize = { width, height };

    if (resizeDebounceTimer !== undefined) window.clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = window.setTimeout(() => {
      resizeDebounceTimer = undefined;
      renderRoute(false);
    }, RESIZE_DEBOUNCE_MS);
  });
  resizeObserver.observe(app);

  const tourElements: TourElements = { app, searchRoot, shareRoot, levelBarRoot, helpRoot };

  initSearch(searchRoot, [...index.conceptsById.values()], { onSelectConcept: navigateTo });
  initShareButton(shareRoot);
  initHelp(helpRoot, { onStartTour: () => startTour(tourElements) });

  renderRoute(true);
  trackCurrentView();

  // Auto-starts once per browser (see tour.ts's hasSeenTour), only when the
  // initial view is the normal concept diagram -- a first-ever visit landing
  // on a shared kind-browser/acronym-cloud link has no center card, satellite,
  // etc. for most tour steps to point at, so this skips showing it (without
  // marking it seen) rather than presenting a near-empty tour.
  if (!hasSeenTour() && app.querySelector(".center-card")) {
    startTour(tourElements);
  }
}

main().catch((err) => {
  console.error(err);
  const app = document.getElementById("app");
  if (app) app.textContent = "Failed to initialize the concept browser.";
});

// Registered only in production builds: a dev-mode service worker would
// cache Vite's dev assets and fight with HMR's own reloading.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err) => {
      console.error("Service worker registration failed", err);
    });
  });
}
