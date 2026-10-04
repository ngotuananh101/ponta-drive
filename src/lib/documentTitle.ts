const BRAND = 'Ponta Drive'

/**
 * Sets the browser tab title from an already-resolved string, e.g. a drive or
 * folder name. An empty or missing title falls back to the brand alone.
 *
 * Kept out of the router module so a view can set the title (once the name it
 * wants has loaded) without importing the router, and so tests can exercise it
 * without instantiating a history-backed router.
 */
export function setDocumentTitle(title?: string): void {
  document.title = title ? `${title} - ${BRAND}` : BRAND
}
