import * as d3 from "d3";
import cloud from "d3-cloud";
import { computeLevelCounts, getSatelliteSatelliteRelationships, type GraphIndex, type LevelCounts } from "./graph.js";
import { computeRadialLayout } from "./layout.js";
import {
  allFamilyKeys,
  buildLegend,
  colorForRelationshipType,
  familyKeyForRelationshipType,
  markerIdForRelationshipType,
} from "./style.js";
import { CONCEPT_KINDS, type Concept, type ConceptKind } from "./types.js";

const CARD_WIDTH = 300;
const CARD_HEIGHT = 210;
// The card never needs to be wider/taller than about a third of the screen or
// the space actually available between the fixed bars -- letting it shrink
// there leaves room for the ring and satellite labels beside it, instead of
// the ring (or the card itself) being squeezed against/behind those bars.
const CARD_MIN_HALF_WIDTH = 110;
const CARD_MIN_HALF_HEIGHT = 70;
// Minimum gap between the (possibly shrunk) card's edge and the ring.
const RADIUS_CLEARANCE = 12;
const SATELLITE_NODE_RADIUS = 9;
// Invisible tap-target padding around each satellite, sized independently of
// the visible dot -- this is real CSS-pixel size (see viewBox note below), so
// it stays close to the ~44px minimum recommended touch target on every
// device instead of shrinking along with the visual layout.
const SATELLITE_HIT_RADIUS = 22;
const SATELLITE_HIT_HEIGHT = 32;
const LABEL_GAP = 6;
// A label wraps onto at most this many lines (breaking on word boundaries)
// before the remainder gets truncated with an ellipsis -- lets narrow screens
// show roughly twice the characters per satellite without needing per-satellite
// vertical spacing (not currently modeled by the layout) to grow indefinitely.
const MAX_LABEL_LINES = 2;
const LABEL_LINE_HEIGHT_EM = 1.1;
// Matches .satellite-label's font-size in em terms above; only used to grow
// the invisible hit area to cover a second line, not for precise text layout.
const LABEL_LINE_HEIGHT_PX = 13;
const EMPTY_LEVEL_COUNTS: LevelCounts = [0, 0, 0, 0, 0];
// Rough average glyph width (px) for the 12px sans-serif label font -- used only
// to size label allowances and truncation, not for precise text layout.
const CHAR_WIDTH_ESTIMATE = 6.6;
const VIEW_MARGIN = 24;
// Never truncate a satellite label shorter than this many characters (plus an
// ellipsis), even on the narrowest screens -- a name that short stops being
// useful for telling satellites apart.
const MIN_LABEL_CHARS = 4;
// The search bar (top) and level bar (bottom) are fixed overlays on every
// view; the diagram lays out in the space between them, not underneath.
const TOP_SAFE_AREA = 84;
const BOTTOM_SAFE_AREA = 96;
// Caps how tall/narrow the satellite ellipse can get on extreme aspect ratios
// (e.g. a very short landscape phone), so it doesn't stretch absurdly.
const MAX_RADIUS_Y_RATIO = 2.4;

const ACRONYM_CLOUD_MIN_SIZE = 240;
const ACRONYM_CLOUD_MIN_FONT = 16;
const ACRONYM_CLOUD_MAX_FONT = 72;
const ACRONYM_CLOUD_PADDING = 6;

export interface RenderOptions {
  onSelectConcept: (conceptId: string) => void;
  onSelectKind: (kind: ConceptKind, conceptId: string) => void;
  onSwitchKind: (kind: ConceptKind) => void;
  onSelectAttribute: (attributeKey: string, conceptId: string) => void;
  onSwitchAttribute: (attributeKey: string) => void;
  onSelectAcronym: (acronym: string, conceptId: string) => void;
}

interface Point {
  x: number;
  y: number;
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

export function render(
  container: HTMLElement,
  index: GraphIndex,
  centerId: string,
  level: number,
  options: RenderOptions,
): LevelCounts {
  container.innerHTML = "";

  const centerConcept = index.conceptsById.get(centerId);
  if (!centerConcept) {
    renderError(container, `Unknown concept: "${centerId}"`);
    return EMPTY_LEVEL_COUNTS;
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
  const centerX = viewWidth / 2;

  // The legend sits top-left, directly above where a satellite near the "top"
  // of the ring would otherwise land (the ring is horizontally centered, and
  // the legend is wide enough to reach past center on narrow screens) -- so
  // the ring's own safe area starts below the legend, not just below the
  // search bar. The plain search-bar-only offset is still used for the
  // legend's own position, below.
  const legendEntries = buildLegend(index.relationshipTypesById).filter(
    (entry) =>
      edges.some((e) => familyKeyForRelationshipType(e.relationshipTypeId) === entry.familyKey) ||
      satelliteSatelliteRelationships.some((r) => familyKeyForRelationshipType(r.type) === entry.familyKey),
  );
  const legendHeight = legendEntries.length > 0 ? legendEntries.length * 20 + 12 : 0;

  // Center vertically within the space between the legend/search bar and the
  // level bar, not the full viewport, so the ring never lays out underneath
  // any of them.
  const safeTop = TOP_SAFE_AREA + legendHeight + (legendHeight > 0 ? 16 : 0);
  const safeBottom = viewHeight - BOTTOM_SAFE_AREA;
  const centerY = (safeTop + safeBottom) / 2;

  const cardHalfWidth = Math.min(CARD_WIDTH / 2, Math.max(CARD_MIN_HALF_WIDTH, viewWidth * 0.28));
  const availableHeightBand = Math.max(0, safeBottom - safeTop);
  const cardHalfHeight = Math.min(CARD_HEIGHT / 2, Math.max(CARD_MIN_HALF_HEIGHT, availableHeightBand * 0.28));
  const minRadiusX = cardHalfWidth + RADIUS_CLEARANCE;
  const minRadiusY = cardHalfHeight + RADIUS_CLEARANCE;

  // Longest label sets how much horizontal room satellites need beyond the
  // ring itself; clamp it so a very long label (or a narrow screen) shrinks
  // the *label*, via truncation, rather than shrinking the whole ring.
  const availableHalfWidth = viewWidth / 2 - VIEW_MARGIN;
  const maxLabelAllowance = Math.max(
    MIN_LABEL_CHARS * CHAR_WIDTH_ESTIMATE,
    availableHalfWidth - SATELLITE_NODE_RADIUS - LABEL_GAP - minRadiusX,
  );
  const maxLabelLength = placements.reduce((max, p) => {
    const label = index.conceptsById.get(p.conceptId)?.label ?? "";
    return Math.max(max, label.length);
  }, 0);
  const labelAllowance = Math.min(maxLabelLength * CHAR_WIDTH_ESTIMATE, maxLabelAllowance);
  const maxLabelChars = Math.max(MIN_LABEL_CHARS, Math.floor(labelAllowance / CHAR_WIDTH_ESTIMATE));

  const radiusX = Math.max(minRadiusX, availableHalfWidth - SATELLITE_NODE_RADIUS - LABEL_GAP - labelAllowance);
  const availableHalfHeight = Math.max(0, safeBottom - safeTop) / 2 - VIEW_MARGIN;
  const radiusY = Math.min(Math.max(minRadiusY, availableHalfHeight), radiusX * MAX_RADIUS_Y_RATIO);

  const pointForAngle = (angle: number, radiusX: number, radiusY: number): Point => ({
    x: centerX + radiusX * Math.sin(angle),
    y: centerY - radiusY * Math.cos(angle),
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
  const positionByConceptId = new Map(
    placements.map((p) => [p.conceptId, pointForAngle(p.angle, radiusX, radiusY)]),
  );

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
    .scaleExtent([1, 4])
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
    const control = pointForAngle(midAngle, radiusX * bulgeFactor, radiusY * bulgeFactor);

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
    const isForward = placement.edge.direction === "forward";

    const line = spokesLayer
      .append("line")
      .attr("class", "spoke")
      .attr("x1", start.x)
      .attr("y1", start.y)
      .attr("x2", end.x)
      .attr("y2", end.y)
      .attr("stroke", color);
    if (isForward) {
      line.attr("marker-end", `url(#${markerIdForRelationshipType(placement.edge.relationshipTypeId)})`);
    } else {
      line.attr("marker-start", `url(#${markerIdForRelationshipType(placement.edge.relationshipTypeId)})`);
    }
    line.append("title").text(relationshipTooltip(index, placement.edge.relationshipTypeId));
  }

  // --- Satellite nodes ---
  for (const placement of placements) {
    const concept = index.conceptsById.get(placement.conceptId);
    if (!concept) continue;
    const pos = positionByConceptId.get(placement.conceptId)!;
    const rightHalf = Math.sin(placement.angle) >= 0;
    const { lines, truncated } = wrapLabel(concept.label, maxLabelChars);

    const group = satellitesLayer
      .append("g")
      .attr("class", "satellite")
      .attr("transform", `translate(${pos.x}, ${pos.y})`)
      .style("cursor", "pointer")
      .on("click", () => options.onSelectConcept(placement.conceptId));

    // A generous invisible hit area, sized independently of the visible dot
    // and label, so the tap target stays usable everywhere touch happens
    // (not just directly on the tiny dot or on painted glyph pixels). Grows
    // taller when the label wraps to a second line.
    const longestLineLength = Math.max(...lines.map((line) => line.length));
    const labelPixelWidth = longestLineLength * CHAR_WIDTH_ESTIMATE;
    const farReach = SATELLITE_NODE_RADIUS + LABEL_GAP + labelPixelWidth + SATELLITE_HIT_RADIUS / 2;
    const hitLeft = rightHalf ? -SATELLITE_HIT_RADIUS : -farReach;
    const hitRight = rightHalf ? farReach : SATELLITE_HIT_RADIUS;
    const hitHeight = SATELLITE_HIT_HEIGHT + (lines.length - 1) * LABEL_LINE_HEIGHT_PX;
    group
      .append("rect")
      .attr("x", hitLeft)
      .attr("y", -hitHeight / 2)
      .attr("width", hitRight - hitLeft)
      .attr("height", hitHeight)
      .attr("fill", "transparent")
      .style("pointer-events", "all");

    group
      .append("circle")
      .attr("r", SATELLITE_NODE_RADIUS)
      .attr("fill", colorForRelationshipType(placement.edge.relationshipTypeId));

    const labelX = rightHalf ? SATELLITE_NODE_RADIUS + LABEL_GAP : -(SATELLITE_NODE_RADIUS + LABEL_GAP);
    const text = group
      .append("text")
      .attr("class", "satellite-label")
      .attr("text-anchor", rightHalf ? "start" : "end")
      .attr("x", labelX);
    lines.forEach((line, i) => {
      const dy = i === 0 ? 0.32 - ((lines.length - 1) * LABEL_LINE_HEIGHT_EM) / 2 : LABEL_LINE_HEIGHT_EM;
      text.append("tspan").attr("x", labelX).attr("dy", `${dy}em`).text(line);
    });

    const titleText = truncated ? `${concept.label}\n${concept.description}` : concept.description;
    group.append("title").text(titleText);
  }

  // --- Center card ---
  const foreignObject = centerLayer
    .append("foreignObject")
    .attr("x", centerX - cardHalfWidth)
    .attr("y", centerY - cardHalfHeight)
    .attr("width", cardHalfWidth * 2)
    .attr("height", cardHalfHeight * 2);
  const card = foreignObject.append("xhtml:div").attr("class", "center-card");
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

  const displayableAttributes = Object.entries(centerConcept.attributes ?? {}).filter(
    (entry): entry is [string, AttributeDisplayValue] => isDisplayableAttributeValue(entry[1]),
  );
  if (displayableAttributes.length > 0) {
    const attributesRow = card.append("div").attr("class", "center-card-attributes");
    displayableAttributes.forEach(([key, value], i) => {
      if (i > 0) attributesRow.append("span").attr("class", "dot-separator").text(" · ");
      attributesRow
        .append("span")
        .attr("class", `attribute attribute-${value}`)
        .text(humanizeSnakeCase(key))
        .on("click", () => options.onSelectAttribute(key, centerConcept.id));
    });
  }

  // --- Legend ---
  const legendGroup = legendLayer.attr("transform", `translate(16, ${TOP_SAFE_AREA})`);
  legendGroup
    .append("rect")
    .attr("class", "legend-background")
    .attr("width", 240)
    .attr("height", legendHeight)
    .attr("rx", 6);
  legendEntries.forEach((entry, i) => {
    const row = legendGroup.append("g").attr("transform", `translate(10, ${16 + i * 20})`);
    row
      .append("line")
      .attr("x1", 0)
      .attr("x2", 20)
      .attr("y1", 0)
      .attr("y2", 0)
      .attr("stroke", entry.color)
      .attr("stroke-width", 3);
    row.append("text").attr("class", "legend-label").attr("x", 28).attr("dy", "0.32em").text(entry.label);
  });

  return counts;
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

/** A vertical nav list of clickable items, used for both the kind and attribute sidebars. */
function buildSidebar<T extends string>(
  side: "left" | "right",
  entries: T[],
  activeEntry: T | null,
  onSelect: (entry: T) => void,
): HTMLUListElement {
  const sidebar = document.createElement("ul");
  sidebar.className = `browser-sidebar browser-sidebar--${side}`;
  for (const entry of entries) {
    const item = document.createElement("li");
    item.className = "browser-sidebar-item";
    if (entry === activeEntry) {
      item.classList.add("is-active");
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
): LevelCounts {
  container.innerHTML = "";

  if (kind !== "" && !CONCEPT_KINDS.includes(kind as ConceptKind)) {
    renderError(container, `Unknown kind: "${kind}"`);
    return EMPTY_LEVEL_COUNTS;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "browser-view";

  wrapper.appendChild(
    buildSidebar("left", SORTED_CONCEPT_KINDS, kind === "" ? null : (kind as ConceptKind), options.onSwitchKind),
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
  return counts;
}

const FREQUENCY_VALUE_ORDER = ["always", "usually", "sometimes", "rarely", "never"];

/** Frequency-like values (always/usually/.../never) sort first in that fixed order; anything else follows alphabetically. */
function compareAttributeValues(a: string, b: string): number {
  const indexA = FREQUENCY_VALUE_ORDER.indexOf(a.toLowerCase());
  const indexB = FREQUENCY_VALUE_ORDER.indexOf(b.toLowerCase());
  if (indexA !== -1 && indexB !== -1) return indexA - indexB;
  if (indexA !== -1) return -1;
  if (indexB !== -1) return 1;
  return a.localeCompare(b);
}

function collectAttributeKeys(index: GraphIndex): string[] {
  const keys = new Set<string>();
  for (const concept of index.conceptsById.values()) {
    for (const key of Object.keys(concept.attributes ?? {})) {
      keys.add(key);
    }
  }
  return [...keys].sort((a, b) => humanizeSnakeCase(a).localeCompare(humanizeSnakeCase(b)));
}

/**
 * The two-pane view shown when an attribute badge on the center card is
 * clicked: on the left, every concept that declares `attributeKey`, grouped
 * by the value they declare it with; on the right, a sidebar listing every
 * attribute key found anywhere in the data (highlighting the current one).
 * Sides are swapped relative to `renderKindList` so the two views read as
 * visibly distinct. `attributeKey === ""` shows the sidebar only. Unlike
 * `kind`, there's no schema enum of valid attribute keys to fall back on, so
 * any key that isn't actually used by some concept is simply unknown.
 */
export function renderAttributeBrowser(
  container: HTMLElement,
  index: GraphIndex,
  attributeKey: string,
  hiliteConceptId: string | null,
  level: number,
  options: RenderOptions,
): LevelCounts {
  container.innerHTML = "";

  const allAttributeKeys = collectAttributeKeys(index);

  if (attributeKey !== "" && !allAttributeKeys.includes(attributeKey)) {
    renderError(container, `Unknown attribute: "${attributeKey}"`);
    return EMPTY_LEVEL_COUNTS;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "browser-view";

  const content = document.createElement("div");
  content.className = "browser-content";

  let counts: LevelCounts = EMPTY_LEVEL_COUNTS;
  if (attributeKey !== "") {
    const allConcepts = [...index.conceptsById.values()].filter(
      (concept) => concept.attributes?.[attributeKey] !== undefined,
    );
    counts = computeLevelCounts(allConcepts);

    const conceptsByValue = new Map<string, Concept[]>();
    for (const concept of allConcepts) {
      if (concept.audience_level > level) continue;
      const valueKey = String(concept.attributes![attributeKey]);
      const bucket = conceptsByValue.get(valueKey);
      if (bucket) bucket.push(concept);
      else conceptsByValue.set(valueKey, [concept]);
    }

    const sortedValueKeys = [...conceptsByValue.keys()].sort(compareAttributeValues);
    for (const valueKey of sortedValueKeys) {
      const concepts = conceptsByValue.get(valueKey)!.sort((a, b) => a.label.localeCompare(b.label));

      const group = document.createElement("div");
      group.className = "attr-value-group";

      const heading = document.createElement("h2");
      heading.className = "attr-value-group-heading";
      heading.textContent = humanizeSnakeCase(valueKey);
      group.appendChild(heading);

      group.appendChild(buildConceptList(concepts, hiliteConceptId, options.onSelectConcept));
      content.appendChild(group);
    }

    if (allConcepts.length > 0 && conceptsByValue.size === 0) {
      const empty = document.createElement("p");
      empty.className = "concept-list-empty";
      empty.textContent = "No concepts with this attribute at this audience level.";
      content.appendChild(empty);
    }
  }

  wrapper.appendChild(content);
  wrapper.appendChild(
    buildSidebar("right", allAttributeKeys, attributeKey === "" ? null : attributeKey, options.onSwitchAttribute),
  );
  container.appendChild(wrapper);
  return counts;
}

interface AcronymWord {
  text: string;
  conceptId: string;
  size: number;
  x?: number;
  y?: number;
  rotate?: number;
}

/**
 * The word cloud shown when an acronym badge on the center card is clicked:
 * every acronym in the dataset, font-sized by its concept's relationship
 * count (graph degree) and linking to that concept. `tla` (non-empty)
 * highlights the matching acronym; `?tla` with no value shows the cloud with
 * nothing highlighted. A non-empty `tla` that matches no acronym is an error,
 * same as an unrecognized kind or attribute.
 */
export function renderAcronymCloud(
  container: HTMLElement,
  index: GraphIndex,
  tla: string,
  level: number,
  options: RenderOptions,
): LevelCounts {
  container.innerHTML = "";

  const allWords: AcronymWord[] = [];
  for (const concept of index.conceptsById.values()) {
    const degree = index.adjacency.get(concept.id)?.length ?? 0;
    for (const acronym of concept.acronyms ?? []) {
      allWords.push({ text: acronym, conceptId: concept.id, size: degree });
    }
  }

  const tlaLower = tla.toLowerCase();
  if (tla !== "" && !allWords.some((word) => word.text.toLowerCase() === tlaLower)) {
    renderError(container, `Unknown acronym: "${tla}"`);
    return EMPTY_LEVEL_COUNTS;
  }

  const counts = computeLevelCounts(
    allWords.flatMap((word) => {
      const concept = index.conceptsById.get(word.conceptId);
      return concept ? [concept] : [];
    }),
  );

  const words = allWords.filter((word) => (index.conceptsById.get(word.conceptId)?.audience_level ?? 0) <= level);
  if (words.length === 0) {
    const empty = document.createElement("p");
    empty.className = "concept-list-empty";
    empty.textContent = "No acronyms at this audience level.";
    container.appendChild(empty);
    return counts;
  }

  // Sized from the container's actual pixels (like the main diagram), rather
  // than a fixed landscape-shaped canvas, so a portrait phone gets a tall
  // cloud instead of a small band with most of the screen left empty.
  const containerRect = container.getBoundingClientRect();
  const viewWidth = containerRect.width || window.innerWidth;
  const viewHeight = containerRect.height || window.innerHeight;
  const safeTop = TOP_SAFE_AREA;
  const safeBottom = viewHeight - BOTTOM_SAFE_AREA;
  const centerY = (safeTop + safeBottom) / 2;
  const cloudWidth = Math.max(ACRONYM_CLOUD_MIN_SIZE, viewWidth - VIEW_MARGIN * 2);
  const cloudHeight = Math.max(ACRONYM_CLOUD_MIN_SIZE, safeBottom - safeTop - VIEW_MARGIN * 2);

  const degrees = words.map((word) => word.size);
  const fontScale = d3
    .scaleSqrt()
    .domain([Math.min(...degrees), Math.max(...degrees)])
    .range([ACRONYM_CLOUD_MIN_FONT, ACRONYM_CLOUD_MAX_FONT]);
  for (const word of words) {
    word.size = fontScale(word.size);
  }

  cloud<AcronymWord>()
    .size([cloudWidth, cloudHeight])
    .words(words)
    .padding(ACRONYM_CLOUD_PADDING)
    .rotate(0)
    .font("sans-serif")
    .fontSize((word) => word.size)
    .on("end", (placedWords) => {
      const svg = d3
        .select(container)
        .append("svg")
        .attr("viewBox", `0 0 ${viewWidth} ${viewHeight}`)
        .attr("class", "acronym-cloud");

      svg
        .append("g")
        .attr("transform", `translate(${viewWidth / 2}, ${centerY})`)
        .selectAll("text")
        .data(placedWords)
        .join("text")
        .attr("class", (word) => (word.text.toLowerCase() === tlaLower ? "acronym-word is-hilited" : "acronym-word"))
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .attr("transform", (word) => `translate(${word.x}, ${word.y})`)
        .style("font-size", (word) => `${word.size}px`)
        .text((word) => word.text)
        .on("click", (_event, word) => options.onSelectConcept(word.conceptId))
        .append("title")
        .text((word) => index.conceptsById.get(word.conceptId)?.label ?? word.conceptId);
    })
    .start();

  return counts;
}

function relationshipTooltip(index: GraphIndex, relationshipTypeId: string): string {
  return index.relationshipTypesById.get(relationshipTypeId)?.label ?? relationshipTypeId;
}

type AttributeDisplayValue = "always" | "usually" | "sometimes";

function isDisplayableAttributeValue(value: unknown): value is AttributeDisplayValue {
  return value === "always" || value === "usually" || value === "sometimes";
}

/** Turns a snake_case schema value (a `kind` or an attribute key) into display text. */
function humanizeSnakeCase(value: string): string {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
