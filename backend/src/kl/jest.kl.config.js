/** @type {import('jest').Config} */
// Pruebas de KL contra un PostgreSQL 16 efímero (nunca una base compartida). Uso: npm run kl:test --workspace=backend
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "../..",
  roots: ["<rootDir>/src/kl"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  globalSetup: "<rootDir>/src/kl/testing/global-setup.ts",
  globalTeardown: "<rootDir>/src/kl/testing/global-teardown.ts",
  testTimeout: 60000,
  maxWorkers: 1,
};
