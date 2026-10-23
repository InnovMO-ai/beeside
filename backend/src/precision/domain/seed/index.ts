export * from "./demo-data";
export * from "./demo-project";
export * from "./demo-script";

/** Neutral names for the composition root: it registers the synthetic project with the FIXTURE providers (a no-op for real providers). */
export { loadDemoFixtures as loadFixtureProject } from "./demo-project";
