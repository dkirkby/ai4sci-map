import "./style.css";
import { buildGraphIndex } from "./graph.js";
import { render } from "./render.js";
import type { GraphData } from "./types.js";

const QUERY_PARAM = "concept";

async function main() {
  const app = document.getElementById("app");
  if (!app) throw new Error("Missing #app container");

  const response = await fetch(`${import.meta.env.BASE_URL}graph.json`);
  if (!response.ok) {
    app.textContent = `Failed to load graph.json (${response.status})`;
    return;
  }
  const data = (await response.json()) as GraphData;
  const index = buildGraphIndex(data);
  const conceptIds = [...index.conceptsById.keys()];

  function resolveInitialConceptId(): string {
    const requested = new URLSearchParams(location.search).get(QUERY_PARAM);
    if (requested && index.conceptsById.has(requested)) {
      return requested;
    }
    const randomId = conceptIds[Math.floor(Math.random() * conceptIds.length)]!;
    const url = new URL(location.href);
    url.searchParams.set(QUERY_PARAM, randomId);
    history.replaceState({ conceptId: randomId }, "", url);
    return randomId;
  }

  function draw(conceptId: string): void {
    render(app!, index, conceptId, {
      onSelectConcept: (nextId) => {
        const url = new URL(location.href);
        url.searchParams.set(QUERY_PARAM, nextId);
        history.pushState({ conceptId: nextId }, "", url);
        draw(nextId);
      },
    });
  }

  window.addEventListener("popstate", () => {
    const conceptId = new URLSearchParams(location.search).get(QUERY_PARAM);
    if (conceptId && index.conceptsById.has(conceptId)) {
      draw(conceptId);
    }
  });

  draw(resolveInitialConceptId());
}

main().catch((err) => {
  console.error(err);
  const app = document.getElementById("app");
  if (app) app.textContent = "Failed to initialize the concept browser.";
});
