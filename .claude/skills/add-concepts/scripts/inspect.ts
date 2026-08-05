import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GraphData } from "../../../../src/types.js";

// add-concepts Steps 2-5 helper.
//
// Prints a concept's full record plus every relationship touching it, as stored
// (source -> target, not inverse-resolved for concepts on the target side — see
// src/graph.ts for that resolution). Use this to calibrate a new concept's
// audience_level/description/kind against comparable existing concepts, and to
// see how those peers are connected before drafting new relationships.
//
// Usage:
//   npx tsx .claude/skills/add-concepts/scripts/inspect.ts decision-tree kl-divergence
//
// Requires an up-to-date public/graph.json (run `npm run build:data` first).

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../../..");
const graphPath = join(repoRoot, "public", "graph.json");

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error("Usage: inspect.ts <concept-id> [concept-id ...]");
  process.exit(1);
}

let graph: GraphData;
try {
  graph = JSON.parse(readFileSync(graphPath, "utf8"));
} catch {
  console.error(`Could not read ${graphPath}. Run "npm run build:data" first.`);
  process.exit(1);
}

const byId = new Map(graph.concepts.map((c) => [c.id, c]));

function describe(id: string): string {
  const c = byId.get(id);
  return c ? `${id} (${c.kind})` : id;
}

for (const id of ids) {
  const concept = byId.get(id);
  console.log(`=== ${id} ===`);
  if (!concept) {
    console.log("  not found in graph -- new concept, or check spelling\n");
    continue;
  }

  console.log(`  label: ${concept.label}`);
  console.log(`  kind: ${concept.kind}`);
  console.log(`  audience_level: ${concept.audience_level}`);
  console.log(`  description: ${concept.description}`);
  if (concept.aliases?.length) console.log(`  aliases: ${concept.aliases.join(", ")}`);
  if (concept.acronyms?.length) console.log(`  acronyms: ${concept.acronyms.join(", ")}`);
  if (concept.introduced) console.log(`  introduced: ${concept.introduced}`);
  if (concept.attributes && Object.keys(concept.attributes).length > 0) {
    console.log(`  attributes: ${JSON.stringify(concept.attributes)}`);
  }

  const outbound = graph.relationships.filter((r) => r.source === id);
  const inbound = graph.relationships.filter((r) => r.target === id);

  console.log(`  outbound (${outbound.length}):`);
  for (const r of outbound) console.log(`    --${r.type}--> ${describe(r.target)}`);

  console.log(`  inbound (${inbound.length}):`);
  for (const r of inbound) console.log(`    ${describe(r.source)} --${r.type}-->`);

  console.log();
}
