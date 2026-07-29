// Fixture: a handler reached from markup by name. It used to be resolved with
// window[action], so it had no reference anywhere in the source and the orphan
// report needed a data-action regex to avoid calling it dead.
//
// Handlers are registered explicitly now, and that registration IS a real
// reference — so the analyser sees it without any special-casing. A handler
// that markup dispatches but nobody registers SHOULD be reported: it resolves
// to nothing at runtime.
// Stands in for the real registry in js/constants.js.
function vxActions(map) { return map; }

function fixtureDispatchTarget() { return 1; }

function fixtureRendersMarkup() {
  return `<button data-action="fixtureDispatchTarget">Go</button>`;
}

vxActions({ fixtureDispatchTarget });
