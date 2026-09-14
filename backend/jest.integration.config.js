/** @type {import('jest').Config} */
// Database-backed tests. Run with TEST_DATABASE_URL set: npm run test:integration --workspace=backend
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__integration__/**/*.int.test.ts"],
};
