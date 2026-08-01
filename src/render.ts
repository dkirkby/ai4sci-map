import * as d3 from "d3";
import { getSatelliteSatelliteRelationships, type GraphIndex } from "./graph.js";
import { computeRadialLayout } from "./layout.js";
import {
  allFamilyKeys,
  buildLegend,
  colorForRelationshipType,
  familyKeyForRelationshipType,
  markerIdForRelationshipType,
} from "./style.js";

const BASE_VIEW_SIZE = 1000;
const RING_RADIUS = 300;
const SATELLITE_NODE_RADIUS = 9;
const CARD_WIDTH = 300;
const CARD_HEIGHT = 210;
const CARD_HALF_WIDTH = CARD_WIDTH / 2;
const CARD_HALF_HEIGHT = CARD_HEIGHT / 2;
const LABEL_GAP = 6;
// Rough average glyph width (px) for the 12px sans-serif label font -- used only
// to size the viewBox generously enough that satellite labels never clip against
// its edge, not for precise text layout.
const CHAR_WIDTH_ESTIMATE = 6.6;
const VIEW_MARGIN = 24;

export interface RenderOptions {
  onSelectConcept: (conceptId: string) => void;
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
  options: RenderOptions,
): void {
  container.innerHTML = "";

  const centerConcept = index.conceptsById.get(centerId);
  if (!centerConcept) {
    renderUnknownConceptError(container, centerId);
    return;
  }

  const edges = index.adjacency.get(centerId) ?? [];
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
  card.append("div").attr("class", "center-card-kind").text(centerConcept.kind.replace(/_/g, " "));
  card.append("h2").attr("class", "center-card-label").text(centerConcept.label);

  const acronyms = centerConcept.acronyms ?? [];
  if (acronyms.length > 0) {
    card.append("div").attr("class", "center-card-acronyms").text(acronyms.join(" · "));
  }

  card.append("p").attr("class", "center-card-description").text(centerConcept.description);

  const displayableAttributes = Object.entries(centerConcept.attributes ?? {}).filter(
    (entry): entry is [string, AttributeDisplayValue] => isDisplayableAttributeValue(entry[1]),
  );
  if (displayableAttributes.length > 0) {
    const attributesRow = card.append("div").attr("class", "center-card-attributes");
    displayableAttributes.forEach(([key, value], i) => {
      if (i > 0) attributesRow.append("span").attr("class", "attribute-dot").text(" · ");
      attributesRow
        .append("span")
        .attr("class", `attribute attribute-${value}`)
        .text(humanizeAttributeKey(key));
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
}

function renderUnknownConceptError(container: HTMLElement, conceptId: string): void {
  const wrapper = document.createElement("div");
  wrapper.className = "concept-error";

  const message = document.createElement("p");
  message.className = "concept-error-message";
  message.textContent = `Unknown concept: "${conceptId}"`;

  const hint = document.createElement("p");
  hint.className = "concept-error-hint";
  hint.textContent = "Try searching for a known concept using the search bar above.";

  wrapper.append(message, hint);
  container.appendChild(wrapper);
}

function relationshipTooltip(index: GraphIndex, relationshipTypeId: string): string {
  return index.relationshipTypesById.get(relationshipTypeId)?.label ?? relationshipTypeId;
}

type AttributeDisplayValue = "always" | "usually" | "sometimes";

function isDisplayableAttributeValue(value: unknown): value is AttributeDisplayValue {
  return value === "always" || value === "usually" || value === "sometimes";
}

function humanizeAttributeKey(key: string): string {
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
