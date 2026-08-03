import * as d3 from "d3";
import type { Edge } from "./graph.js";
import type { Relationship } from "./types.js";

export interface SatellitePlacement {
  conceptId: string;
  /**
   * Radians, 0 = 12 o'clock, increasing clockwise. This is a *seed* angle:
   * `computeRadialLayout` only decides angular position (which groups
   * satellites, and orders them to reduce crossings). Radial distance from
   * the center -- and the small tangential adjustments collision avoidance
   * requires -- is resolved separately by `resolveSatellitePositions`.
   */
  angle: number;
  edge: Edge;
}

export interface Point {
  x: number;
  y: number;
}

const TWO_PI = Math.PI * 2;
const GROUP_GAP = 0.12;
const MAX_TOTAL_GAP_FRACTION = 0.3;
const BARYCENTER_PASSES = 2;

function angleDeltaFromStart(angle: number, start: number): number {
  let delta = (angle - start) % TWO_PI;
  if (delta < 0) delta += TWO_PI;
  return delta;
}

interface GroupSpan {
  typeId: string;
  startAngle: number;
  span: number;
  edges: Edge[];
}

/**
 * Assigns each direct neighbor ("satellite") of a central concept a seed
 * angle around the center: satellites sharing the same (center-relative)
 * relationship type are grouped together, groups are ordered to keep
 * heavily-interconnected groups adjacent, and satellites within a group are
 * ordered by a bounded barycenter pass to reduce crossings among
 * satellite-satellite arcs. This is a cheap heuristic, not an optimal
 * crossing-minimizer -- adequate at the graph's actual scale (max degree 18).
 *
 * This only decides angle, not radius -- see `resolveSatellitePositions` for
 * the second stage that turns these seed angles into final positions.
 */
export function computeRadialLayout(
  edges: Edge[],
  satelliteSatelliteRelationships: Relationship[],
): SatellitePlacement[] {
  if (edges.length === 0) return [];

  // Step 1: group by relationship type as experienced from the center.
  const groupOrder: string[] = [];
  const groupsByType = new Map<string, Edge[]>();
  for (const edge of edges) {
    let group = groupsByType.get(edge.relationshipTypeId);
    if (!group) {
      group = [];
      groupsByType.set(edge.relationshipTypeId, group);
      groupOrder.push(edge.relationshipTypeId);
    }
    group.push(edge);
  }

  const groupKeyByConceptId = new Map<string, string>();
  for (const [typeId, groupEdges] of groupsByType) {
    for (const edge of groupEdges) {
      groupKeyByConceptId.set(edge.neighborId, typeId);
    }
  }

  // Step 2: order groups via greedy max-weight chaining, weighted by how many
  // satellite-satellite relationships connect each pair of groups.
  const pairWeight = new Map<string, number>();
  const pairKey = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);
  for (const rel of satelliteSatelliteRelationships) {
    const ga = groupKeyByConceptId.get(rel.source);
    const gb = groupKeyByConceptId.get(rel.target);
    if (ga && gb && ga !== gb) {
      const key = pairKey(ga, gb);
      pairWeight.set(key, (pairWeight.get(key) ?? 0) + 1);
    }
  }
  const weightBetween = (a: string, b: string): number =>
    a === b ? 0 : (pairWeight.get(pairKey(a, b)) ?? 0);
  const totalExternalWeight = (g: string): number =>
    groupOrder.reduce((sum, other) => sum + weightBetween(g, other), 0);

  const remaining = new Set(groupOrder);
  const startCandidates = [...remaining].sort((a, b) => {
    const sizeDiff = (groupsByType.get(b)?.length ?? 0) - (groupsByType.get(a)?.length ?? 0);
    if (sizeDiff !== 0) return sizeDiff;
    const weightDiff = totalExternalWeight(b) - totalExternalWeight(a);
    if (weightDiff !== 0) return weightDiff;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const orderedGroups: string[] = [];
  let current = startCandidates[0]!;
  remaining.delete(current);
  orderedGroups.push(current);
  while (remaining.size > 0) {
    const next = [...remaining].sort((a, b) => {
      const weightDiff = weightBetween(current, b) - weightBetween(current, a);
      if (weightDiff !== 0) return weightDiff;
      const sizeDiff = (groupsByType.get(b)?.length ?? 0) - (groupsByType.get(a)?.length ?? 0);
      if (sizeDiff !== 0) return sizeDiff;
      return a < b ? -1 : a > b ? 1 : 0;
    })[0]!;
    remaining.delete(next);
    orderedGroups.push(next);
    current = next;
  }

  // Step 3: assign each group an angular span proportional to its member count.
  const numGroups = orderedGroups.length;
  const gapAngle = Math.min(GROUP_GAP, (TWO_PI * MAX_TOTAL_GAP_FRACTION) / numGroups);
  const availableAngle = TWO_PI - gapAngle * numGroups;
  const totalSatellites = edges.length;

  const spans: GroupSpan[] = [];
  let cursor = 0;
  for (const typeId of orderedGroups) {
    const groupEdges = groupsByType.get(typeId)!;
    const span = availableAngle * (groupEdges.length / totalSatellites);
    spans.push({ typeId, startAngle: cursor, span, edges: groupEdges });
    cursor += span + gapAngle;
  }

  // Step 4: order satellites within each group via a bounded barycenter heuristic.
  const satelliteNeighbors = new Map<string, string[]>();
  for (const rel of satelliteSatelliteRelationships) {
    addNeighbor(satelliteNeighbors, rel.source, rel.target);
    addNeighbor(satelliteNeighbors, rel.target, rel.source);
  }

  const spanOrders = new Map<GroupSpan, string[]>(
    spans.map((span) => [span, span.edges.map((e) => e.neighborId)]),
  );
  const angleByConceptId = new Map<string, number>();

  const recomputeAngles = () => {
    for (const span of spans) {
      const order = spanOrders.get(span)!;
      const n = order.length;
      order.forEach((id, i) => {
        const t = n === 1 ? 0.5 : (i + 0.5) / n;
        angleByConceptId.set(id, span.startAngle + t * span.span);
      });
    }
  };
  recomputeAngles();

  for (let pass = 0; pass < BARYCENTER_PASSES; pass++) {
    for (const span of spans) {
      const order = spanOrders.get(span)!;
      const keyed = order.map((id) => {
        const neighbors = satelliteNeighbors.get(id) ?? [];
        let sinSum = 0;
        let cosSum = 0;
        let count = 0;
        for (const neighborId of neighbors) {
          const angle = angleByConceptId.get(neighborId);
          if (angle === undefined) continue;
          sinSum += Math.sin(angle);
          cosSum += Math.cos(angle);
          count++;
        }
        const sortAngle = count > 0 ? Math.atan2(sinSum, cosSum) : angleByConceptId.get(id)!;
        return { id, key: angleDeltaFromStart(sortAngle, span.startAngle) };
      });
      keyed.sort((a, b) => a.key - b.key);
      spanOrders.set(span, keyed.map((k) => k.id));
    }
    recomputeAngles();
  }

  const placements: SatellitePlacement[] = [];
  for (const span of spans) {
    for (const conceptId of spanOrders.get(span)!) {
      const edge = span.edges.find((e) => e.neighborId === conceptId)!;
      placements.push({ conceptId, angle: angleByConceptId.get(conceptId)!, edge });
    }
  }
  return placements;
}

function addNeighbor(map: Map<string, string[]>, from: string, to: string): void {
  const list = map.get(from);
  if (list) {
    list.push(to);
  } else {
    map.set(from, [to]);
  }
}

/** The radial extent every satellite's position must be resolved within. */
export interface RadialBounds {
  center: Point;
  /** Half-dimensions of the inner boundary (the center card, plus clearance) that no satellite may sit inside, at any angle. */
  minRadiusX: number;
  minRadiusY: number;
  /** Half-dimensions of the outer boundary (the safe-area envelope) no satellite may be pushed past, at any angle. */
  maxRadiusX: number;
  maxRadiusY: number;
}

// A fixed tick count matches d3-force's own "natural" number of ticks for its
// default alphaDecay (~300, see d3-force docs) -- enough for the simulation to
// fully cool given how few nodes there are (max degree 18), so re-running it
// synchronously per redraw (rather than animating it) is cheap and, since
// nothing here is randomized, deterministic.
const FORCE_TICKS = 300;
// How strongly a satellite is pulled back toward its seed angle each tick --
// high enough that grouping/ordering (computeRadialLayout's whole point)
// survives collision pressure, but not so high that it fights the collide
// force to a standstill before satellites have had room to spread radially.
const ANGLE_RESTORE_STRENGTH = 0.3;
// How strongly a satellite outside [minRadius, maxRadius] for its angle is
// pulled back inside it. Deliberately stronger than the angle restore, since
// this is a hard containment requirement (staying clear of the card and the
// safe-area edge), not an aesthetic preference.
const RADIAL_BAND_STRENGTH = 0.85;
const COLLIDE_STRENGTH = 0.9;
const COLLIDE_ITERATIONS = 2;

interface SimNode {
  conceptId: string;
  /** Seed angle from computeRadialLayout -- see SatellitePlacement.angle. */
  angle: number;
  /** Collision radius, from the satellite's actual label footprint. */
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * The minimum radius, at a given angle from center, for a point to clear the
 * padded card rectangle -- i.e. where a ray from the center at that angle
 * exits the rectangle. (A point is inside an axis-aligned rectangle with
 * half-dimensions [minRadiusX, minRadiusY] while r <= min(minRadiusX/|sin|,
 * minRadiusY/|cos|); this is that bound.)
 */
function cardClearanceRadius(angle: number, minRadiusX: number, minRadiusY: number): number {
  const sin = Math.abs(Math.sin(angle));
  const cos = Math.abs(Math.cos(angle));
  const rx = sin > 1e-6 ? minRadiusX / sin : Infinity;
  const ry = cos > 1e-6 ? minRadiusY / cos : Infinity;
  return Math.min(rx, ry);
}

/** The radius, at a given angle, of the ellipse with half-axes [radiusX, radiusY]. */
function ellipseRadiusAtAngle(angle: number, radiusX: number, radiusY: number): number {
  const sin = Math.abs(Math.sin(angle));
  const cos = Math.abs(Math.cos(angle));
  const denom = Math.hypot(sin / radiusX, cos / radiusY);
  return denom > 1e-9 ? 1 / denom : Math.max(radiusX, radiusY);
}

/**
 * Resolves each satellite's seed angle (from `computeRadialLayout`) and
 * collision radius (from its actual label footprint -- see
 * `render.ts`'s `computeSatelliteFootprint`) into a final position, via a
 * force simulation rather than placing every satellite on one shared
 * ellipse. This is what lets satellites sit at varying radial distance from
 * the center -- e.g. a satellite boxed in by long-labeled neighbors gets
 * pushed outward, one with short-labeled neighbors doesn't -- while still
 * respecting the grouping/ordering `computeRadialLayout` already computed:
 *
 * - `forceCollide`, sized per-node, keeps satellites (and their labels) from
 *   overlapping regardless of how far out collision pressure pushes them.
 * - An angle-restoring force pulls each satellite back toward the ray from
 *   the center at its seed angle -- letting its radius float while resisting
 *   drifting into a different angular sector (and so a different group).
 * - A radial-band force keeps each satellite between the card's clearance
 *   radius and the safe-area's outer radius, both evaluated at that
 *   satellite's own angle (an exact per-angle bound, rather than inflating a
 *   shared ellipse to clear the card's padded corner at every angle).
 *
 * Runs a fixed number of ticks synchronously (`simulation.stop()` right
 * after construction, see d3's static-layout recipe) so this stays a plain
 * function from inputs to final positions, like `computeRadialLayout` --
 * `render()` doesn't animate a settling layout.
 */
export function resolveSatellitePositions(
  placements: SatellitePlacement[],
  collideRadiusByConceptId: ReadonlyMap<string, number>,
  bounds: RadialBounds,
): Map<string, Point> {
  const { center, minRadiusX, minRadiusY, maxRadiusX, maxRadiusY } = bounds;
  if (placements.length === 0) return new Map();

  // A satellite's dot clearing the card isn't enough -- its label is
  // text-anchor="middle"'d on the dot, so a satellite sitting right at a
  // dot-only clearance radius (e.g. one with little collision pressure
  // pushing it further out) has its label spilling sideways back over the
  // card. Pad the card's half-dimensions by *this node's own* collision
  // radius (a circle-vs-rectangle clearance approximation, not exact but
  // conservative) so nodes with bigger label footprints get pushed
  // correspondingly further out. Deliberately NOT capped at the safe-area
  // envelope: an earlier version capped it there (reasoning that the
  // legend/level-bar draw on top of satellites too, same as the card, so
  // overshooting that envelope just trades one occlusion bug for another),
  // but in practice the opaque center card hides far more text per
  // occurrence than the thin legend/level-bar strip does -- card clearance
  // wins unconditionally here; render.ts's final safe-area clamp is what
  // handles the legend/level-bar case instead, and only when doing so
  // wouldn't cost this same satellite its card clearance.
  const minRadiusForNode = (node: Pick<SimNode, "r">, angle: number): number =>
    cardClearanceRadius(angle, minRadiusX + node.r, minRadiusY + node.r);
  const maxRadiusForNode = (node: Pick<SimNode, "r">, angle: number): number =>
    // The outer bound must never fall below the inner one -- guards the
    // (small-viewport) case where the safe-area envelope, evaluated at this
    // angle, would otherwise dip inside the card's own clearance radius.
    Math.max(ellipseRadiusAtAngle(angle, maxRadiusX, maxRadiusY), minRadiusForNode(node, angle));

  const nodes: SimNode[] = placements.map((placement) => {
    const r = collideRadiusByConceptId.get(placement.conceptId) ?? 0;
    const startRadius = minRadiusForNode({ r }, placement.angle);
    return {
      conceptId: placement.conceptId,
      angle: placement.angle,
      r,
      x: center.x + startRadius * Math.sin(placement.angle),
      y: center.y - startRadius * Math.cos(placement.angle),
      vx: 0,
      vy: 0,
    };
  });

  // Pulls each node toward the point at its *current* radius but its *seed*
  // angle -- i.e. corrects only the tangential drift collision avoidance
  // introduces, leaving the radial component (which the band force below
  // governs) alone.
  const angleRestoreForce = (alpha: number): void => {
    for (const node of nodes) {
      const radius = Math.hypot(node.x - center.x, node.y - center.y) || minRadiusForNode(node, node.angle);
      const targetX = center.x + radius * Math.sin(node.angle);
      const targetY = center.y - radius * Math.cos(node.angle);
      node.vx += (targetX - node.x) * ANGLE_RESTORE_STRENGTH * alpha;
      node.vy += (targetY - node.y) * ANGLE_RESTORE_STRENGTH * alpha;
    }
  };

  const radialBandForce = (alpha: number): void => {
    for (const node of nodes) {
      const ox = node.x - center.x;
      const oy = node.y - center.y;
      const radius = Math.hypot(ox, oy);
      if (radius === 0) continue;
      // The node's *actual* angle (not its seed angle) is what determines
      // which card-clearance/safe-area bound applies to where it currently
      // is -- the angle-restore force above is what keeps this close to the
      // seed angle, this force doesn't need to assume that itself.
      const angle = Math.atan2(ox, -oy);
      const minRadius = minRadiusForNode(node, angle);
      const maxRadius = maxRadiusForNode(node, angle);
      const targetRadius = Math.min(Math.max(radius, minRadius), maxRadius);
      if (targetRadius === radius) continue;
      const scale = targetRadius / radius;
      const targetX = center.x + ox * scale;
      const targetY = center.y + oy * scale;
      node.vx += (targetX - node.x) * RADIAL_BAND_STRENGTH * alpha;
      node.vy += (targetY - node.y) * RADIAL_BAND_STRENGTH * alpha;
    }
  };

  const simulation = d3
    .forceSimulation<SimNode>(nodes)
    .force("collide", d3.forceCollide<SimNode>((node) => node.r).strength(COLLIDE_STRENGTH).iterations(COLLIDE_ITERATIONS))
    .force("angle", angleRestoreForce)
    .force("band", radialBandForce)
    .stop();
  simulation.tick(FORCE_TICKS);

  return new Map(nodes.map((node) => [node.conceptId, { x: node.x, y: node.y }]));
}
