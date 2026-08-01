import "./style.css";
import { buildGraphIndex, resolveConceptId } from "./graph.js";
import { render } from "./render.js";
import { initSearch } from "./search.js";
import { initShareButton } from "./share.js";
import type { GraphData } from "./types.js";

const QUERY_PARAM = "concept";

async function main() {
  const app = document.getElementById("app");
  const searchRoot = document.getElementById("search-root");
  const shareRoot = document.getElementById("share-root");
  if (!app) throw new Error("Missing #app container");
  if (!searchRoot) throw new Error("Missing #search-root container");
  if (!shareRoot) throw new Error("Missing #share-root container");

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
    if (requested) {
      // Falls back to the raw (unresolved) value when nothing matches, so
      // draw() hits render()'s "Unknown concept" error path instead of
      // silently substituting a random concept.
      const resolvedId = resolveConceptId(index, requested) ?? requested;
      if (resolvedId !== requested) {
        const url = new URL(location.href);
        url.searchParams.set(QUERY_PARAM, resolvedId);
        history.replaceState({ conceptId: resolvedId }, "", url);
      }
      return resolvedId;
    }
    const randomId = conceptIds[Math.floor(Math.random() * conceptIds.length)]!;
    const url = new URL(location.href);
    url.searchParams.set(QUERY_PARAM, randomId);
    history.replaceState({ conceptId: randomId }, "", url);
    return randomId;
  }

  function draw(conceptId: string): void {
    render(app!, index, conceptId, { onSelectConcept: navigateTo });
  }

  function navigateTo(conceptId: string): void {
    const url = new URL(location.href);
    url.searchParams.set(QUERY_PARAM, conceptId);
    history.pushState({ conceptId }, "", url);
    draw(conceptId);
  }

  window.addEventListener("popstate", () => {
    const requested = new URLSearchParams(location.search).get(QUERY_PARAM);
    if (requested) {
      draw(resolveConceptId(index, requested) ?? requested);
    }
  });

  initSearch(searchRoot, [...index.conceptsById.values()], { onSelectConcept: navigateTo });
  initShareButton(shareRoot);

  draw(resolveInitialConceptId());
}

main().catch((err) => {
  console.error(err);
  const app = document.getElementById("app");
  if (app) app.textContent = "Failed to initialize the concept browser.";
});
