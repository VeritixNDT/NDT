// Fixture: references a name that exists in no file — the bug this tool exists
// to catch. Today it fails only when a user clicks the control that calls it.
function fixtureTypoCaller() { return fixtureHelpr(); }
