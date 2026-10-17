export default function globalTeardown(): void {
  globalThis.__klCluster?.stop();
}
