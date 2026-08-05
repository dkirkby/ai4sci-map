import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Concept, GraphData } from "../../../../src/types.js";

// add-concepts Step 1 (duplicate / overlap screen) helper.
//
// For each candidate name, checks every existing concept's label, aliases, and
// acronyms (case-insensitive) for an exact or substring match, so you don't have
// to eyeball a dump of ~250+ concepts by hand.
//
// Usage:
//   npx tsx .claude/skills/add-concepts/scripts/find-candidates.ts "open source" "cloud computing" "ROC"
//
// Requires an up-to-date public/graph.json (run `npm run build:data` first).

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../../..");
const graphPath = join(repoRoot, "public", "graph.json");

const candidates = process.argv.slice(2);
if (candidates.length === 0) {
  console.error('Usage: find-candidates.ts "<candidate 1>" "<candidate 2>" ...');
  process.exit(1);
}

let graph: GraphData;
try {
  graph = JSON.parse(readFileSync(graphPath, "utf8"));
} catch {
  console.error(`Could not read ${graphPath}. Run "npm run build:data" first.`);
  process.exit(1);
}

function names(concept: Concept): string[] {
  return [concept.label, ...(concept.aliases ?? []), ...(concept.acronyms ?? [])];
}

// Collapses hyphens/en-dashes/em-dashes to spaces before comparing, so "cross
// entropy" matches a label like "Cross-entropy" instead of silently missing it.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarize(concept: Concept): string {
  const desc = concept.description.length > 90 ? `${concept.description.slice(0, 90)}...` : concept.description;
  return `${concept.id} (${concept.kind}) — ${desc}`;
}

for (const candidate of candidates) {
  const needle = normalize(candidate);

  const exact = graph.concepts.filter((c) => names(c).some((n) => normalize(n) === needle));
  if (exact.length > 0) {
    console.log(`"${candidate}" -- EXACT MATCH (drop from batch, tell the user it already exists):`);
    for (const c of exact) console.log(`  ${summarize(c)}`);
    console.log();
    continue;
  }

  const overlap = graph.concepts.filter((c) =>
    names(c).some((n) => {
      const normalized = normalize(n);
      return normalized.includes(needle) || needle.includes(normalized);
    }),
  );
  if (overlap.length > 0) {
    console.log(`"${candidate}" -- possible overlap, read descriptions before deciding:`);
    for (const c of overlap) console.log(`  ${summarize(c)}`);
  } else {
    console.log(`"${candidate}" -- no name match; still screen for scope/confidence by hand`);
  }
  console.log();
}
