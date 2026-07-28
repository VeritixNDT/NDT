// Fixture: a global reached ONLY by string dispatch. js/ui.js resolves
// data-action / data-on-change / data-on-input names via `window[action]`, so
// these functions have no direct reference anywhere and would otherwise be
// reported as dead — 410 of the app's 485 orphans were exactly this.
function fixtureDispatchTarget() { return 1; }

function fixtureRendersMarkup() {
  return `<button data-action="fixtureDispatchTarget">Go</button>`;
}
