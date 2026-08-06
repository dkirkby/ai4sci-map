import * as d3 from "d3";
import { computeLevelCounts, getSatelliteSatelliteRelationships, type GraphIndex, type LevelCounts } from "./graph.js";
import { computeRadialLayout, resolveSatellitePositions, type Point } from "./layout.js";
import {
  allFamilyKeys,
  buildLegend,
  colorForAcronymWord,
  colorForRelationshipType,
  legendMarkerIdForRelationshipType,
  markerIdForRelationshipType,
  type LegendEntry,
} from "./style.js";
import { CONCEPT_KINDS, type Concept, type ConceptKind } from "./types.js";

const CARD_WIDTH = 270;
const CARD_HEIGHT = 280;
// Must match .center-card's border-radius in style.css.
const CARD_CORNER_RADIUS = 12;
// The card never needs to be wider/taller than about a third of the screen or
// the space actually available between the fixed bars -- letting it shrink
// there leaves room for the ring and satellite labels beside it, instead of
// the ring (or the card itself) being squeezed against/behind those bars.
const CARD_MIN_HALF_WIDTH = 100;
const CARD_MIN_HALF_HEIGHT = 70;
// Minimum gap between the (possibly shrunk) card's edge and the ring.
const RADIUS_CLEARANCE = 12;
const SATELLITE_NODE_RADIUS = 9;
// Invisible tap-target padding around each satellite, sized independently of
// the visible dot -- this is real CSS-pixel size (see viewBox note below), so
// it stays close to the ~44px minimum recommended touch target on every
// device instead of shrinking along with the visual layout.
const SATELLITE_HIT_RADIUS = 22;
const LABEL_GAP = 6;
// A label wraps onto at most this many lines (breaking on word boundaries)
// before the remainder gets truncated with an ellipsis. 3 rather than 2:
// on a wide viewport MAX_LABEL_CHARS already fits nearly every label
// (including the dataset's longest, at 46 characters) on 1-2 lines, so the
// third line mainly matters on a narrow viewport, where the per-line char
// budget shrinks and a long label (or one whose concept has no acronym to
// fall back to, see computeSatelliteFootprint) would otherwise truncate
// despite the extra vertical room a force-resolved layout can usually spare.
const MAX_LABEL_LINES = 3;
const LABEL_LINE_HEIGHT_EM = 1.1;
// Matches .satellite-label's font-size in style.css -- only used to convert
// between em (for baseline positioning) and px (for hit-area sizing) below.
const SATELLITE_LABEL_FONT_SIZE = 12;
const LABEL_LINE_HEIGHT_PX = LABEL_LINE_HEIGHT_EM * SATELLITE_LABEL_FONT_SIZE;
// Approximate ascent, in em, for the line closest to the node -- so its
// baseline sits a sensible distance past the node/gap rather than right at it.
const LABEL_BASELINE_OFFSET_EM = 0.75;
const EMPTY_LEVEL_COUNTS: LevelCounts = [0, 0, 0, 0, 0];

/**
 * What a view-render function reports back to main.ts alongside the drawn
 * DOM/SVG, so it can position the persistent (outside-#app) search bar:
 * `legendHeight` (0 when the view has no legend) sizes the shared row when
 * `searchSharesRow` says the search bar should collapse to a capsule beside
 * it, rather than stack above it.
 */
export interface ViewResult {
  counts: LevelCounts;
  legendHeight: number;
  searchSharesRow: boolean;
}

function viewResult(counts: LevelCounts, legendHeight = 0, searchSharesRow = false): ViewResult {
  return { counts, legendHeight, searchSharesRow };
}

const EMPTY_VIEW_RESULT: ViewResult = viewResult(EMPTY_LEVEL_COUNTS);
// Rough average glyph width (px) for the 12px sans-serif label font -- used only
// to size label allowances and truncation, not for precise text layout.
const CHAR_WIDTH_ESTIMATE = 6.6;
const VIEW_MARGIN = 24;
// Never truncate a satellite label shorter than this many characters (plus an
// ellipsis), even on the narrowest screens -- a name that short stops being
// useful for telling satellites apart.
const MIN_LABEL_CHARS = 4;
// Never wrap/truncate a label tighter than it needs on a very wide screen --
// most concept labels fit or nearly fit in this many characters per line (the
// dataset's median label length is 16 characters; this comfortably covers the
// upper-median range too before wrapping is still needed for genuine outliers).
const MAX_LABEL_CHARS = 26;
// How much of the available half-width a satellite label's per-line budget
// may claim -- the rest stays reserved for the ring's own outer radius (see
// maxRadiusX below). Purely a trade-off between "labels wrap/truncate less"
// and "satellites can spread further out"; not derived from anything else.
const LABEL_WIDTH_FRACTION = 0.4;
// The search bar (top) and level bar (bottom) are fixed overlays on every
// view; the diagram lays out in the space between them, not underneath.
const TOP_SAFE_AREA = 84;
const BOTTOM_SAFE_AREA = 96;
// Caps how tall/narrow the satellite ellipse can get on extreme aspect ratios
// (e.g. a very short landscape phone), so it doesn't stretch absurdly.
const MAX_RADIUS_Y_RATIO = 2.4;
// Below this height, a wider-than-tall viewport is treated as a phone turned
// sideways (not just a normal wide desktop window, which is "landscape" too
// but has height to spare) -- matches the breakpoint in style.css that moves
// the level bar from the bottom to a vertical strip on the right there,
// freeing up the scarce vertical space instead.
const LANDSCAPE_COMPACT_MAX_HEIGHT = 500;
const RIGHT_SAFE_AREA_LANDSCAPE = 96;
// Matches #search-root/#share-root/#level-bar-root's shared 20px edge
// margin in style.css.
const TOP_MARGIN = 20;
// In compact landscape, the search bar collapses to an icon-only capsule
// sharing one row with the legend instead of stacking above it -- this is
// that capsule's diameter, and the gap before the legend content next to it.
// Must match #search-root.is-compact's sizing in style.css.
const SEARCH_CAPSULE_SIZE = 44;
const SEARCH_CAPSULE_GAP = 12;


// The legend spans the full available width and flows entries left-to-right,
// wrapping to a new row once one is full, rather than a single narrow
// fixed-width column -- trading unused horizontal space (especially on
// mobile portrait) for less wasted vertical space above the ring.
const LEGEND_MARGIN = 16;
const LEGEND_ROW_HEIGHT = 20;
const LEGEND_PADDING = 12;
const LEGEND_SWATCH_WIDTH = 20;
// How much of the swatch's width the legend-only arrowhead marker (see
// `defs`'s legendMarkerIdForRelationshipType) occupies -- the swatch line
// itself is drawn only up to LEGEND_SWATCH_WIDTH - LEGEND_ARROW_LENGTH, so
// its stroke stops exactly where the arrowhead's own base starts, instead of
// running underneath the (comparably thick, at this small size) arrowhead
// and blunting its point. Must match that marker's markerWidth.
const LEGEND_ARROW_LENGTH = 6;
const LEGEND_TEXT_GAP = 8;
const LEGEND_ENTRY_GAP = 16;
// Rough average glyph width (px) for the 11px legend label font -- used only
// to estimate how much horizontal room each legend entry needs.
const LEGEND_CHAR_WIDTH_ESTIMATE = 6;

export interface RenderOptions {
  onSelectConcept: (conceptId: string) => void;
  onSelectKind: (kind: ConceptKind, conceptId: string) => void;
  onSwitchKind: (kind: ConceptKind) => void;
  onSelectAcronym: (acronym: string, conceptId: string) => void;
}

function pointTowards(from: Point, to: Point, distance: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / length) * distance, y: from.y + (dy / length) * distance };
}

function normalizedAngleDiff(a: number, b: number): number {
  const twoPi = Math.PI * 2;
  let diff = (b - a) % twoPi;
  if (diff > Math.PI) diff -= twoPi;
  if (diff < -Math.PI) diff += twoPi;
  return diff;
}

/** Shortens `label` to `maxChars` (plus an ellipsis) when it's longer than that. */
function truncateLabel(label: string, maxChars: number): string {
  if (label.length <= maxChars) return label;
  const ELLIPSIS = "…";
  const sliceLength = Math.max(1, maxChars - ELLIPSIS.length);
  return label.slice(0, sliceLength).trimEnd() + ELLIPSIS;
}

interface WrappedLabel {
  lines: string[];
  truncated: boolean;
}

/** Greedily packs words onto lines of at most `maxCharsPerLine`, always keeping at least one word per line. */
function splitIntoLines(label: string, maxCharsPerLine: number): string[] {
  const words = label.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current === "" || candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Wraps `label` onto up to `MAX_LABEL_LINES` lines of at most `maxCharsPerLine`
 * each, so a narrow screen can show roughly twice the characters it could on a
 * single line. Anything left over after that many lines is folded into the
 * last line and truncated with an ellipsis, rather than adding more lines.
 */
function wrapLabel(label: string, maxCharsPerLine: number): WrappedLabel {
  const rawLines = splitIntoLines(label, maxCharsPerLine);
  if (rawLines.length <= MAX_LABEL_LINES) {
    return { lines: rawLines, truncated: false };
  }
  const kept = rawLines.slice(0, MAX_LABEL_LINES - 1);
  const remainder = rawLines.slice(MAX_LABEL_LINES - 1).join(" ");
  kept.push(truncateLabel(remainder, maxCharsPerLine));
  return { lines: kept, truncated: true };
}

interface SatelliteFootprint extends WrappedLabel {
  /**
   * Radius of a circle, centered on the satellite's node, big enough to
   * contain its label block on whichever side (above or below the node) it
   * ends up drawn -- used both to size that satellite's collision radius in
   * the force layout (see `resolveSatellitePositions`) and, unscaled, its hit
   * area below.
   */
  collideRadius: number;
  /** Half-width of the invisible tap-target rect drawn under the label. */
  halfHitWidth: number;
  /** Distance from the node center to the far edge of its label block. */
  labelBlockReach: number;
  /** True when an acronym is shown in place of the concept's full label -- see `computeSatelliteFootprint`. */
  isAcronym: boolean;
}

/**
 * Wraps a satellite's display label and measures the resulting footprint --
 * see `SatelliteFootprint`. Displays `concept.label` as-is when it already
 * fits on one line; otherwise falls back to `concept.acronyms[0]` if the
 * concept has one, on the theory that a short, recognizable acronym reads
 * better than a wrapped or truncated full name (an acronym is a
 * space-saving fallback, not a universal replacement -- a short label that
 * already fits keeps displaying in full, the same way search/the center
 * card's acronym row treat acronyms as a secondary, optional identifier,
 * not the primary one). Concepts with multiple acronyms use the first, same
 * as the center card's acronym row.
 */
function computeSatelliteFootprint(concept: Concept, maxCharsPerLine: number): SatelliteFootprint {
  const fullLabelWrap = wrapLabel(concept.label, maxCharsPerLine);
  const acronym = concept.acronyms?.[0];
  const isAcronym = acronym !== undefined && fullLabelWrap.lines.length > 1;
  const { lines, truncated } = isAcronym ? wrapLabel(acronym, maxCharsPerLine) : fullLabelWrap;

  const longestLineLength = Math.max(...lines.map((line) => line.length));
  const halfHitWidth = Math.max(
    SATELLITE_HIT_RADIUS,
    (longestLineLength * CHAR_WIDTH_ESTIMATE) / 2 + SATELLITE_HIT_RADIUS / 2,
  );
  const labelBlockReach = SATELLITE_NODE_RADIUS + LABEL_GAP + lines.length * LABEL_LINE_HEIGHT_PX;
  return {
    lines,
    truncated,
    halfHitWidth,
    labelBlockReach,
    isAcronym,
    collideRadius: Math.max(halfHitWidth, labelBlockReach),
  };
}

interface LegendPlacement {
  entry: LegendEntry;
  x: number;
  row: number;
}

/**
 * Flows legend entries left-to-right, each sized to its own label, wrapping
 * to a new row once the current one is full -- rather than a fixed-width
 * column grid, which one unusually long entry (see buildLegend) would force
 * down to a single column even though every other entry is much shorter.
 */
function packLegendEntries(entries: LegendEntry[], availableWidth: number): LegendPlacement[] {
  const placements: LegendPlacement[] = [];
  let x = 0;
  let row = 0;
  for (const entry of entries) {
    const width = LEGEND_SWATCH_WIDTH + LEGEND_TEXT_GAP + entry.label.length * LEGEND_CHAR_WIDTH_ESTIMATE;
    if (x > 0 && x + width > availableWidth) {
      row += 1;
      x = 0;
    }
    placements.push({ entry, x, row });
    x += width + LEGEND_ENTRY_GAP;
  }
  return placements;
}

/**
 * Builds the center card's content -- kind badge, title, acronyms,
 * description -- as a child of `parent`. Used both for the real, visible
 * card and, in `render()`, a throwaway hidden measurement pass that sizes
 * the card to its actual content instead of a fixed viewport-fraction
 * height, which otherwise left a concept with no acronyms and a short
 * description with a lot of dead vertical padding (the card was exactly as
 * tall as one with the longest possible content, regardless of what a given
 * concept actually has).
 */
function buildCenterCard<ParentElement extends d3.BaseType>(
  parent: d3.Selection<ParentElement, unknown, null, undefined>,
  centerConcept: Concept,
  options: RenderOptions,
): void {
  const card = parent.append("xhtml:div").attr("class", "center-card");
  card
    .append("div")
    .attr("class", "center-card-kind")
    .text(centerConcept.kind.replace(/_/g, " "))
    .on("click", () => options.onSelectKind(centerConcept.kind, centerConcept.id));
  card.append("h2").attr("class", "center-card-label").text(centerConcept.label);

  const acronyms = centerConcept.acronyms ?? [];
  if (acronyms.length > 0) {
    const acronymsRow = card.append("div").attr("class", "center-card-acronyms");
    acronyms.forEach((acronym, i) => {
      if (i > 0) acronymsRow.append("span").attr("class", "dot-separator").text(" · ");
      acronymsRow
        .append("span")
        .attr("class", "acronym-link")
        .text(acronym)
        .on("click", () => options.onSelectAcronym(acronym, centerConcept.id));
    });
  }

  card.append("p").attr("class", "center-card-description").text(centerConcept.description);
}

/**
 * Measures how tall the center card's content actually wants to be at a
 * given width, by building it (via `buildCenterCard`) into a hidden,
 * off-screen element and reading back its rendered height. `.center-card`
 * inherits `height: 100%` from its class, which would resolve against
 * `<body>`'s own explicit height (see `html, body { height: 100% }` in
 * style.css) if left alone -- overridden inline to `auto` so it sizes to
 * content instead.
 */
function measureCenterCardHeight(width: number, centerConcept: Concept, options: RenderOptions): number {
  const host = document.createElement("div");
  host.style.cssText = "position: fixed; top: -9999px; left: -9999px; visibility: hidden; pointer-events: none;";
  document.body.appendChild(host);

  const hostSelection = d3.select(host).style("width", `${width}px`);
  buildCenterCard(hostSelection, centerConcept, options);
  d3.select(host).select<HTMLDivElement>(".center-card").style("height", "auto");

  const height = host.getBoundingClientRect().height;
  document.body.removeChild(host);
  return height;
}

/**
 * Opens a full-screen popover showing `concept`'s untruncated description --
 * the fallback for descriptions the center card's own clamp/height limits
 * still can't fully show (see the truncation check in `render()`). Appended
 * inside `container` rather than as a `document`-level overlay so it's
 * automatically torn down by the next redraw's `container.innerHTML = ""`,
 * with no separate close-on-navigate handling needed.
 */
function showDescriptionPopover(container: HTMLElement, concept: Concept): void {
  d3.select(container).selectAll(".description-popover-backdrop").remove();

  const backdrop = d3
    .select(container)
    .append("div")
    .attr("class", "description-popover-backdrop")
    .attr("tabindex", "-1");

  const close = () => backdrop.remove();
  backdrop
    .on("click", (event: MouseEvent) => {
      if (event.target === backdrop.node()) close();
    })
    .on("keydown", (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    });

  const panel = backdrop
    .append("div")
    .attr("class", "description-popover")
    .on("click", (event: MouseEvent) => event.stopPropagation());
  panel
    .append("button")
    .attr("type", "button")
    .attr("class", "description-popover-close")
    .attr("aria-label", "Close")
    .text("×")
    .on("click", close);
  panel.append("div").attr("class", "description-popover-kind").text(concept.kind.replace(/_/g, " "));
  panel.append("h3").attr("class", "description-popover-label").text(concept.label);
  panel.append("p").attr("class", "description-popover-text").text(concept.description);

  backdrop.node()?.focus();
}

export function render(
  container: HTMLElement,
  index: GraphIndex,
  centerId: string,
  level: number,
  options: RenderOptions,
): ViewResult {
  container.innerHTML = "";

  const centerConcept = index.conceptsById.get(centerId);
  if (!centerConcept) {
    renderError(container, `Unknown concept: "${centerId}"`);
    return EMPTY_VIEW_RESULT;
  }

  // The center concept is always shown regardless of its own audience_level --
  // only satellites are subject to the filter -- so counts are computed from
  // the full, unfiltered satellite set before it's narrowed down below.
  const allEdges = index.adjacency.get(centerId) ?? [];
  const counts = computeLevelCounts(
    allEdges.flatMap((e) => {
      const concept = index.conceptsById.get(e.neighborId);
      return concept ? [concept] : [];
    }),
  );

  const edges = allEdges.filter((e) => (index.conceptsById.get(e.neighborId)?.audience_level ?? 0) <= level);
  const satelliteIds = new Set(edges.map((e) => e.neighborId));
  const satelliteSatelliteRelationships = getSatelliteSatelliteRelationships(index, satelliteIds);
  const placements = computeRadialLayout(edges, satelliteSatelliteRelationships);

  // The viewBox is sized to the container's actual rendered pixels (1 SVG user
  // unit == 1 CSS px), rather than a fixed constant that gets scaled down to
  // fit -- this keeps satellite dots, labels, and tap targets a real, constant
  // on-screen size on every device instead of shrinking on small screens.
  const containerRect = container.getBoundingClientRect();
  const viewWidth = containerRect.width || window.innerWidth;
  const viewHeight = containerRect.height || window.innerHeight;

  // computeRadialLayout's default for a single satellite (the only member of
  // its only group) places it straight down from the card. On a
  // wider-than-tall viewport that squeezes the spoke into a short vertical
  // gap -- especially now that the card is sized to its own content (see
  // measureCenterCardHeight) rather than a fixed fraction of the viewport,
  // that gap can be barely more than the arrowhead itself, which ends up
  // rendered partly behind the card (centerLayer draws on top of spokes).
  // A wide viewport has horizontal room to spare, so use that instead. This
  // is deliberately narrow: more than one satellite still needs
  // computeRadialLayout's grouping/ordering, and a taller-than-wide viewport
  // has the same squeeze problem on its *horizontal* extent instead, which
  // moving to the side wouldn't fix.
  if (placements.length === 1 && viewWidth > viewHeight) {
    placements[0]!.angle = Math.PI / 2;
  }

  // On a short landscape phone, the level bar relocates to a vertical strip
  // against the right edge (see style.css) instead of sitting at the bottom
  // -- freeing up the scarce vertical space there, at the cost of reserving
  // a strip on the right (where landscape has width to spare) instead.
  const isCompactLandscape = viewWidth > viewHeight && viewHeight <= LANDSCAPE_COMPACT_MAX_HEIGHT;
  const rightSafeArea = isCompactLandscape ? RIGHT_SAFE_AREA_LANDSCAPE : 0;
  const usableWidth = viewWidth - rightSafeArea;
  const centerX = usableWidth / 2;

  // The legend sits at the top, directly above where a satellite near the
  // "top" of the ring would otherwise land -- so the ring's own safe area
  // starts below the legend, not just below the search bar.
  const presentRelationshipTypeIds = new Set<string>([
    ...edges.map((e) => e.relationshipTypeId),
    ...satelliteSatelliteRelationships.map((r) => r.type),
  ]);
  const legendEntries = buildLegend(index.relationshipTypesById, presentRelationshipTypeIds);

  // In compact landscape, the search bar collapses to an icon-only capsule
  // sharing one row with the legend (see style.css's #search-root.is-compact)
  // instead of stacking above it, reclaiming the search bar's own dedicated
  // band. The legend indents past the capsule on *every* row, not just the
  // first -- a single legend row is shorter than the capsule, so indenting
  // only the first row would let the capsule spill down into row 1.
  const searchSharesRow = isCompactLandscape && legendEntries.length > 0;
  const legendLeftInset = searchSharesRow ? SEARCH_CAPSULE_SIZE + SEARCH_CAPSULE_GAP : 0;

  // The legend spans the full width (rather than a narrow fixed-width box)
  // and flows entries left-to-right, wrapping to a new row once a row is
  // full -- each entry sized to its own text, not a fixed column width, so
  // one unusually long entry (a family where *both* directions are present,
  // so it keeps the combined "A / B" label) doesn't force every other entry
  // onto its own row too.
  const legendAvailableWidth = Math.max(0, viewWidth - LEGEND_MARGIN * 2 - legendLeftInset);
  const legendPlacements = packLegendEntries(legendEntries, legendAvailableWidth);
  const legendRows = legendPlacements.reduce((max, p) => Math.max(max, p.row + 1), 0);
  const legendHeight = legendRows > 0 ? legendRows * LEGEND_ROW_HEIGHT + LEGEND_PADDING : 0;

  // Where the legend's own top edge sits: vertically centered against the
  // capsule when sharing its row (the capsule is usually taller than a
  // one-row legend, sometimes shorter than a two/three-row one -- either
  // way, centering on the shared row's height keeps both aligned on the same
  // centerline), or its own fixed position below the full-size search bar
  // otherwise.
  const topRowHeight = Math.max(SEARCH_CAPSULE_SIZE, legendHeight);
  const legendY = searchSharesRow ? TOP_MARGIN + (topRowHeight - legendHeight) / 2 : TOP_SAFE_AREA;

  // Center vertically within the space between the legend/search bar and the
  // level bar, not the full viewport, so the ring never lays out underneath
  // any of them.
  const safeTop = searchSharesRow
    ? TOP_MARGIN + topRowHeight + 16
    : TOP_SAFE_AREA + legendHeight + (legendHeight > 0 ? 16 : 0);
  const safeBottom = viewHeight - (isCompactLandscape ? VIEW_MARGIN : BOTTOM_SAFE_AREA);
  const centerY = (safeTop + safeBottom) / 2;

  const cardHalfWidth = Math.min(CARD_WIDTH / 2, Math.max(CARD_MIN_HALF_WIDTH, usableWidth * 0.28));
  const availableHeightBand = Math.max(0, safeBottom - safeTop);
  // The card is sized to its own content's actual height (measured below),
  // not a fixed viewport fraction -- capped at what the old fraction-only
  // formula would have given, so a concept with an unusually long
  // description still can't grow the card past what the viewport has room
  // for (that's still bounded by the same CARD_HEIGHT/viewport-fraction
  // ceiling as before; content longer than that continues to rely on
  // center-card-description's line-clamp, same as it always has).
  const cardHalfHeightCeiling = Math.min(CARD_HEIGHT / 2, Math.max(CARD_MIN_HALF_HEIGHT, availableHeightBand * 0.28));
  const measuredCardHeight = measureCenterCardHeight(cardHalfWidth * 2, centerConcept, options);
  const cardHalfHeight = Math.min(cardHalfHeightCeiling, Math.max(CARD_MIN_HALF_HEIGHT, measuredCardHeight / 2));
  const minRadiusX = cardHalfWidth + RADIUS_CLEARANCE;
  const minRadiusY = cardHalfHeight + RADIUS_CLEARANCE;

  // The label width budget scales with how much horizontal room is actually
  // available, capped so labels don't grow unreasonably wide on very large
  // screens -- computed independently of the ring's own outer radius (below),
  // not derived *from* it: satellites no longer share one ring (see
  // resolveSatellitePositions), and a satellite's actual radius can end up
  // well inside maxRadiusX, so there's no single "leftover slack at the
  // ring" to size labels from in the first place. (An earlier version of
  // this derived the label budget from that leftover slack, which made it
  // self-referential -- the ring was sized to consume exactly enough width
  // to leave only a fixed minimum margin, by construction, however wide the
  // viewport actually was.)
  const availableHalfWidth = usableWidth / 2 - VIEW_MARGIN;
  const maxLabelChars = Math.min(
    MAX_LABEL_CHARS,
    Math.max(MIN_LABEL_CHARS, Math.floor((availableHalfWidth * LABEL_WIDTH_FRACTION) / CHAR_WIDTH_ESTIMATE)),
  );

  // Labels sit above/below each satellite rather than beside it (see the
  // label block below), so the ring's outer bound only needs to clear the
  // node -- plus a margin, sized from the label budget just computed, for
  // labels on satellites near the left/right extreme, which have little room
  // to spill outward before the viewBox edge (there's ample room on their
  // inward side, towards center, so this margin only has to cover the
  // outward half of the label).
  const outerLabelMargin = maxLabelChars * CHAR_WIDTH_ESTIMATE;
  const maxRadiusX = Math.max(minRadiusX, availableHalfWidth - SATELLITE_NODE_RADIUS - outerLabelMargin);

  // Similarly, a satellite near the top/bottom of the safe area has its label
  // stacked further outward still, so the vertical reach needs to leave room
  // for a full (worst-case two-line) label block before the legend/search bar
  // or level bar.
  const labelBlockMargin = SATELLITE_NODE_RADIUS + LABEL_GAP + MAX_LABEL_LINES * LABEL_LINE_HEIGHT_PX;
  const availableHalfHeight = Math.max(0, safeBottom - safeTop) / 2 - VIEW_MARGIN - labelBlockMargin;
  const maxRadiusY = Math.min(Math.max(minRadiusY, availableHalfHeight), maxRadiusX * MAX_RADIUS_Y_RATIO);

  const pointForAngle = (angle: number, radius: number): Point => ({
    x: centerX + radius * Math.sin(angle),
    y: centerY - radius * Math.cos(angle),
  });

  /** Where a ray from the card center toward `to` exits the center card's rectangle. */
  const cardExitPoint = (to: Point): Point => {
    const dx = to.x - centerX;
    const dy = to.y - centerY;
    const tx = dx === 0 ? Infinity : cardHalfWidth / Math.abs(dx);
    const ty = dy === 0 ? Infinity : cardHalfHeight / Math.abs(dy);
    const t = Math.min(tx, ty);
    return { x: centerX + dx * t, y: centerY + dy * t };
  };

  const angleByConceptId = new Map(placements.map((p) => [p.conceptId, p.angle]));

  // Each satellite's label needs to be wrapped/measured before layout runs --
  // the force simulation below sizes its per-node collision radius from this
  // same footprint, so a satellite with a taller or wider label claims more
  // room from its neighbors rather than every satellite being forced onto one
  // shared ring regardless of label length (see LAYOUT_UPGRADE.md part B).
  const footprintByConceptId = new Map(
    placements.flatMap((p) => {
      const concept = index.conceptsById.get(p.conceptId);
      return concept ? [[p.conceptId, computeSatelliteFootprint(concept, maxLabelChars)] as const] : [];
    }),
  );
  const collideRadiusByConceptId = new Map(
    [...footprintByConceptId].map(([conceptId, footprint]) => [conceptId, footprint.collideRadius]),
  );

  const positionByConceptId = resolveSatellitePositions(placements, collideRadiusByConceptId, {
    center: { x: centerX, y: centerY },
    minRadiusX,
    minRadiusY,
    maxRadiusX,
    maxRadiusY,
  });

  // Final exact safety clamp, vertical only: the force simulation
  // approximates each satellite's footprint as a single circle (see
  // collideRadiusByConceptId above), but a label's actual reach is
  // asymmetric -- wide for a long single-line label, tall for a wrapped
  // multi-line one -- so in an extreme squeeze (many satellites, little
  // vertical room) that approximation can still leave a label spilling
  // above the legend or below the level bar even though the *dot* stayed
  // within the simulation's (also approximate, elliptical) bound. Both draw
  // on top of satellites, so spillover there is a real occlusion, not just
  // crowding. Vertical only, not horizontal too: unlike the legend/level
  // bar, nothing else draws on top of a satellite that drifts horizontally
  // near the viewBox edge, and clamping that axis as well was observed to
  // push satellites on a narrow (portrait) viewport back into the card --
  // trading a real occlusion bug for a worse one.
  //
  // Card clearance is non-negotiable here even though it already holds by
  // construction (resolveSatellitePositions's own minRadius, unlike the
  // safe-area bound, is never capped away -- see its comment): pulling a
  // satellite toward center to dodge the legend must not cost it that
  // clearance again, so each candidate move is checked against the card's
  // exact rectangle -- using this satellite's own known label reach, not
  // the simulation's circular approximation -- before being applied; if it
  // would overlap, the satellite is left where the simulation put it and
  // the (milder, still-legible-at-the-edges) legend spillover stands.
  for (const placement of placements) {
    const pos = positionByConceptId.get(placement.conceptId);
    const footprint = footprintByConceptId.get(placement.conceptId);
    if (!pos || !footprint) continue;
    const aboveCenter = Math.cos(placement.angle) >= 0;
    const y = aboveCenter
      ? Math.max(pos.y, safeTop + footprint.labelBlockReach)
      : Math.min(pos.y, safeBottom - footprint.labelBlockReach);
    if (y === pos.y) continue;

    const labelTop = aboveCenter ? y - footprint.labelBlockReach : y - SATELLITE_NODE_RADIUS;
    const labelBottom = aboveCenter ? y + SATELLITE_NODE_RADIUS : y + footprint.labelBlockReach;
    const labelLeft = pos.x - footprint.halfHitWidth;
    const labelRight = pos.x + footprint.halfHitWidth;
    const overlapsCard =
      labelRight > centerX - cardHalfWidth &&
      labelLeft < centerX + cardHalfWidth &&
      labelBottom > centerY - cardHalfHeight &&
      labelTop < centerY + cardHalfHeight;
    if (!overlapsCard) positionByConceptId.set(placement.conceptId, { x: pos.x, y });
  }

  const svg = d3
    .select(container)
    .append("svg")
    .attr("viewBox", `0 0 ${viewWidth} ${viewHeight}`)
    .attr("class", "concept-map");

  const defs = svg.append("defs");
  for (const familyKey of allFamilyKeys()) {
    defs
      .append("marker")
      .attr("id", markerIdForRelationshipType(familyKey))
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 9)
      .attr("refY", 5)
      .attr("markerWidth", 7)
      .attr("markerHeight", 7)
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("d", "M 0 0 L 10 5 L 0 10 z")
      .attr("fill", colorForRelationshipType(familyKey));

    // A second, separately-sized marker for the legend swatch line: the
    // above marker's default `markerUnits="strokeWidth"` scales it against
    // whatever stroke-width the referencing line uses, which is appropriate
    // for spokes/arcs (2px/1.25px, chosen for the diagram's scale) but makes
    // it oversized against the legend swatch's bolder 3px line -- at 7 units
    // that's a 21px arrowhead nearly swallowing the swatch's own 20px
    // length. `userSpaceOnUse` fixes an absolute size instead, independent
    // of the swatch's stroke-width. `refX` is 0, not 9 like the marker
    // above: that anchors the marker at the *base* of the triangle rather
    // than near its tip, so the whole arrowhead is placed *after* the line's
    // endpoint instead of mostly overlapping it -- at this small a marker
    // size relative to the 3px-thick swatch line, that overlap was enough to
    // blunt the triangle's point into a squared-off blob. The swatch line
    // itself is shortened by LEGEND_ARROW_LENGTH to match, so its stroke
    // stops exactly where this marker's base begins.
    defs
      .append("marker")
      .attr("id", legendMarkerIdForRelationshipType(familyKey))
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 0)
      .attr("refY", 5)
      .attr("markerWidth", LEGEND_ARROW_LENGTH)
      .attr("markerHeight", LEGEND_ARROW_LENGTH)
      .attr("markerUnits", "userSpaceOnUse")
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("d", "M 0 0 L 10 5 L 0 10 z")
      .attr("fill", colorForRelationshipType(familyKey));
  }

  // Arcs/spokes/satellites/center card live in a zoomable+pannable group so
  // mobile users can pinch in on a crowded ring; the legend stays fixed.
  const contentLayer = svg.append("g").attr("class", "content-layer");
  const arcsLayer = contentLayer.append("g").attr("class", "arcs-layer");
  const spokesLayer = contentLayer.append("g").attr("class", "spokes-layer");
  const satellitesLayer = contentLayer.append("g").attr("class", "satellites-layer");
  const centerLayer = contentLayer.append("g").attr("class", "center-layer");
  const legendLayer = svg.append("g").attr("class", "legend-layer");

  const zoomBehavior = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.25, 4])
    .translateExtent([
      [-viewWidth * 0.5, -viewHeight * 0.5],
      [viewWidth * 1.5, viewHeight * 1.5],
    ])
    .on("zoom", (event) => contentLayer.attr("transform", event.transform.toString()));
  svg.call(zoomBehavior);

  // --- Satellite-satellite arcs (drawn first, so they sit behind everything) ---
  for (const rel of satelliteSatelliteRelationships) {
    const angleA = angleByConceptId.get(rel.source);
    const angleB = angleByConceptId.get(rel.target);
    const posA = positionByConceptId.get(rel.source);
    const posB = positionByConceptId.get(rel.target);
    if (angleA === undefined || angleB === undefined || !posA || !posB) continue;

    const diff = normalizedAngleDiff(angleA, angleB);
    const midAngle = angleA + diff / 2;
    const bulgeFactor = 1 + 25 / 300 + (220 / 300) * (Math.abs(diff) / Math.PI);
    // Bulges outward from whichever of the two satellites sits further from
    // the center -- since satellites no longer share one ring (see part B of
    // LAYOUT_UPGRADE.md), this is what keeps the arc routed outside both
    // endpoints instead of cutting back through whichever one sits closer in.
    const outerRadius = Math.max(Math.hypot(posA.x - centerX, posA.y - centerY), Math.hypot(posB.x - centerX, posB.y - centerY));
    const control = pointForAngle(midAngle, outerRadius * bulgeFactor);

    const start = pointTowards(posA, control, SATELLITE_NODE_RADIUS);
    const end = pointTowards(posB, control, SATELLITE_NODE_RADIUS);
    const color = colorForRelationshipType(rel.type);

    arcsLayer
      .append("path")
      .attr("d", `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`)
      .attr("class", "satellite-arc")
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("marker-end", `url(#${markerIdForRelationshipType(rel.type)})`)
      .append("title")
      .text(relationshipTooltip(index, rel.type));
  }

  // --- Spokes from center to each satellite ---
  for (const placement of placements) {
    const satellitePos = positionByConceptId.get(placement.conceptId)!;
    const start = cardExitPoint(satellitePos);
    const end = pointTowards(satellitePos, { x: centerX, y: centerY }, SATELLITE_NODE_RADIUS);
    const color = colorForRelationshipType(placement.edge.relationshipTypeId);

    // The arrowhead is always drawn at the edge's raw stored `target`, and
    // the label/tooltip always use the raw stored `type` (never the inverse
    // `graph.ts` resolves for a backward edge) -- so every edge in a family
    // reads as one true sentence, "source [canonical label] target", no
    // matter which of its two ends happens to be centered. This is what lets
    // `buildLegend` show a single entry per family instead of one per
    // direction.
    const canonicalTypeId = placement.edge.relationship.type;
    const isRawSource = placement.edge.direction === "forward";
    const line = spokesLayer
      .append("line")
      .attr("class", "spoke")
      .attr("x1", start.x)
      .attr("y1", start.y)
      .attr("x2", end.x)
      .attr("y2", end.y)
      .attr("stroke", color);
    if (isRawSource) {
      line.attr("marker-end", `url(#${markerIdForRelationshipType(canonicalTypeId)})`);
    } else {
      line.attr("marker-start", `url(#${markerIdForRelationshipType(canonicalTypeId)})`);
    }
    line.append("title").text(relationshipTooltip(index, canonicalTypeId));
  }

  // --- Satellite nodes ---
  for (const placement of placements) {
    const concept = index.conceptsById.get(placement.conceptId);
    if (!concept) continue;
    const pos = positionByConceptId.get(placement.conceptId)!;
    // Labels sit above satellites in the top half of the ring and below
    // satellites in the bottom half, so they always point outward, away from
    // the card, rather than beside the node (which used to eat into the
    // ring's horizontal radius and left less room to keep satellites clear
    // of the card at diagonal angles).
    const aboveCenter = Math.cos(placement.angle) >= 0;
    const { lines, truncated, halfHitWidth, labelBlockReach, isAcronym } = footprintByConceptId.get(placement.conceptId)!;

    const group = satellitesLayer
      .append("g")
      .attr("class", "satellite")
      .attr("transform", `translate(${pos.x}, ${pos.y})`)
      .style("cursor", "pointer")
      .on("click", () => options.onSelectConcept(placement.conceptId));

    // A generous invisible hit area, sized independently of the visible dot
    // and label, so the tap target stays usable everywhere touch happens
    // (not just directly on the tiny dot or on painted glyph pixels). Grows
    // to cover however many lines the label wrapped onto (halfHitWidth/
    // labelBlockReach were already computed pre-layout -- see
    // computeSatelliteFootprint -- to size this same satellite's collision
    // radius in the force simulation above).
    const hitTop = aboveCenter ? -labelBlockReach : -SATELLITE_HIT_RADIUS;
    const hitBottom = aboveCenter ? SATELLITE_HIT_RADIUS : labelBlockReach;
    group
      .append("rect")
      .attr("x", -halfHitWidth)
      .attr("y", hitTop)
      .attr("width", halfHitWidth * 2)
      .attr("height", hitBottom - hitTop)
      .attr("fill", "transparent")
      .style("pointer-events", "all");

    group
      .append("circle")
      .attr("r", SATELLITE_NODE_RADIUS)
      .attr("fill", colorForRelationshipType(placement.edge.relationshipTypeId));

    const nearGapEm = (SATELLITE_NODE_RADIUS + LABEL_GAP) / SATELLITE_LABEL_FONT_SIZE;
    const text = group.append("text").attr("class", "satellite-label").attr("text-anchor", "middle").attr("x", 0);
    lines.forEach((line, i) => {
      const nearLineOffset = nearGapEm + LABEL_BASELINE_OFFSET_EM;
      const dy =
        i === 0
          ? aboveCenter
            ? -(nearLineOffset + (lines.length - 1) * LABEL_LINE_HEIGHT_EM)
            : nearLineOffset
          : LABEL_LINE_HEIGHT_EM;
      text.append("tspan").attr("x", 0).attr("dy", `${dy}em`).text(line);
    });

    // The full label is included whenever the visible text doesn't already
    // say it in full -- either because it's an acronym standing in for it
    // (isAcronym) or because wrapLabel itself had to truncate (truncated).
    const titleText = isAcronym || truncated ? `${concept.label}\n${concept.description}` : concept.description;
    group.append("title").text(titleText);
  }

  // --- Center card ---
  // Rounded to integer pixels, same reasoning as the shadow rect below.
  const cardX = Math.round(centerX - cardHalfWidth);
  const cardY = Math.round(centerY - cardHalfHeight);
  const cardWidth = Math.round(cardHalfWidth * 2);
  const cardHeight = Math.round(cardHalfHeight * 2);

  // Drawn as a genuine SVG rect, not a CSS box-shadow on the HTML card: a
  // box-shadow on an element painted inside an SVG foreignObject does not
  // reliably respect that element's own border-radius in Chromium/WebKit --
  // the shadow's corners come out sharp instead of following the curve. An
  // SVG rect with matching rx/ry, blurred via a CSS filter, doesn't have that
  // problem because the rounding is baked into the shape being blurred
  // rather than negotiated between two independent paint passes.
  centerLayer
    .append("rect")
    .attr("class", "center-card-shadow")
    .attr("x", cardX)
    .attr("y", cardY)
    .attr("width", cardWidth)
    .attr("height", cardHeight)
    .attr("rx", CARD_CORNER_RADIUS)
    .attr("ry", CARD_CORNER_RADIUS);

  const foreignObject = centerLayer
    .append("foreignObject")
    .attr("x", cardX)
    .attr("y", cardY)
    .attr("width", cardWidth)
    .attr("height", cardHeight);
  buildCenterCard(foreignObject, centerConcept, options);

  // Two independent ways the card can be clipping its own content, so both
  // need checking: the description's own -webkit-line-clamp (its box is
  // already sized to exactly the clamped height by the time it's laid out --
  // the card around it is sized to match via measureCenterCardHeight, so
  // *that* box never sees an overflow; only the paragraph's own scrollHeight
  // vs. clientHeight exposes the text hidden past the clamp), and -- on a
  // short viewport -- the card's own fixed height (cardHalfHeightCeiling
  // above) clipping into content that wasn't clamped internally at all.
  // Where either is true, tap opens the full text in a popover instead.
  const cardNode = foreignObject.select<HTMLDivElement>(".center-card").node();
  const descriptionNode = foreignObject.select<HTMLParagraphElement>(".center-card-description").node();
  const isTruncated =
    !!descriptionNode &&
    (descriptionNode.scrollHeight > descriptionNode.clientHeight + 1 ||
      (!!cardNode && cardNode.scrollHeight > cardNode.clientHeight + 1));
  if (isTruncated && descriptionNode) {
    d3.select(descriptionNode)
      .classed("center-card-description--truncated", true)
      .attr("tabindex", "0")
      .attr("role", "button")
      .attr("aria-label", "Show full description")
      .on("click", () => showDescriptionPopover(container, centerConcept))
      .on("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          showDescriptionPopover(container, centerConcept);
        }
      });
  }

  // --- Legend ---
  const legendGroup = legendLayer.attr("transform", `translate(${LEGEND_MARGIN + legendLeftInset}, ${legendY})`);
  legendGroup
    .append("rect")
    .attr("class", "legend-background")
    .attr("width", legendAvailableWidth)
    .attr("height", legendHeight)
    .attr("rx", 6);
  legendPlacements.forEach(({ entry, x, row }) => {
    const cell = legendGroup.append("g").attr("transform", `translate(${10 + x}, ${16 + row * LEGEND_ROW_HEIGHT})`);
    cell
      .append("line")
      .attr("x1", 0)
      .attr("x2", LEGEND_SWATCH_WIDTH - LEGEND_ARROW_LENGTH)
      .attr("y1", 0)
      .attr("y2", 0)
      .attr("stroke", entry.color)
      .attr("stroke-width", 3)
      .attr("marker-end", `url(#${entry.markerId})`);
    cell
      .append("text")
      .attr("class", "legend-label")
      .attr("x", LEGEND_SWATCH_WIDTH + LEGEND_TEXT_GAP)
      .attr("dy", "0.32em")
      .text(entry.label);
  });

  return viewResult(counts, legendHeight, searchSharesRow);
}

function renderError(container: HTMLElement, message: string): void {
  const wrapper = document.createElement("div");
  wrapper.className = "concept-error";

  const messageEl = document.createElement("p");
  messageEl.className = "concept-error-message";
  messageEl.textContent = message;

  const hint = document.createElement("p");
  hint.className = "concept-error-hint";
  hint.textContent = "Try searching for a known concept using the search bar above.";

  wrapper.append(messageEl, hint);
  container.appendChild(wrapper);
}

const SORTED_CONCEPT_KINDS = [...CONCEPT_KINDS].sort((a, b) =>
  humanizeSnakeCase(a).localeCompare(humanizeSnakeCase(b)),
);

/**
 * A vertical nav list of clickable items, used for the kind sidebar in
 * `renderKindList`. `emptyAtLevel` entries (no associated concept visible at
 * the current audience level) render in faint text as a hint of that, same
 * as an out-of-level search match, but stay clickable like every other
 * entry: selecting one still navigates there and shows its own "no concepts
 * at this level" message in the content pane.
 */
function buildSidebar<T extends string>(
  entries: T[],
  activeEntry: T | null,
  emptyAtLevel: ReadonlySet<T>,
  onSelect: (entry: T) => void,
): HTMLUListElement {
  const sidebar = document.createElement("ul");
  sidebar.className = "browser-sidebar";
  for (const entry of entries) {
    const item = document.createElement("li");
    item.className = "browser-sidebar-item";
    if (entry === activeEntry) {
      item.classList.add("is-active");
    }
    if (emptyAtLevel.has(entry)) {
      item.classList.add("is-empty-at-level");
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "browser-sidebar-button";
    button.textContent = humanizeSnakeCase(entry);
    button.addEventListener("click", () => onSelect(entry));

    item.appendChild(button);
    sidebar.appendChild(item);
  }
  return sidebar;
}

/** A vertical list of concept names (canonical labels only), used by both browser views. */
function buildConceptList(
  concepts: Concept[],
  hiliteConceptId: string | null,
  onSelectConcept: (conceptId: string) => void,
): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "concept-list-items";
  for (const concept of concepts) {
    const item = document.createElement("li");
    item.className = "concept-list-item";
    if (concept.id === hiliteConceptId) {
      item.classList.add("is-hilited");
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "concept-list-item-button";
    button.textContent = concept.label;
    button.addEventListener("click", () => onSelectConcept(concept.id));

    item.appendChild(button);
    list.appendChild(item);
  }
  return list;
}

/**
 * The two-pane view shown when the center card's "kind" badge is clicked: a
 * sidebar listing every defined kind (highlighting the current one), and an
 * alphabetical listing of every concept sharing the selected kind. `kind ===
 * ""` (the `?kind` param present but empty) shows the sidebar with nothing
 * selected and no concept list. A non-empty `kind` that isn't a real
 * `ConceptKind` is treated as an error instead -- there's no sensible sidebar
 * selection state for it.
 */
export function renderKindList(
  container: HTMLElement,
  index: GraphIndex,
  kind: string,
  hiliteConceptId: string | null,
  level: number,
  options: RenderOptions,
): ViewResult {
  container.innerHTML = "";

  if (kind !== "" && !CONCEPT_KINDS.includes(kind as ConceptKind)) {
    renderError(container, `Unknown kind: "${kind}"`);
    return EMPTY_VIEW_RESULT;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "browser-view";

  const kindsWithConceptsAtLevel = new Set<ConceptKind>();
  for (const concept of index.conceptsById.values()) {
    if (concept.audience_level <= level) kindsWithConceptsAtLevel.add(concept.kind);
  }
  const emptyKinds = new Set(SORTED_CONCEPT_KINDS.filter((k) => !kindsWithConceptsAtLevel.has(k)));

  wrapper.appendChild(
    buildSidebar(
      SORTED_CONCEPT_KINDS,
      kind === "" ? null : (kind as ConceptKind),
      emptyKinds,
      options.onSwitchKind,
    ),
  );

  const content = document.createElement("div");
  content.className = "browser-content";

  let counts: LevelCounts = EMPTY_LEVEL_COUNTS;
  if (kind !== "") {
    const allConcepts = [...index.conceptsById.values()].filter((concept) => concept.kind === kind);
    counts = computeLevelCounts(allConcepts);
    const concepts = allConcepts
      .filter((concept) => concept.audience_level <= level)
      .sort((a, b) => a.label.localeCompare(b.label));

    if (concepts.length === 0) {
      const empty = document.createElement("p");
      empty.className = "concept-list-empty";
      empty.textContent =
        allConcepts.length === 0 ? "No concepts of this kind yet." : "No concepts of this kind at this audience level.";
      content.appendChild(empty);
    } else {
      content.appendChild(buildConceptList(concepts, hiliteConceptId, options.onSelectConcept));
    }
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
  return viewResult(counts);
}

/**
 * The word cloud shown when an acronym badge on the center card is clicked.
 * The layout itself -- every acronym's position and font size, font-sized by
 * its concept's graph degree -- is precomputed offline per cumulative
 * audience level by scripts/build-data.ts (see AcronymCloudLevel in
 * types.ts) rather than packed on the fly; this function only scales that
 * fixed arrangement to fit the live viewport and colors/highlights it. `tla`
 * (non-empty) highlights the matching acronym; `?tla` with no value shows
 * the cloud with nothing highlighted. A non-empty `tla` that matches no
 * acronym anywhere in the dataset is an error, same as an unrecognized kind.
 */
export function renderAcronymCloud(
  container: HTMLElement,
  index: GraphIndex,
  tla: string,
  level: number,
  options: RenderOptions,
): ViewResult {
  container.innerHTML = "";

  // Level 5 is cumulative over every audience_level, so its word list is
  // already the full universe of acronyms -- no separate "all words" list
  // needs to be stored.
  const allWords = index.acronymCloudsByLevel.get(5)!.words;

  const tlaLower = tla.toLowerCase();
  if (tla !== "" && !allWords.some((word) => word.text.toLowerCase() === tlaLower)) {
    renderError(container, `Unknown acronym: "${tla}"`);
    return EMPTY_VIEW_RESULT;
  }

  const counts = computeLevelCounts(
    allWords.flatMap((word) => {
      const concept = index.conceptsById.get(word.conceptId);
      return concept ? [concept] : [];
    }),
  );

  const cloudLevel = index.acronymCloudsByLevel.get(level)!;
  if (cloudLevel.words.length === 0) {
    const empty = document.createElement("p");
    empty.className = "concept-list-empty";
    empty.textContent = "No acronyms at this audience level.";
    container.appendChild(empty);
    return viewResult(counts);
  }

  // Sized from the container's actual pixels (like the main diagram), so the
  // precomputed cloud below scales to fill whatever space is actually
  // available rather than a fixed constant.
  const containerRect = container.getBoundingClientRect();
  const viewWidth = containerRect.width || window.innerWidth;
  const viewHeight = containerRect.height || window.innerHeight;
  const isCompactLandscape = viewWidth > viewHeight && viewHeight <= LANDSCAPE_COMPACT_MAX_HEIGHT;
  const usableWidth = viewWidth - (isCompactLandscape ? RIGHT_SAFE_AREA_LANDSCAPE : 0);
  const safeTop = TOP_SAFE_AREA;
  const safeBottom = viewHeight - (isCompactLandscape ? VIEW_MARGIN : BOTTOM_SAFE_AREA);
  const centerX = usableWidth / 2;
  const centerY = (safeTop + safeBottom) / 2;
  const safeWidth = usableWidth - VIEW_MARGIN * 2;
  const safeHeight = safeBottom - safeTop - VIEW_MARGIN * 2;
  // The precomputed arrangement never changes shape -- only this scale factor
  // adapts it to the current viewport, the same "fixed content, responsive
  // viewBox" idiom the rest of this file uses for the main diagram.
  const scale = Math.min(safeWidth / cloudLevel.width, safeHeight / cloudLevel.height);

  const fontSizes = cloudLevel.words.map((word) => word.fontSize);
  const minFontSize = Math.min(...fontSizes);
  const maxFontSize = Math.max(...fontSizes);

  const svg = d3
    .select(container)
    .append("svg")
    .attr("viewBox", `0 0 ${viewWidth} ${viewHeight}`)
    .attr("class", "acronym-cloud");

  svg
    .append("g")
    .attr("transform", `translate(${centerX}, ${centerY}) scale(${scale})`)
    .selectAll("text")
    .data(cloudLevel.words)
    .join("text")
    .attr("class", (word) => (word.text.toLowerCase() === tlaLower ? "acronym-word is-hilited" : "acronym-word"))
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    // The hilite's size bump has to live in this attribute rather than a CSS
    // `transform: scale(...)` rule -- CSS transform on an SVG element wins
    // outright over the transform *attribute* instead of composing with it,
    // which would drop this translate(x, y) entirely and collapse the word
    // to the cloud's origin.
    .attr("transform", (word) =>
      word.text.toLowerCase() === tlaLower
        ? `translate(${word.x}, ${word.y}) scale(1.15)`
        : `translate(${word.x}, ${word.y})`,
    )
    .style("font-size", (word) => `${word.fontSize}px`)
    .style("fill", (word) => colorForAcronymWord(level, word.fontSize, minFontSize, maxFontSize))
    .text((word) => word.text)
    .on("click", (_event, word) => options.onSelectConcept(word.conceptId))
    .append("title")
    .text((word) => index.conceptsById.get(word.conceptId)?.label ?? word.conceptId);

  return viewResult(counts);
}

function relationshipTooltip(index: GraphIndex, relationshipTypeId: string): string {
  return index.relationshipTypesById.get(relationshipTypeId)?.label ?? relationshipTypeId;
}

/** Turns a snake_case schema value (a `kind`) into display text. */
function humanizeSnakeCase(value: string): string {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
