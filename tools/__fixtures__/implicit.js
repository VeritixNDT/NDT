// Fixture: assignment to an undeclared name. Invisible while no-undef is off,
// and a hard throw under ES-module strict mode.
function fixtureSetsImplicit() { fixtureImplicitTarget = 5; }
