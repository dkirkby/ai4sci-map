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

const BASE_VIEW_SIZE = 1000;
const RING_RADIUS = 300;
const SATELLITE_NODE_RADIUS = 9;
const CARD_WIDTH = 300;
const CARD_HEIGHT = 210;
const CARD_HALF_WIDTH = CARD_WIDTH / 2;
const CARD_HALF_HEIGHT = CARD_HEIGHT / 2;
const LABEL_GAP = 6;
const EMPTY_LEVEL_COUNTS: LevelCounts = [0, 0, 0, 0, 0];
// Rough average glyph width (px) for the 12px sans-serif label font -- used only
// to size the viewBox generously enough that satellite labels never clip against
// its edge, not for precise text layout.
const CHAR_WIDTH_ESTIMATE = 6.6;
const VIEW_MARGIN = 24;

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

  // Size the viewBox generously enough that even the longest satellite label
  // (label lengths vary a lot across this dataset, e.g. "Reinforcement learning
  // from human feedback") stays within it -- otherwise the SVG viewBox clips it.
  const maxLabelLength = placements.reduce((max, p) => {
    const label = index.conceptsById.get(p.conceptId)?.label ?? "";
    return Math.max(max, label.length);
  }, 0);
  const labelAllowance = maxLabelLength * CHAR_WIDTH_ESTIMATE;
  const requiredHalfSize =
    RING_RADIUS + SATELLITE_NODE_RADIUS + LABEL_GAP + labelAllowance + VIEW_MARGIN;
  const viewSize = Math.max(BASE_VIEW_SIZE, requiredHalfSize * 2);
  const center = viewSize / 2;

  const pointForAngle = (angle: number, radius: number): Point => ({
    x: center + radius * Math.sin(angle),
    y: center - radius * Math.cos(angle),
  });

  /** Where a ray from the card center toward `to` exits the center card's rectangle. */
  const cardExitPoint = (to: Point): Point => {
    const dx = to.x - center;
    const dy = to.y - center;
    const tx = dx === 0 ? Infinity : CARD_HALF_WIDTH / Math.abs(dx);
    const ty = dy === 0 ? Infinity : CARD_HALF_HEIGHT / Math.abs(dy);
    const t = Math.min(tx, ty);
    return { x: center + dx * t, y: center + dy * t };
  };

  const angleByConceptId = new Map(placements.map((p) => [p.conceptId, p.angle]));
  const positionByConceptId = new Map(
    placements.map((p) => [p.conceptId, pointForAngle(p.angle, RING_RADIUS)]),
  );

  const svg = d3
    .select(container)
    .append("svg")
    .attr("viewBox", `0 0 ${viewSize} ${viewSize}`)
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

  const arcsLayer = svg.append("g").attr("class", "arcs-layer");
  const spokesLayer = svg.append("g").attr("class", "spokes-layer");
  const satellitesLayer = svg.append("g").attr("class", "satellites-layer");
  const centerLayer = svg.append("g").attr("class", "center-layer");
  const legendLayer = svg.append("g").attr("class", "legend-layer");

  // --- Satellite-satellite arcs (drawn first, so they sit behind everything) ---
  for (const rel of satelliteSatelliteRelationships) {
    const angleA = angleByConceptId.get(rel.source);
    const angleB = angleByConceptId.get(rel.target);
    const posA = positionByConceptId.get(rel.source);
    const posB = positionByConceptId.get(rel.target);
    if (angleA === undefined || angleB === undefined || !posA || !posB) continue;

    const diff = normalizedAngleDiff(angleA, angleB);
    const midAngle = angleA + diff / 2;
    const bulgeRadius = RING_RADIUS + 25 + 220 * (Math.abs(diff) / Math.PI);
    const control = pointForAngle(midAngle, bulgeRadius);

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
    const end = pointTowards(satellitePos, { x: center, y: center }, SATELLITE_NODE_RADIUS);
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

    const group = satellitesLayer
      .append("g")
      .attr("class", "satellite")
      .attr("transform", `translate(${pos.x}, ${pos.y})`)
      .style("cursor", "pointer")
      .on("click", () => options.onSelectConcept(placement.conceptId));

    group
      .append("circle")
      .attr("r", SATELLITE_NODE_RADIUS)
      .attr("fill", colorForRelationshipType(placement.edge.relationshipTypeId));

    group
      .append("text")
      .attr("class", "satellite-label")
      .attr("text-anchor", rightHalf ? "start" : "end")
      .attr("x", rightHalf ? SATELLITE_NODE_RADIUS + LABEL_GAP : -(SATELLITE_NODE_RADIUS + LABEL_GAP))
      .attr("dy", "0.32em")
      .text(concept.label);

    group.append("title").text(concept.description);
  }

  // --- Center card ---
  const foreignObject = centerLayer
    .append("foreignObject")
    .attr("x", center - CARD_HALF_WIDTH)
    .attr("y", center - CARD_HALF_HEIGHT)
    .attr("width", CARD_WIDTH)
    .attr("height", CARD_HEIGHT);
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
  const legendEntries = buildLegend(index.relationshipTypesById).filter(
    (entry) =>
      edges.some((e) => familyKeyForRelationshipType(e.relationshipTypeId) === entry.familyKey) ||
      satelliteSatelliteRelationships.some((r) => familyKeyForRelationshipType(r.type) === entry.familyKey),
  );
  const legendGroup = legendLayer.attr("transform", "translate(16, 16)");
  legendGroup
    .append("rect")
    .attr("class", "legend-background")
    .attr("width", 240)
    .attr("height", legendEntries.length * 20 + 12)
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

const ACRONYM_CLOUD_WIDTH = 1200;
const ACRONYM_CLOUD_HEIGHT = 800;
const ACRONYM_CLOUD_MIN_FONT = 16;
const ACRONYM_CLOUD_MAX_FONT = 72;
const ACRONYM_CLOUD_PADDING = 6;

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

  const degrees = words.map((word) => word.size);
  const fontScale = d3
    .scaleSqrt()
    .domain([Math.min(...degrees), Math.max(...degrees)])
    .range([ACRONYM_CLOUD_MIN_FONT, ACRONYM_CLOUD_MAX_FONT]);
  for (const word of words) {
    word.size = fontScale(word.size);
  }

  cloud<AcronymWord>()
    .size([ACRONYM_CLOUD_WIDTH, ACRONYM_CLOUD_HEIGHT])
    .words(words)
    .padding(ACRONYM_CLOUD_PADDING)
    .rotate(0)
    .font("sans-serif")
    .fontSize((word) => word.size)
    .on("end", (placedWords) => {
      const svg = d3
        .select(container)
        .append("svg")
        .attr("viewBox", `0 0 ${ACRONYM_CLOUD_WIDTH} ${ACRONYM_CLOUD_HEIGHT}`)
        .attr("class", "acronym-cloud");

      svg
        .append("g")
        .attr("transform", `translate(${ACRONYM_CLOUD_WIDTH / 2}, ${ACRONYM_CLOUD_HEIGHT / 2})`)
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
