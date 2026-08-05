import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { Concept, Relationship } from "../../../../src/types.js";

// add-concepts Step 6 (file placement) helper.
//
// For one or more concept ids (typically existing concepts that are good
// precedent for a new one), reports which data/concepts/*.yaml file defines
// them and which data/relationships/*.yaml files reference them as source or
// target, grouped by file. Use this instead of guessing placement from the
// kind->file table alone -- put new entries next to real precedent.
//
// Usage:
//   npx tsx .claude/skills/add-concepts/scripts/locate.ts decision-tree kl-divergence
//
// Reads data/ source fragments directly via manifest.yaml; no build step required.

interface Manifest {
  concept_files: string[];
  relationship_files: string[];
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../../..");
const dataDir = join(repoRoot, "data");

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error("Usage: locate.ts <concept-id> [concept-id ...]");
  process.exit(1);
}

const manifest = parseYaml(readFileSync(join(dataDir, "manifest.yaml"), "utf8")) as Manifest;

const conceptFile = new Map<string, string>();
for (const relPath of manifest.concept_files) {
  const fragment = parseYaml(readFileSync(join(dataDir, relPath), "utf8")) as { concepts?: Concept[] };
  for (const concept of fragment.concepts ?? []) {
    conceptFile.set(concept.id, relPath);
  }
}

interface RelRef {
  file: string;
  type: string;
  direction: "source" | "target";
  other: string;
}

const relRefs = new Map<string, RelRef[]>();
function addRef(id: string, ref: RelRef) {
  const list = relRefs.get(id);
  if (list) list.push(ref);
  else relRefs.set(id, [ref]);
}

for (const relPath of manifest.relationship_files) {
  const fragment = parseYaml(readFileSync(join(dataDir, relPath), "utf8")) as { relationships?: Relationship[] };
  for (const rel of fragment.relationships ?? []) {
    addRef(rel.source, { file: relPath, type: rel.type, direction: "source", other: rel.target });
    addRef(rel.target, { file: relPath, type: rel.type, direction: "target", other: rel.source });
  }
}

for (const id of ids) {
  console.log(`=== ${id} ===`);
  const file = conceptFile.get(id);
  console.log(file ? `  concept defined in: ${file}` : "  concept not found -- new concept, or check spelling");

  const refs = relRefs.get(id) ?? [];
  if (refs.length === 0) {
    console.log("  no relationships reference this id yet");
    console.log();
    continue;
  }

  const byFile = new Map<string, RelRef[]>();
  for (const ref of refs) {
    const list = byFile.get(ref.file);
    if (list) list.push(ref);
    else byFile.set(ref.file, [ref]);
  }

  console.log("  referenced in relationship files:");
  for (const [file, fileRefs] of byFile) {
    console.log(`    ${file}:`);
    for (const ref of fileRefs) {
      console.log(
        ref.direction === "source"
          ? `      ${id} --${ref.type}--> ${ref.other}`
          : `      ${ref.other} --${ref.type}--> ${id}`,
      );
    }
  }
  console.log();
}
