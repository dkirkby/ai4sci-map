export type ConceptKind =
  | "field"
  | "learning_paradigm"
  | "model_role"
  | "model_class"
  | "model_family"
  | "architecture"
  | "training_method"
  | "mathematical_object"
  | "task"
  | "system"
  | "product"
  | "property"
  | "data_concept"
  | "evaluation_concept";

export const CONCEPT_KINDS: ConceptKind[] = [
  "field",
  "learning_paradigm",
  "model_role",
  "model_class",
  "model_family",
  "architecture",
  "training_method",
  "mathematical_object",
  "task",
  "system",
  "product",
  "property",
  "data_concept",
  "evaluation_concept",
];

export interface ExternalLink {
  label: string;
  url: string;
}

export interface Concept {
  id: string;
  label: string;
  kind: ConceptKind;
  description: string;
  audience_level: number;
  aliases?: string[];
  acronyms?: string[];
  introduced?: number;
  attributes?: Record<string, string | number | boolean | string[]>;
  modalities?: string[];
  typical_tasks?: string[];
  external_links?: ExternalLink[];
}

export type RelationshipFrequency = "always" | "usually" | "sometimes" | "rarely";
export type RelationshipConfidence = "high" | "medium" | "low";

export interface RelationshipQualifiers {
  frequency?: RelationshipFrequency;
  confidence?: RelationshipConfidence;
  context?: string;
  valid_from?: number;
  valid_until?: number;
}

export interface Relationship {
  source: string;
  type: string;
  target: string;
  description?: string;
  qualifiers?: RelationshipQualifiers;
}

export interface RelationshipType {
  id: string;
  label: string;
  description: string;
  inverse?: string;
  symmetric?: boolean;
  transitive?: boolean;
}

/** One word's precomputed, non-overlapping placement within its level's canonical cloud box. */
export interface AcronymCloudWord {
  text: string;
  conceptId: string;
  fontSize: number;
  x: number;
  y: number;
}

/**
 * A fully laid-out acronym cloud for one cumulative audience level (`words`
 * covers every acronym with `audience_level <= level`). Computed offline by
 * scripts/build-data.ts -- the frontend never runs the packing algorithm, it
 * only scales this fixed arrangement to fit the live viewport.
 */
export interface AcronymCloudLevel {
  level: number;
  width: number;
  height: number;
  words: AcronymCloudWord[];
}

export interface GraphData {
  schemaVersion: 1;
  concepts: Concept[];
  relationships: Relationship[];
  relationshipTypes: RelationshipType[];
  acronymClouds: AcronymCloudLevel[];
}
