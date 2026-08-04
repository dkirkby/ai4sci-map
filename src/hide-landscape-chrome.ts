// iOS Safari pins its browser chrome (tab switcher / address bar / share)
// at the top of the screen in landscape and, unlike portrait, never
// auto-collapses it on its own -- but a real scroll gesture does collapse
// it. This fakes that gesture: briefly grow the page a couple px taller
// than the viewport, scroll past the top edge, then shrink back to normal
// -- Safari keeps the chrome collapsed once it's already hidden, and only
// re-expands on a scroll back to the very top, so the temporary height
// doesn't need to persist.
const NUDGE_PX = 2;
// Long enough for the collapse animation and the scroll it triggers to
// finish committing before the extra height is removed.
const RESTORE_DELAY_MS = 400;
// iOS reports the new `orientation`/viewport dimensions a beat after firing
// this event; without a short delay the nudge scrolls before there's
// anything past the top edge to land on.
const ORIENTATION_SETTLE_MS = 300;

function isIPhone(): boolean {
  return /iPhone|iPod/.test(navigator.userAgent);
}

function nudge(): void {
  if (!isIPhone() || !window.matchMedia("(orientation: landscape)").matches) return;

  const html = document.documentElement;
  const previousMinHeight = html.style.minHeight;
  html.style.minHeight = `calc(100% + ${NUDGE_PX}px)`;
  window.scrollTo(0, NUDGE_PX);
  window.setTimeout(() => {
    html.style.minHeight = previousMinHeight;
  }, RESTORE_DELAY_MS);
}

/** Wires up the landscape-chrome-hiding nudge for initial load and rotation. */
export function initHideLandscapeChrome(): void {
  window.addEventListener("load", nudge);
  window.addEventListener("orientationchange", () => window.setTimeout(nudge, ORIENTATION_SETTLE_MS));
}
