const MEASUREMENT_ID = "G-8L377W52ZQ";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

// Set once initAnalytics succeeds; every tracking call checks it so
// search.ts/share.ts can call trackEvent unconditionally without each
// needing its own import.meta.env.PROD guard.
let initialized = false;

function gtag(...args: unknown[]): void {
  window.dataLayer!.push(args);
}

/**
 * Loads GA4 and disables its automatic page_view (this app never leaves
 * index.html -- "navigation" is a query-param change handled by main.ts's
 * renderRoute, not a real page load) so trackPageView can send one manually
 * per route change instead. No-ops outside production builds, matching
 * main.ts's service-worker registration, so dev traffic never reaches GA4.
 */
export function initAnalytics(): void {
  if (!import.meta.env.PROD || initialized) return;
  initialized = true;

  window.dataLayer = window.dataLayer ?? [];
  gtag("js", new Date());
  gtag("config", MEASUREMENT_ID, { send_page_view: false });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);
}

/** A virtual pageview for one view -- see renderRoute's describeCurrentView. */
export function trackPageView(path: string, title: string): void {
  if (!initialized) return;
  gtag("event", "page_view", {
    page_location: `${location.origin}${path}`,
    page_path: path,
    page_title: title,
  });
}

export function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (!initialized) return;
  gtag("event", name, params);
}
