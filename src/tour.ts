const TOUR_SEEN_KEY = "ai4sci-map:tour-seen";

/**
 * The persistent-UI roots a tour step's target might live in -- passed in by
 * main.ts, which already holds references to all of them. `app` is queried
 * fresh for every step (never a cached node), since `#app` is fully rebuilt
 * on every redraw (see render.ts/CLAUDE.md) and a tour can span several.
 */
export interface TourElements {
  app: HTMLElement;
  searchRoot: HTMLElement;
  shareRoot: HTMLElement;
  levelBarRoot: HTMLElement;
  helpRoot: HTMLElement;
}

interface TourStep {
  resolveTarget: (els: TourElements) => HTMLElement | null;
  text: string;
}

/**
 * One step per major control. `resolveTarget` doubles as this step's "is it
 * even present" check -- a step whose target can't be found (no satellites
 * at this level, no acronyms on this concept, the share button hidden under
 * 760px -- see style.css) is skipped rather than shown pointing at nothing.
 */
function buildSteps(tap: string, tapLower: string): TourStep[] {
  return [
    {
      resolveTarget: (els) => els.app.querySelector<HTMLElement>(".center-card"),
      text: "This is the concept you're viewing, with its description and everything directly related to it around it.",
    },
    {
      resolveTarget: (els) => els.searchRoot.querySelector<HTMLElement>(".search-box"),
      text: "Search jumps straight to any concept by name, alias, or acronym — not just what's on screen.",
    },
    {
      resolveTarget: (els) => els.app.querySelector<HTMLElement>(".satellite"),
      text: `${tap} a satellite to make it the new center.`,
    },
    {
      resolveTarget: (els) => els.app.querySelector<HTMLElement>(".center-card-kind"),
      text: `${tap} the kind label to browse every concept of that kind.`,
    },
    {
      resolveTarget: (els) => els.app.querySelector<HTMLElement>(".acronym-link"),
      text: `${tap} an acronym to see where else it's used.`,
    },
    {
      resolveTarget: (els) => els.levelBarRoot.querySelector<HTMLElement>(".level-bar"),
      text: `Drag the marker to show more or less detail, or ${tapLower} a number to jump straight there.`,
    },
    {
      // .share-button exists in the DOM even when hidden by the <760px
      // breakpoint (style.css); offsetParent is null exactly when an
      // element (or an ancestor) is display:none, so this reuses that
      // breakpoint's effect instead of duplicating its threshold here.
      resolveTarget: (els) => {
        const button = els.shareRoot.querySelector<HTMLElement>(".share-button");
        return button && button.offsetParent !== null ? button : null;
      },
      text: "Copy link grabs a URL for exactly this view, to share or bookmark.",
    },
    {
      resolveTarget: (els) => els.helpRoot.querySelector<HTMLElement>(".help-button"),
      text: 'Come back here any time — or press "?" — for the full reference.',
    },
  ];
}

interface ActiveTour {
  advance: () => void;
  end: (markAsSeen: boolean) => void;
}

// Module-level rather than a returned handle: main.ts calls notifyNavigation
// after every real navigation regardless of whether a tour happens to be
// running, and help.ts stops the tour before opening its panel the same
// way -- both are simpler as unconditional calls than threading a handle
// through both call sites.
let active: ActiveTour | null = null;

export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === "1";
  } catch {
    // Storage inaccessible (private browsing, quota) -- treat as "seen" so
    // a tour that can't remember itself doesn't force-show every visit.
    return true;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, "1");
  } catch {
    /* Same fallback as hasSeenTour -- nothing to do if storage is unavailable. */
  }
}

/**
 * Called after every *committed* navigation (main.ts's `commitNavigation`,
 * which wraps every `history.pushState` call) so an in-progress tour step
 * can advance itself once the user actually does what it's describing --
 * e.g. clicking the spotlighted satellite for real, which is left fully
 * clickable (see startTour's pointer-events handling below). Deliberately
 * not wired to resize-triggered or level-bar-preview redraws, which redraw
 * #app without pushing history -- those aren't the user trying the
 * demonstrated action, just the same view relaying out or a mid-drag
 * preview, and shouldn't burn through tour steps on their own. A no-op when
 * no tour is running.
 */
export function notifyNavigation(): void {
  active?.advance();
}

/** Ends the active tour, if any, marking it seen. Safe to call unconditionally. */
export function stopTour(): void {
  active?.end(true);
}

/**
 * Starts the guided tour: a spotlight (a box-shadow cutout, so the
 * highlighted control stays fully interactive underneath -- no separate
 * page-blocking backdrop) plus a callout bubble with Back/Next/Skip. Ends
 * itself (and remembers via `hasSeenTour`) once every resolvable step has
 * been shown.
 */
export function startTour(elements: TourElements): void {
  if (active) return;

  const isTouch = window.matchMedia("(pointer: coarse)").matches;
  const tap = isTouch ? "Tap" : "Click";
  const tapLower = tap.toLowerCase();
  const steps = buildSteps(tap, tapLower);

  // Fixed once at start, from what's resolvable right now, so "N of M"
  // stays stable for the rest of the tour -- `render` still re-resolves
  // each step's actual target live (never a cached node) and skips forward
  // if a later step's target has since disappeared, but M itself doesn't
  // keep changing underneath the visitor.
  const order = steps.map((_, i) => i).filter((i) => steps[i]!.resolveTarget(elements) !== null);
  if (order.length === 0) return;

  const previouslyFocused = document.activeElement as HTMLElement | null;

  const spotlight = document.createElement("div");
  spotlight.className = "tour-spotlight";

  const callout = document.createElement("div");
  callout.className = "tour-callout";
  callout.setAttribute("role", "region");
  callout.setAttribute("aria-label", "Guided tour");
  // On the whole callout, not just the text -- so a step change announces
  // its position ("3 of 7") together with its text as one utterance, rather
  // than a screen reader only picking up the text and leaving the count to
  // be discovered separately.
  callout.setAttribute("aria-live", "polite");

  const progress = document.createElement("p");
  progress.className = "tour-callout-progress";

  const text = document.createElement("p");
  text.className = "tour-callout-text";

  const actions = document.createElement("div");
  actions.className = "tour-callout-actions";

  const skipButton = document.createElement("button");
  skipButton.type = "button";
  skipButton.className = "tour-callout-skip";
  skipButton.textContent = "Skip tour";

  const nav = document.createElement("div");
  nav.className = "tour-callout-nav";

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "tour-callout-back";
  backButton.textContent = "Back";

  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "tour-callout-next";

  nav.append(backButton, nextButton);
  actions.append(skipButton, nav);
  callout.append(progress, text, actions);
  elements.helpRoot.append(spotlight, callout);

  let pos = 0;

  function positionSpotlight(target: HTMLElement): void {
    const rect = target.getBoundingClientRect();
    const padding = 8;
    spotlight.style.top = `${rect.top - padding}px`;
    spotlight.style.left = `${rect.left - padding}px`;
    spotlight.style.width = `${rect.width + padding * 2}px`;
    spotlight.style.height = `${rect.height + padding * 2}px`;
  }

  function positionCallout(target: HTMLElement): void {
    const rect = target.getBoundingClientRect();
    const calloutRect = callout.getBoundingClientRect();
    const margin = 12;

    const fitsBelow = rect.bottom + margin + calloutRect.height <= window.innerHeight;
    const top = fitsBelow ? rect.bottom + margin : Math.max(margin, rect.top - margin - calloutRect.height);

    const idealLeft = rect.left + rect.width / 2 - calloutRect.width / 2;
    const left = Math.min(Math.max(margin, idealLeft), window.innerWidth - calloutRect.width - margin);

    callout.style.top = `${top}px`;
    callout.style.left = `${left}px`;
  }

  /** Re-locates and repositions the current step's target -- used on window resize. */
  function reposition(): void {
    const target = steps[order[pos]!]?.resolveTarget(elements);
    if (target) {
      positionSpotlight(target);
      positionCallout(target);
    }
  }

  function render(): void {
    while (pos < order.length && !steps[order[pos]!]!.resolveTarget(elements)) {
      pos += 1;
    }
    if (pos >= order.length) {
      end(true);
      return;
    }

    const step = steps[order[pos]!]!;
    const target = step.resolveTarget(elements)!;

    progress.textContent = `${pos + 1} of ${order.length}`;
    text.textContent = step.text;
    backButton.disabled = pos === 0;
    nextButton.textContent = pos === order.length - 1 ? "Done" : "Next";

    positionSpotlight(target);
    positionCallout(target);
    nextButton.focus();
  }

  function goNext(): void {
    if (pos >= order.length - 1) {
      end(true);
      return;
    }
    pos += 1;
    render();
  }

  function goBack(): void {
    if (pos === 0) return;
    pos -= 1;
    render();
  }

  function end(markAsSeen: boolean): void {
    active = null;
    window.removeEventListener("keydown", onKeydown);
    window.removeEventListener("resize", reposition);
    spotlight.remove();
    callout.remove();
    if (markAsSeen) markSeen();
    previouslyFocused?.focus();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      end(true);
      return;
    }
    // Confines Tab to the callout's own controls while a step is active,
    // rather than letting it wander into the page behind the spotlight --
    // which stays fully interactive for pointer/touch (see the spotlight's
    // pointer-events:none in style.css), so keyboard and pointer users get
    // deliberately different paths through the same step.
    if (event.key !== "Tab" || !callout.contains(document.activeElement)) return;
    const focusable = backButton.disabled ? [skipButton, nextButton] : [skipButton, backButton, nextButton];
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  skipButton.addEventListener("click", () => end(true));
  backButton.addEventListener("click", goBack);
  nextButton.addEventListener("click", goNext);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("resize", reposition);

  active = { advance: goNext, end };
  render();
}
