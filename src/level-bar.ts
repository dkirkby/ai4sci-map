import type { LevelCounts } from "./graph.js";

const LEVEL_LABELS = [
  "Widely recognized",
  "Commonly encountered",
  "Familiar to an interested audience",
  "Mainly technical",
  "Specialist",
];

export interface LevelBarOptions {
  level: number;
  counts: LevelCounts;
  onChange: (level: number) => void;
}

/**
 * The fixed audience-level filter bar shown at the bottom of every view.
 * Non-current ticks are annotated with the cumulative number of concepts in
 * the current view's counts that would be revealed (+) or hidden (-) by
 * jumping straight from `level` to that tick, e.g. going from 3 to 1 hides
 * everything currently visible at levels 2 and 3 combined, not just level 2.
 * Lives outside #app (see search.ts), since #app is fully rebuilt on every
 * redraw but the bar must persist and reflect counts from whichever view was
 * just drawn.
 */
export function renderLevelBar(container: HTMLElement, options: LevelBarOptions): void {
  container.innerHTML = "";

  const cumulative: number[] = [];
  let running = 0;
  for (const count of options.counts) {
    running += count;
    cumulative.push(running);
  }
  const currentCumulative = cumulative[options.level - 1]!;

  const bar = document.createElement("div");
  bar.className = "level-bar";

  for (let level = 1; level <= 5; level++) {
    const isCurrent = level === options.level;

    const tick = document.createElement("button");
    tick.type = "button";
    tick.className = isCurrent ? "level-tick is-current" : "level-tick";
    tick.title = LEVEL_LABELS[level - 1]!;
    tick.setAttribute("aria-pressed", String(isCurrent));

    const number = document.createElement("span");
    number.className = "level-tick-number";
    number.textContent = String(level);
    tick.appendChild(number);

    if (!isCurrent) {
      const delta = cumulative[level - 1]! - currentCumulative;
      const annotation = document.createElement("span");
      annotation.className = "level-tick-annotation";
      annotation.textContent = delta > 0 ? `+${delta}` : String(delta);
      tick.appendChild(annotation);
      tick.addEventListener("click", () => options.onChange(level));
    }

    bar.appendChild(tick);
  }

  container.appendChild(bar);
}
