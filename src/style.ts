import * as d3 from "d3";
import type { RelationshipType } from "./types.js";

/**
 * The data only ever stores one direction of each declared inverse pair (see
 * scripts/build-data.ts / src/graph.ts). Collapsing each pair to a single "family"
 * gives exactly 10 families for the 10 pairs, matching d3.schemeTableau10 1:1.
 */
const RELATIONSHIP_FAMILIES: [string, string][] = [
  ["is_a", "has_subtype"],
  ["is_subfield_of", "has_subfield"],
  ["uses", "used_by"],
  ["typically_uses", "typically_used_by"],
  ["trained_by", "trains"],
  ["used_for", "uses_method"],
  ["optimizes", "optimized_by"],
  ["produces", "produced_by"],
  ["product_uses_model_family", "model_family_powers_product"],
  ["family_of", "has_model_family"],
];

const familyKeyByTypeId = new Map<string, string>();
for (const [forwardId, inverseId] of RELATIONSHIP_FAMILIES) {
  familyKeyByTypeId.set(forwardId, forwardId);
  familyKeyByTypeId.set(inverseId, forwardId);
}

const familyKeys = RELATIONSHIP_FAMILIES.map(([forwardId]) => forwardId);
const colorScale = d3.scaleOrdinal<string, string>().domain(familyKeys).range(d3.schemeTableau10);

export function familyKeyForRelationshipType(relationshipTypeId: string): string {
  return familyKeyByTypeId.get(relationshipTypeId) ?? relationshipTypeId;
}

export function colorForRelationshipType(relationshipTypeId: string): string {
  return colorScale(familyKeyForRelationshipType(relationshipTypeId));
}

export function markerIdForRelationshipType(relationshipTypeId: string): string {
  return `arrow-${familyKeyForRelationshipType(relationshipTypeId)}`;
}

export interface LegendEntry {
  familyKey: string;
  label: string;
  color: string;
  markerId: string;
}

/**
 * Builds one legend entry per relationship type actually drawn in the
 * current view (`presentTypeIds`, the experienced types from both spokes and
 * satellite-satellite arcs) -- never the combined "A / B" form, since any
 * single drawn arrow is fully described by just its own direction (e.g. "is
 * a" or "has subtype"), regardless of whether the view happens to also draw
 * the other direction elsewhere in the same color. When both directions of a
 * family are present, both get their own entry, sharing that family's color.
 */
export function buildLegend(
  relationshipTypesById: Map<string, RelationshipType>,
  presentTypeIds: ReadonlySet<string>,
): LegendEntry[] {
  const entries: LegendEntry[] = [];
  for (const [forwardId, inverseId] of RELATIONSHIP_FAMILIES) {
    for (const typeId of [forwardId, inverseId]) {
      if (!presentTypeIds.has(typeId)) continue;
      const label = relationshipTypesById.get(typeId)?.label ?? typeId;
      entries.push({ familyKey: forwardId, label, color: colorScale(forwardId), markerId: `arrow-${forwardId}` });
    }
  }
  return entries;
}

export function allFamilyKeys(): string[] {
  return familyKeys;
}
