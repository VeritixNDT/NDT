// Fixture: `typeof X` on an undeclared name is legal feature detection, and
// ESLint's no-undef ignores it by default. Flagging it would punish the
// defensive `typeof fn === 'function'` idiom the app uses throughout.
// A real CALL to an undeclared name is still a finding — see typo.js.
function fixtureFeatureDetects() { return typeof fixtureOptionalThing === 'function'; }
