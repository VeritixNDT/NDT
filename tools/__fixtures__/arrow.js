// Fixture: an arrow function passed to a call. eslint-scope reads node.range
// while resolving this shape, so the parser must emit ranges — real js/*.js is
// full of these and crashed the analyser when only `loc` was requested.
function fixtureUsesArrow() { return [1, 2].map((n) => n * 2); }
