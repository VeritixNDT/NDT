// Fixture: a legitimate cross-file reference plus a browser global.
// Neither may be reported — this is the case per-file ESLint cannot see.
function fixtureConsume() {
  document.title = 'x';
  return fixtureHelper();
}
