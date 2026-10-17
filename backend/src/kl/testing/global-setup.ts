import { startCluster, KlCluster } from "./cluster";
import { bootstrapRoles } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var __klCluster: KlCluster | undefined;
}

export default async function globalSetup(): Promise<void> {
  const cluster = await startCluster();
  globalThis.__klCluster = cluster;
  process.env.KL_TEST_PG_URL = cluster.superUrl;
  await bootstrapRoles();
}
