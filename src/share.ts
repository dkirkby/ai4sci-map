const COPIED_RESET_DELAY_MS = 1600;

const LINK_ICON_PATHS =
  '<path d="M9 15l6-6"/>' +
  '<path d="M11 6.5l1.5-1.5a3.5 3.5 0 0 1 5 5L16 11.5"/>' +
  '<path d="M13 17.5l-1.5 1.5a3.5 3.5 0 0 1-5-5L8 12.5"/>';

const CHECK_ICON_PATHS = '<path d="M5 13l4 4L19 7"/>';

/**
 * A "copy link" button that copies the current URL to the clipboard. The app
 * already keeps location.href in sync with the centered concept via
 * history.pushState/replaceState (see main.ts), so there's nothing to compute
 * here -- the current URL *is* the shareable link for the current view. Lives
 * outside #app, like search.ts's search box, since #app is fully rebuilt on
 * every graph redraw (see render.ts).
 */
export function initShareButton(container: HTMLElement): void {
  container.innerHTML = "";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "share-button";
  button.setAttribute("aria-label", "Copy link to this view");
  button.title = "Copy link to this view";

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "share-icon");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = LINK_ICON_PATHS;

  const label = document.createElement("span");
  label.className = "share-label";
  label.textContent = "Copy link";
  label.setAttribute("aria-live", "polite");

  button.append(icon, label);
  container.appendChild(button);

  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  function showState(state: "copied" | "failed"): void {
    clearTimeout(resetTimer);
    icon.innerHTML = state === "copied" ? CHECK_ICON_PATHS : LINK_ICON_PATHS;
    label.textContent = state === "copied" ? "Copied!" : "Copy failed";
    button.classList.toggle("is-copied", state === "copied");
    button.classList.toggle("is-failed", state === "failed");
    resetTimer = setTimeout(() => {
      icon.innerHTML = LINK_ICON_PATHS;
      label.textContent = "Copy link";
      button.classList.remove("is-copied", "is-failed");
    }, COPIED_RESET_DELAY_MS);
  }

  button.addEventListener("click", () => {
    navigator.clipboard.writeText(location.href).then(
      () => showState("copied"),
      () => showState("failed"),
    );
  });
}
