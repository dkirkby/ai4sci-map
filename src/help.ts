import { LEVEL_LABELS } from "./level-bar.js";
import { stopTour } from "./tour.js";
import { CONCEPT_KINDS } from "./types.js";

const GITHUB_REPO_URL = "https://github.com/dkirkby/ai4sci-map";
const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`;
// Deep-links straight to the structured issue form (.github/ISSUE_TEMPLATE/
// concept-suggestion.yml) instead of a blank issue -- a blank GitHub issue
// assumes familiarity with the tracker that most people suggesting a
// concept won't have; a form with labeled fields doesn't.
const GITHUB_SUGGEST_CONCEPT_URL = `${GITHUB_ISSUES_URL}/new?template=concept-suggestion.yml`;

const M_ASAI4S_URL = "https://ai4sci.ps.uci.edu/";
const UCI_URL = "https://uci.edu/";

export interface HelpOptions {
  onStartTour: () => void;
}

/**
 * A floating "?" button (plus a "?" keyboard shortcut) opening a persistent
 * reference panel covering every interaction in the app. Lives outside #app,
 * like search.ts/share.ts, since #app is fully rebuilt on every graph redraw
 * (see render.ts) and this needs to persist across navigations.
 */
export function initHelp(container: HTMLElement, options: HelpOptions): void {
  container.innerHTML = "";

  // Detected once, not watched live -- input mode essentially never changes
  // mid-session, and the panel is opt-in, on-demand UI that doesn't need to
  // react to e.g. a mouse being plugged into a tablet while it's open.
  const isTouch = window.matchMedia("(pointer: coarse)").matches;
  const tap = isTouch ? "Tap" : "Click";
  const tapLower = tap.toLowerCase();
  const zoomHint = isTouch
    ? "Pinch to zoom the diagram, drag to pan."
    : "Scroll or pinch the trackpad to zoom the diagram, drag to pan.";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "help-button";
  button.setAttribute("aria-label", "Help");
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-keyshortcuts", "?");
  button.title = "Help (?)";

  const icon = document.createElement("span");
  icon.className = "help-button-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "?";
  button.appendChild(icon);
  container.appendChild(button);

  let backdrop: HTMLDivElement | null = null;
  let previouslyFocused: HTMLElement | null = null;

  function closePanel(): void {
    if (!backdrop) return;
    backdrop.remove();
    backdrop = null;
    button.setAttribute("aria-expanded", "false");
    previouslyFocused?.focus();
    previouslyFocused = null;
  }

  function openPanel(): void {
    if (backdrop) return;
    // A running tour and the reference panel are both fixed overlays rooted
    // in #help-root -- opening one while the other is up would visually
    // collide, so requesting the panel (button or "?") always wins.
    stopTour();
    previouslyFocused = document.activeElement as HTMLElement | null;
    button.setAttribute("aria-expanded", "true");

    backdrop = document.createElement("div");
    backdrop.className = "help-panel-backdrop";
    backdrop.tabIndex = -1;
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closePanel();
    });

    const panel = document.createElement("div");
    panel.className = "help-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "help-panel-title");
    panel.addEventListener("click", (event) => event.stopPropagation());

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "help-panel-close";
    closeButton.setAttribute("aria-label", "Close");
    closeButton.textContent = "×";
    closeButton.addEventListener("click", closePanel);
    panel.appendChild(closeButton);

    const title = document.createElement("h2");
    title.id = "help-panel-title";
    title.className = "help-panel-title";
    title.textContent = "Help";
    panel.appendChild(title);

    const tourButton = document.createElement("button");
    tourButton.type = "button";
    tourButton.className = "help-panel-tour-button";
    tourButton.textContent = "Take the tour";
    tourButton.addEventListener("click", () => {
      closePanel();
      options.onStartTour();
    });
    panel.appendChild(tourButton);

    panel.appendChild(
      buildSection(
        "Getting started",
        buildList([
          `${tap} a satellite to make it the new center.`,
          `${tap} the kind label on the center card (e.g. "architecture") to browse every concept of that kind.`,
          `${tap} an acronym on the center card to see where else it's used.`,
          `Long descriptions are cut off — ${tapLower} to read the rest.`,
          zoomHint,
          "Search matches every concept, not just what's on screen — a dimmed result is above your current detail level.",
          "Copy link grabs a URL for exactly what you're looking at.",
          `Drag the marker on the bar at the bottom to show more ("Deep dive") or less ("Essential") detail, or ${tapLower} a number to jump straight there; the +/− numbers preview what a jump would change.`,
        ]),
      ),
    );

    panel.appendChild(
      buildSection(
        "Reading the diagram",
        buildList([
          "Colors and arrows show how concepts relate to each other — hover (or tap) any line for its exact relationship.",
          "A line always reads the same way, source → target, no matter which end is in the center.",
          "Curved arcs connect two satellites to each other, not to the center.",
        ]),
      ),
    );

    panel.appendChild(buildSection("Audience levels", buildLevelList()));

    panel.appendChild(
      buildSection(
        "Concept kinds",
        buildText(
          `Every concept has one of ${CONCEPT_KINDS.length} kinds (field, architecture, task, and so on), shown as the small label above its name. ${tap} it to browse everything of that kind.`,
        ),
      ),
    );

    panel.appendChild(buildAboutSection());

    // `aria-modal="true"` above claims the page behind the panel is inert,
    // so Tab needs to actually honor that -- without this, there's nothing
    // stopping focus from walking out of the panel into the page underneath
    // it (the panel's own elements are the last thing in the DOM, per
    // index.html's ordering, so forward-Tab off the last one would otherwise
    // wrap around to the very first focusable element on the page instead of
    // back to the top of the panel).
    backdrop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePanel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = panel.querySelectorAll<HTMLElement>("button, a[href]");
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === backdrop || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === backdrop || active === last) {
        event.preventDefault();
        first.focus();
      }
    });

    backdrop.appendChild(panel);
    container.appendChild(backdrop);
    backdrop.focus();
  }

  button.addEventListener("click", () => {
    if (backdrop) closePanel();
    else openPanel();
  });

  // "?" is an ordinary typeable character, unlike the app's other shortcut
  // keys (Escape, arrow keys) -- skip while a text input has focus so typing
  // a literal "?" into the search box doesn't get eaten by this.
  window.addEventListener("keydown", (event) => {
    if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
    event.preventDefault();
    openPanel();
  });
}

function buildSection(heading: string, content: HTMLElement): HTMLElement {
  const section = document.createElement("div");
  section.className = "help-panel-section";
  const h = document.createElement("h3");
  h.className = "help-panel-section-title";
  h.textContent = heading;
  section.append(h, content);
  return section;
}

function buildList(items: string[]): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "help-panel-list";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  }
  return list;
}

function buildText(text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "help-panel-text";
  p.textContent = text;
  return p;
}

/** Builds a `help-panel-text` paragraph from alternating plain-text and link segments. */
function buildTextWithLinks(...segments: (string | { text: string; href: string })[]): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "help-panel-text";
  for (const segment of segments) {
    if (typeof segment === "string") {
      p.appendChild(document.createTextNode(segment));
    } else {
      const a = document.createElement("a");
      a.href = segment.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = segment.text;
      p.appendChild(a);
    }
  }
  return p;
}

/** Reuses `LEVEL_LABELS` (level-bar.ts) verbatim rather than re-authoring them here. */
function buildLevelList(): HTMLElement {
  const wrapper = document.createElement("div");
  const list = document.createElement("ul");
  list.className = "help-panel-list";
  LEVEL_LABELS.forEach((label, i) => {
    const li = document.createElement("li");
    li.textContent = `${i + 1} — ${label}`;
    list.appendChild(li);
  });
  wrapper.appendChild(list);
  wrapper.appendChild(
    buildText(
      "Only satellites are filtered by this — the concept you're centered on always shows, regardless of its own level.",
    ),
  );
  return wrapper;
}

function buildAboutSection(): HTMLElement {
  const section = document.createElement("div");
  section.className = "help-panel-section";
  const h = document.createElement("h3");
  h.className = "help-panel-section-title";
  h.textContent = "About";
  section.appendChild(h);
  section.appendChild(
    buildText(
      "An interactive map of AI/ML concepts — one concept at a time, surrounded by everything it's directly related to.",
    ),
  );
  section.appendChild(
    buildTextWithLinks(
      "This tool was created for the ",
      { text: "Master of Applied AI for Science", href: M_ASAI4S_URL },
      " at ",
      { text: "UC Irvine", href: UCI_URL },
      " with the help of LLM coding agents.",
    ),
  );
  section.appendChild(buildText("The concept data is hand-authored and validated before every deploy."));

  const links = document.createElement("ul");
  links.className = "help-panel-links";

  const repoItem = document.createElement("li");
  const repoLink = document.createElement("a");
  repoLink.href = GITHUB_REPO_URL;
  repoLink.target = "_blank";
  repoLink.rel = "noopener noreferrer";
  repoLink.textContent = "View source on GitHub";
  repoItem.appendChild(repoLink);
  links.appendChild(repoItem);

  const suggestItem = document.createElement("li");
  const suggestLink = document.createElement("a");
  suggestLink.href = GITHUB_SUGGEST_CONCEPT_URL;
  suggestLink.target = "_blank";
  suggestLink.rel = "noopener noreferrer";
  suggestLink.textContent = "Suggest a new concept";
  suggestItem.appendChild(suggestLink);
  links.appendChild(suggestItem);

  const issuesItem = document.createElement("li");
  const issuesLink = document.createElement("a");
  issuesLink.href = GITHUB_ISSUES_URL;
  issuesLink.target = "_blank";
  issuesLink.rel = "noopener noreferrer";
  issuesLink.textContent = "Report a wrong or outdated concept";
  issuesItem.appendChild(issuesLink);
  links.appendChild(issuesItem);

  section.appendChild(links);
  return section;
}
