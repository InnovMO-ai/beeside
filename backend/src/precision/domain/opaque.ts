import { createHash } from "node:crypto";

/** Ids stored with their origin (capability, hash, category key) never reach the client: it only sees opaque, stable ids. */
export const opaqueId = (id: string): string => `i_${createHash("sha256").update(id).digest("hex").slice(0, 14)}`;
export const opaqueGroupId = (categoryKey: string): string => `g_${createHash("sha256").update(`group:${categoryKey}`).digest("hex").slice(0, 14)}`;
