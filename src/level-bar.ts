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
  /**
   * Fired for every tick crossed mid-drag, ahead of the final `onChange`.
   * Expected to redraw the view at that level without touching browser
   * history, so the back button lands on whatever preceded the drag rather
   * than on each level passed through en route.
   */
  onPreview: (level: number) => void;
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

  const row = document.createElement("div");
  row.className = "level-bar-row";

  const leftLabel = document.createElement("span");
  leftLabel.className = "level-bar-edge-label";
  leftLabel.textContent = "Essential";
  row.appendChild(leftLabel);

  const bar = document.createElement("div");
  bar.className = "level-bar";

  const tickEls: HTMLButtonElement[] = [];

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

    // Every tick reserves the same annotation slot, current one included --
    // just left empty and hidden there -- so the number above never shifts
    // vertically depending on whether a "+n"/"-n" annotation is present.
    const annotation = document.createElement("span");
    annotation.className = "level-tick-annotation";
    if (isCurrent) {
      annotation.classList.add("level-tick-annotation--hidden");
      annotation.textContent = " ";
    } else {
      const delta = cumulative[level - 1]! - currentCumulative;
      annotation.textContent = delta > 0 ? `+${delta}` : String(delta);
      tick.addEventListener("click", () => options.onChange(level));
    }
    tick.appendChild(annotation);

    tickEls.push(tick);
    bar.appendChild(tick);
  }

  row.appendChild(bar);

  const rightLabel = document.createElement("span");
  rightLabel.className = "level-bar-edge-label";
  rightLabel.textContent = "Deep dive";
  row.appendChild(rightLabel);

  container.appendChild(row);

  attachDrag(tickEls, options.level - 1, options.onPreview, options.onChange);
}

/**
 * Lets the current tick be dragged left/right, live-previewing each level
 * crossed -- via `onPreview`, which redraws the view but leaves history
 * alone -- and only commits a history entry -- via `onChange` -- once the
 * drag ends on a level different from where it started. Since `onPreview`
 * triggers a full re-render of the level bar itself, the highlighted tick is
 * left to that redraw rather than toggled here. Move/up listeners live on
 * `document` rather than the tick itself so the drag survives the level bar
 * being torn down and rebuilt mid-gesture (which it is, on every crossed
 * tick), and so implicit touch pointer capture (which keeps events targeted
 * at the element under the finger at touchstart) doesn't affect the
 * coordinate-based hit-testing below.
 */
function attachDrag(
  tickEls: HTMLButtonElement[],
  startIndex: number,
  onPreview: (level: number) => void,
  onChange: (level: number) => void,
): void {
  const currentTick = tickEls[startIndex];
  if (!currentTick) return;

  currentTick.addEventListener("pointerdown", (downEvent: PointerEvent) => {
    const tickRects = tickEls.map((tick) => tick.getBoundingClientRect());
    let activeIndex = startIndex;

    // The bar lays out horizontally in portrait/normal-landscape and
    // vertically in compact landscape (see style.css) -- compare the first
    // and last tick's centers to tell which axis actually varies here,
    // rather than assuming, so the drag follows whichever way the ticks run.
    const first = tickRects[0]!;
    const last = tickRects[tickRects.length - 1]!;
    const isVertical =
      Math.abs(last.top - first.top) > Math.abs(last.left - first.left);
    const centerOf = (rect: DOMRect): number => (isVertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2);
    const pointerCoord = (event: PointerEvent): number => (isVertical ? event.clientY : event.clientX);

    const nearestIndex = (coord: number): number => {
      let closest = 0;
      let closestDistance = Infinity;
      tickRects.forEach((rect, i) => {
        const distance = Math.abs(coord - centerOf(rect));
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = i;
        }
      });
      return closest;
    };

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const nextIndex = nearestIndex(pointerCoord(moveEvent));
      if (nextIndex === activeIndex) return;
      activeIndex = nextIndex;
      onPreview(activeIndex + 1);
    };

    const onPointerEnd = (): void => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerEnd);
      document.removeEventListener("pointercancel", onPointerEnd);
      if (activeIndex !== startIndex) onChange(activeIndex + 1);
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerEnd);
    document.addEventListener("pointercancel", onPointerEnd);
    downEvent.preventDefault();
  });
}
