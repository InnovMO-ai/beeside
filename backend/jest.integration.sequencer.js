const Sequencer = require("@jest/test-sequencer").default;

/**
 * The manifest registry/publish suite asserts what a publish does on a database with NO published manifests, while the API and CRP
 * suites publish the bundled manifests and commit. Running it first keeps the shared test database order independent.
 */
class IntegrationSequencer extends Sequencer {
  sort(tests) {
    const first = (t) => (t.path.includes("registry-publish") ? 0 : 1);
    return [...tests].sort((a, b) => first(a) - first(b) || a.path.localeCompare(b.path));
  }
}
module.exports = IntegrationSequencer;
