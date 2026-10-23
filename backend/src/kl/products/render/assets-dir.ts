import { existsSync } from "node:fs";
import { join } from "node:path";

/** Los activos (tema, fuentes, logotipo, paginador) viajan junto al código; en la imagen compilada se buscan también en src/ o en KL_ASSETS_DIR. */
export function resolveAssetsDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.KL_ASSETS_DIR) return env.KL_ASSETS_DIR;
  const local = join(__dirname, "..", "assets");
  if (existsSync(local)) return local;
  const fromDist = join(__dirname, "..", "..", "..", "..", "src", "kl", "products", "assets");
  return existsSync(fromDist) ? fromDist : local;
}
export const ASSETS_DIR = resolveAssetsDir();

