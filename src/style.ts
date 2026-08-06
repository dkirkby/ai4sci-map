import * as d3 from "d3";
import type { RelationshipType } from "./types.js";

/**
 * The data only ever stores one direction of each declared inverse pair (see
 * scripts/build-data.ts / src/graph.ts). Collapsing each pair to a single
 * "family" gives 12 families for the 12 pairs declared in
 * data/relationship-types.yaml. This list must stay in sync with that file --
 * a pair missing here falls through `familyKeyForRelationshipType`'s fallback
 * (returning the raw, un-collapsed type id), which breaks two things
 * silently: `colorForRelationshipType` still returns *some* color (d3's
 * ordinal scale auto-extends its domain for an unrecognized key), but
 * `markerIdForRelationshipType` names an arrowhead marker that was never
 * defined (see render.ts's `defs`, which only iterates `allFamilyKeys()`), so
 * the arrow silently renders without a head; `buildLegend` and `allFamilyKeys`
 * only iterate this list too, so the family also goes missing from the
 * legend entirely.
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
  ["evaluates", "evaluated_by"],
  ["encompasses", "studied_within"],
];

const familyKeyByTypeId = new Map<string, string>();
for (const [forwardId, inverseId] of RELATIONSHIP_FAMILIES) {
  familyKeyByTypeId.set(forwardId, forwardId);
  familyKeyByTypeId.set(inverseId, forwardId);
}

const familyKeys = RELATIONSHIP_FAMILIES.map(([forwardId]) => forwardId);
// d3.schemeTableau10 only has 10 colors, so the last 2 families are given
// colors outside that scheme -- chosen to read as distinct from all 10
// Tableau colors and from each other, not algorithmically validated (a full
// audit of this now-12-family palette is a separate, larger task -- see
// LAYOUT_UPGRADE.md's sibling concerns around this diagram's visual design).
const EXTRA_FAMILY_COLORS = ["#17becf", "#5254a3"];
const colorScale = d3
  .scaleOrdinal<string, string>()
  .domain(familyKeys)
  .range([...d3.schemeTableau10, ...EXTRA_FAMILY_COLORS]);

export function familyKeyForRelationshipType(relationshipTypeId: string): string {
  return familyKeyByTypeId.get(relationshipTypeId) ?? relationshipTypeId;
}

export function colorForRelationshipType(relationshipTypeId: string): string {
  return colorScale(familyKeyForRelationshipType(relationshipTypeId));
}

export function markerIdForRelationshipType(relationshipTypeId: string): string {
  return `arrow-${familyKeyForRelationshipType(relationshipTypeId)}`;
}

/** Id of the legend-only marker variant -- see render.ts's `defs` for why it's separate from `markerIdForRelationshipType`. */
export function legendMarkerIdForRelationshipType(relationshipTypeId: string): string {
  return `legend-arrow-${familyKeyForRelationshipType(relationshipTypeId)}`;
}

export interface LegendEntry {
  familyKey: string;
  label: string;
  color: string;
  markerId: string;
}

/**
 * Builds one legend entry per relationship-type *family* present in the
 * current view (`presentTypeIds`, from both spokes and satellite-satellite
 * arcs) -- always using the family's canonical (stored) label, e.g. "is a
 * subfield of", never its inverse "has subfield", even when only the inverse
 * direction is present among the drawn edges. A single label suffices because
 * `render.ts` always points a relationship's arrowhead at its raw stored
 * `target` (see the spoke-drawing loop), regardless of which end is
 * currently centered -- so "X [label] Y" is always true read in the
 * direction the arrow points, and the legend's own swatch carries an
 * arrowhead to make that reading convention visible at a glance.
 */
export function buildLegend(
  relationshipTypesById: Map<string, RelationshipType>,
  presentTypeIds: ReadonlySet<string>,
): LegendEntry[] {
  const entries: LegendEntry[] = [];
  for (const [forwardId, inverseId] of RELATIONSHIP_FAMILIES) {
    if (!presentTypeIds.has(forwardId) && !presentTypeIds.has(inverseId)) continue;
    const label = relationshipTypesById.get(forwardId)?.label ?? forwardId;
    entries.push({
      familyKey: forwardId,
      label,
      color: colorScale(forwardId),
      markerId: legendMarkerIdForRelationshipType(forwardId),
    });
  }
  return entries;
}

export function allFamilyKeys(): string[] {
  return familyKeys;
}

/**
 * One fixed hue per audience level (1-5), used only by the acronym word
 * cloud (see renderAcronymCloud in render.ts) -- deliberately a different
 * palette from RELATIONSHIP_FAMILIES' colors above so the two color
 * languages ("this hue means relationship type" vs "this hue means
 * audience level") don't bleed into each other, even though the two views
 * are never on screen together. A warm-to-cool progression (gold -> indigo)
 * so level 1 ("widely recognized") reads as approachable and level 5
 * ("specialist") reads as deep/serious, reinforcing the level bar's own
 * 1-5 ordering. Not varied for light/dark mode, matching
 * colorForRelationshipType's precedent above (this palette's lightness
 * already reads fine against both `--bg` values in style.css).
 */
const LEVEL_COLORS: string[] = [
  "#c2851f", // 1 -- widely recognized
  "#c1562f", // 2 -- commonly encountered
  "#b23a63", // 3 -- familiar to an interested audience
  "#7a4aa8", // 4 -- mainly technical
  "#35478c", // 5 -- specialist
];

// How much to desaturate the least-connected word in a level's cloud,
// relative to that level's full base saturation (1 = no desaturation).
const ACRONYM_WORD_MIN_SATURATION_FACTOR = 0.35;

/**
 * Color for one acronym-cloud word. Hue and lightness are fixed by `level`
 * (matching LEVEL_COLORS exactly, so every level's color reads consistently
 * against both light and dark `--bg`); saturation is pulled from `fontSize`
 * (already a function of the concept's graph degree, see
 * renderAcronymCloud) normalized against the cloud's own min/max, so
 * more-connected words read as more vivid/prominent within their level's
 * cloud and less-connected ones as more muted, rather than every word being
 * one flat color. Deliberately varies saturation, not lightness: pulling
 * lightness toward white for low-weight words (an earlier version of this
 * function did) can wreck contrast against the light theme for warm hues
 * like level 1's gold, since lightening a color moves it toward the light
 * background instead of away from it. Saturation doesn't have that problem
 * -- desaturating toward the same lightness barely changes contrast against
 * either background.
 */
export function colorForAcronymWord(level: number, fontSize: number, minFontSize: number, maxFontSize: number): string {
  const base = LEVEL_COLORS[level - 1]!;
  const t = maxFontSize > minFontSize ? (fontSize - minFontSize) / (maxFontSize - minFontSize) : 1;
  const hsl = d3.hsl(base);
  const minSaturation = hsl.s * ACRONYM_WORD_MIN_SATURATION_FACTOR;
  return d3.hsl(hsl.h, minSaturation + (hsl.s - minSaturation) * t, hsl.l).formatHex();
}
