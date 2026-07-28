// Fixture: ECMAScript built-ins. These are not in globals.browser — that set is
// DOM/window APIs only — so resolving against it alone reports every use of
// Math/Object/Promise as an undefined global.
function fixtureUsesBuiltins() {
  return Math.max(1, Number('2')) + JSON.stringify({}).length + Object.keys({}).length;
}
