/** Where the app lives in this run: at the root-built default (`/fa4`, `/api/fa4`) or under the production path (E2E_PREFIX=/discovery → `/discovery/`, `/discovery/api/fa4`). */
export const PREFIX = process.env.E2E_PREFIX ?? "";
export const APP = PREFIX ? `${PREFIX}/` : "/fa4";
export const API = `${PREFIX}/api/fa4`;
export const BRAND = `${PREFIX}/brand`;
