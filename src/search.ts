import type { Concept } from "./types.js";

export interface SearchOptions {
  onSelectConcept: (conceptId: string) => void;
}

interface SearchEntry {
  concept: Concept;
  searchTerms: string[];
}

const MAX_SUGGESTIONS = 8;
const LISTBOX_ID = "search-listbox";

/**
 * A search-as-you-type box that matches concepts by label, alias, or acronym (all 182
 * concepts, not just the ones currently on screen) and hands the chosen concept's
 * id to `onSelectConcept` -- the same navigation path satellite clicks use. Built
 * once against a plain DOM node outside of #app, since #app's contents are fully
 * replaced on every graph redraw (see render.ts).
 */
export function initSearch(container: HTMLElement, concepts: Concept[], options: SearchOptions): void {
  const entries: SearchEntry[] = concepts.map((concept) => ({
    concept,
    searchTerms: [concept.label, ...(concept.aliases ?? []), ...(concept.acronyms ?? [])].map((term) =>
      term.toLowerCase(),
    ),
  }));

  container.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "search-box";

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "search-icon");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<line x1="15.3" y1="15.3" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';

  const input = document.createElement("input");
  input.type = "text";
  input.className = "search-input";
  input.placeholder = "Search concepts…";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-label", "Search concepts");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", LISTBOX_ID);

  const dropdown = document.createElement("ul");
  dropdown.className = "search-dropdown";
  dropdown.id = LISTBOX_ID;
  dropdown.setAttribute("role", "listbox");
  dropdown.hidden = true;

  wrapper.append(icon, input, dropdown);
  container.appendChild(wrapper);

  // In compact mode (see #search-root.is-compact in style.css) the input is
  // squeezed to zero width until focused, so it has no clickable area of its
  // own -- clicking anywhere on the visible capsule (really just the icon)
  // needs to focus it manually to trigger the CSS expansion.
  wrapper.addEventListener("click", () => input.focus());

  let matches: Concept[] = [];
  let highlightedIndex = -1;

  function closeDropdown(): void {
    dropdown.hidden = true;
    dropdown.innerHTML = "";
    matches = [];
    highlightedIndex = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function selectConcept(concept: Concept): void {
    closeDropdown();
    input.value = "";
    input.blur();
    options.onSelectConcept(concept.id);
  }

  function setHighlighted(index: number): void {
    highlightedIndex = index;
    const items = dropdown.querySelectorAll<HTMLLIElement>(".search-suggestion");
    items.forEach((item, i) => item.classList.toggle("is-highlighted", i === index));
    const activeItem = items[index];
    if (activeItem) {
      input.setAttribute("aria-activedescendant", activeItem.id);
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function renderMatches(): void {
    const query = input.value.trim().toLowerCase();
    if (!query) {
      closeDropdown();
      return;
    }
    matches = rankMatches(entries, query).slice(0, MAX_SUGGESTIONS);
    dropdown.innerHTML = "";
    if (matches.length === 0) {
      dropdown.hidden = true;
      input.setAttribute("aria-expanded", "false");
      return;
    }
    matches.forEach((concept, i) => {
      const item = document.createElement("li");
      item.id = `${LISTBOX_ID}-option-${i}`;
      item.className = "search-suggestion";
      item.setAttribute("role", "option");
      item.textContent = concept.label;
      // preventDefault keeps the input focused, so the click lands before blur
      // would otherwise close the dropdown out from under it.
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        selectConcept(concept);
      });
      dropdown.appendChild(item);
    });
    dropdown.hidden = false;
    input.setAttribute("aria-expanded", "true");
    setHighlighted(0);
  }

  input.addEventListener("input", renderMatches);

  input.addEventListener("keydown", (event) => {
    if (dropdown.hidden || matches.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((highlightedIndex + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((highlightedIndex - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = matches[highlightedIndex] ?? matches[0];
      if (chosen) selectConcept(chosen);
    } else if (event.key === "Escape") {
      closeDropdown();
      input.blur();
    }
  });

  input.addEventListener("blur", closeDropdown);
}

function rankMatches(entries: SearchEntry[], query: string): Concept[] {
  const scored: { concept: Concept; score: number }[] = [];
  for (const entry of entries) {
    let bestScore = Infinity;
    for (const term of entry.searchTerms) {
      const index = term.indexOf(query);
      if (index === -1) continue;
      bestScore = Math.min(bestScore, index === 0 ? 0 : 1);
    }
    if (bestScore !== Infinity) {
      scored.push({ concept: entry.concept, score: bestScore });
    }
  }
  scored.sort((a, b) => a.score - b.score || a.concept.label.localeCompare(b.concept.label));
  return scored.map((s) => s.concept);
}
