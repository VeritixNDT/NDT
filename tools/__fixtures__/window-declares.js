// Fixture: a global published via window.X rather than a declaration.
// The app does this 18 times; eslint-scope sees a member assignment, not a
// variable, so these need handling or every consumer is a false positive.
window.fixtureWindowGlobal = function () { return 2; };
