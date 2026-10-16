/**
 * Where the app lives in this run:
 *  - default: root-built, technical `/fa4` + `/api/fa4`;
 *  - E2E_PREFIX=/discovery: production-style build under a shared host path (`/discovery/`, `/discovery/api/fa4`);
 *  - E2E_PREFIX=/: production-style build on a DEDICATED host (the app owns `/`, API at `/api/fa4`).
 */
const RAW = process.env.E2E_PREFIX ?? "";
export const DISCOVERY_MODE = RAW !== "";
export const ROOT_MOUNT = RAW === "/";
export const PREFIX = ROOT_MOUNT ? "" : RAW;
export const APP = DISCOVERY_MODE ? `${PREFIX}/` : "/fa4";
export const API = `${PREFIX}/api/fa4`;
export const BRAND = `${PREFIX}/brand`;
