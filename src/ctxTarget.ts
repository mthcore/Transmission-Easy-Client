/**
 * Always-on, per-frame content script with a single job: remember the element
 * the user right-clicked. Chrome's contextMenus.onClicked carries no reference
 * to the clicked element, so when "Add to Transmission" is chosen on something
 * that is NOT a link (a tracker's JavaScript download button), the capture
 * script needs to know which element to re-trigger.
 *
 * It reads nothing, sends nothing, and stores nothing beyond this one element
 * reference — the extension's isolated world shares `window` with the scripts
 * injected later by chrome.scripting.executeScript, which is how they find it.
 */
declare global {
  interface Window {
    __tecContextTarget?: Element | null;
  }
}

document.addEventListener(
  'contextmenu',
  (event) => {
    window.__tecContextTarget = event.target instanceof Element ? event.target : null;
  },
  true
);

export {};
