/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Picks up both the __tests__/ suite and co-located unit tests next to their
  // source (e.g. src/fa/engine/*.test.ts, src/precision-context/*.test.ts).
  // __integration__ is excluded here on purpose: those are database-backed
  // *.int.test.ts files run separately via `npm run test:integration` with
  // jest.integration.config.js, so excluding them avoids running the same
  // suite twice under two different configs.
  testMatch: ["**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/__integration__/", "/dist/"],
  collectCoverageFrom: ["src/**/*.ts", "!src/__tests__/**"],
};
