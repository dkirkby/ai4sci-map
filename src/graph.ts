import type { Concept, GraphData, Relationship, RelationshipType } from "./types.js";

export type EdgeDirection = "forward" | "backward";

/**
 * An edge as experienced from one particular concept's point of view: the
 * relationship type is resolved to whichever of {stored type, its inverse} reads
 * naturally from this concept's side, and `direction` records which way the true
 * arrow points relative to this concept.
 */
export interface Edge {
  neighborId: string;
  relationshipTypeId: string;
  direction: EdgeDirection;
  relationship: Relationship;
}

export interface GraphIndex {
  conceptsById: Map<string, Concept>;
  relationshipTypesById: Map<string, RelationshipType>;
  adjacency: Map<string, Edge[]>;
  relationshipsByConceptId: Map<string, Relationship[]>;
}

function addToListMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}

export function buildGraphIndex(data: GraphData): GraphIndex {
  const conceptsById = new Map(data.concepts.map((c) => [c.id, c]));
  const relationshipTypesById = new Map(data.relationshipTypes.map((t) => [t.id, t]));
  const adjacency = new Map<string, Edge[]>();
  const relationshipsByConceptId = new Map<string, Relationship[]>();

  for (const relationship of data.relationships) {
    addToListMap(relationshipsByConceptId, relationship.source, relationship);
    if (relationship.target !== relationship.source) {
      addToListMap(relationshipsByConceptId, relationship.target, relationship);
    }

    const relType = relationshipTypesById.get(relationship.type);
    const inverseTypeId = relType?.inverse ?? relationship.type;

    addToListMap(adjacency, relationship.source, {
      neighborId: relationship.target,
      relationshipTypeId: relationship.type,
      direction: "forward",
      relationship,
    });
    if (relationship.target !== relationship.source) {
      addToListMap(adjacency, relationship.target, {
        neighborId: relationship.source,
        relationshipTypeId: inverseTypeId,
        direction: "backward",
        relationship,
      });
    }
  }

  return { conceptsById, relationshipTypesById, adjacency, relationshipsByConceptId };
}

/**
 * Resolves a user-supplied concept identifier to a canonical concept id.
 * Tries an exact id match first, then falls back to a case-insensitive match
 * against each concept's label, aliases, and acronyms. Returns `undefined` if
 * nothing matches.
 */
export function resolveConceptId(index: GraphIndex, query: string): string | undefined {
  if (index.conceptsById.has(query)) return query;

  const normalized = query.trim().toLowerCase();
  for (const concept of index.conceptsById.values()) {
    if (concept.label.toLowerCase() === normalized) return concept.id;
    if ((concept.aliases ?? []).some((alias) => alias.toLowerCase() === normalized)) return concept.id;
    if ((concept.acronyms ?? []).some((acronym) => acronym.toLowerCase() === normalized)) return concept.id;
  }
  return undefined;
}

/** Concept counts by audience_level, indexed [level1, level2, level3, level4, level5]. */
export type LevelCounts = [number, number, number, number, number];

export function computeLevelCounts(concepts: Iterable<Concept>): LevelCounts {
  const counts: LevelCounts = [0, 0, 0, 0, 0];
  for (const concept of concepts) {
    const index = concept.audience_level - 1;
    if (index >= 0 && index < counts.length) counts[index] = counts[index]! + 1;
  }
  return counts;
}

/** All relationships whose two endpoints both lie within `satelliteIds`. */
export function getSatelliteSatelliteRelationships(
  index: GraphIndex,
  satelliteIds: Set<string>,
): Relationship[] {
  const seen = new Set<Relationship>();
  const result: Relationship[] = [];
  for (const id of satelliteIds) {
    for (const relationship of index.relationshipsByConceptId.get(id) ?? []) {
      const other = relationship.source === id ? relationship.target : relationship.source;
      if (other !== id && satelliteIds.has(other) && !seen.has(relationship)) {
        seen.add(relationship);
        result.push(relationship);
      }
    }
  }
  return result;
}
