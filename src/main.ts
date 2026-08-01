import "./style.css";
import { buildGraphIndex, resolveConceptId } from "./graph.js";
import { render, renderAcronymCloud, renderAttributeBrowser, renderKindList, type RenderOptions } from "./render.js";
import { initSearch } from "./search.js";
import { initShareButton } from "./share.js";
import type { ConceptKind, GraphData } from "./types.js";

const CONCEPT_PARAM = "concept";
const KIND_PARAM = "kind";
const ATTR_PARAM = "attr";
const TLA_PARAM = "tla";
const HILITE_PARAM = "hilite";

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

  function navigateTo(conceptId: string): void {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set(CONCEPT_PARAM, conceptId);
    history.pushState(null, "", url);
    renderRoute(false);
  }

  function navigateToKind(kind: ConceptKind, conceptId: string): void {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set(KIND_PARAM, kind);
    url.searchParams.set(HILITE_PARAM, conceptId);
    history.pushState(null, "", url);
    renderRoute(false);
  }

  function navigateToKindOnly(kind: ConceptKind): void {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set(KIND_PARAM, kind);
    history.pushState(null, "", url);
    renderRoute(false);
  }

  function navigateToAttribute(attributeKey: string, conceptId: string): void {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set(ATTR_PARAM, attributeKey);
    url.searchParams.set(HILITE_PARAM, conceptId);
    history.pushState(null, "", url);
    renderRoute(false);
  }

  function navigateToAttributeOnly(attributeKey: string): void {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set(ATTR_PARAM, attributeKey);
    history.pushState(null, "", url);
    renderRoute(false);
  }

  function navigateToAcronym(acronym: string, conceptId: string): void {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set(TLA_PARAM, acronym);
    url.searchParams.set(HILITE_PARAM, conceptId);
    history.pushState(null, "", url);
    renderRoute(false);
  }

  const renderOptions: RenderOptions = {
    onSelectConcept: navigateTo,
    onSelectKind: navigateToKind,
    onSwitchKind: navigateToKindOnly,
    onSelectAttribute: navigateToAttribute,
    onSwitchAttribute: navigateToAttributeOnly,
    onSelectAcronym: navigateToAcronym,
  };

  /**
   * Draws whichever view the current URL's query params describe: a kind
   * listing if `kind` is present, an attribute listing if `attr` is present,
   * an acronym word cloud if `tla` is present, otherwise the normal concept
   * view (falling back to a random concept if `concept` is absent).
   * `rewriteUrl` is only passed true for the initial page load, matching the
   * existing convention of canonicalizing the URL once via `replaceState`
   * rather than on every popstate.
   */
  function renderRoute(rewriteUrl: boolean): void {
    const params = new URLSearchParams(location.search);

    const kind = params.get(KIND_PARAM);
    if (kind !== null) {
      renderKindList(app!, index, kind, params.get(HILITE_PARAM), renderOptions);
      return;
    }

    const attr = params.get(ATTR_PARAM);
    if (attr !== null) {
      renderAttributeBrowser(app!, index, attr, params.get(HILITE_PARAM), renderOptions);
      return;
    }

    const tla = params.get(TLA_PARAM);
    if (tla !== null) {
      renderAcronymCloud(app!, index, tla, renderOptions);
      return;
    }

    const requested = params.get(CONCEPT_PARAM);
    // Falls back to the raw (unresolved) value when nothing matches, so
    // render() hits its "Unknown concept" error path instead of silently
    // substituting a random concept.
    const conceptId = requested
      ? (resolveConceptId(index, requested) ?? requested)
      : conceptIds[Math.floor(Math.random() * conceptIds.length)]!;

    if (rewriteUrl && conceptId !== requested) {
      const url = new URL(location.href);
      url.search = "";
      url.searchParams.set(CONCEPT_PARAM, conceptId);
      history.replaceState(null, "", url);
    }

    render(app!, index, conceptId, renderOptions);
  }

  window.addEventListener("popstate", () => renderRoute(false));

  initSearch(searchRoot, [...index.conceptsById.values()], { onSelectConcept: navigateTo });
  initShareButton(shareRoot);

  renderRoute(true);
}

main().catch((err) => {
  console.error(err);
  const app = document.getElementById("app");
  if (app) app.textContent = "Failed to initialize the concept browser.";
});
