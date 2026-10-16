/* eslint-disable @typescript-eslint/no-require-imports */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { evaluate, parseEnvFile } = require("../../../scripts/fa4-production-preflight.js") as {
  evaluate: (env: Record<string, string>, opts?: { dist?: string }) => { rows: Array<{ id: string; status: string; detail: string }>; blocked: number };
  parseEnvFile: (t: string) => Record<string, string>;
};

const OK: Record<string, string> = {
  PROJECT_ID: "beeside-prod-1", REGION: "northamerica-south1", SQL_CONNECTION_NAME: "beeside-prod-1:northamerica-south1:discovery-db", IMAGE_TAG: "abc1234",
  PUBLIC_BASE_URL: "https://beeside.you", PUBLIC_PATH: "/discovery", FA4_PUBLIC_PATH: "/discovery", APP_BASE_URL: "https://beeside.you", ALLOWED_ORIGINS: "https://beeside.you",
  OPS_CONTROL_MODE: "reserved", NODE_ENV: "production", TRUST_PROXY_HOPS: "2", VITE_BASE_PATH: "/discovery/", VITE_DISCOVERY_ONLY: "true", PREMIUM_PURCHASE_DEFERRED_ACK: "true",
  SECRET_DATABASE_URL: "disc-db-url", SECRET_MIGRATION_DATABASE_URL: "disc-mig-url", SECRET_HASH: "disc-hash", SECRET_SMTP_PASSWORD: "disc-smtp", SECRET_ACCESS_GATE_CREDENTIALS: "disc-gate",
  FA4_PRIVACY_VERSION: "TEST-ID", FA4_EMAIL_TRANSPORT: "smtp", SMTP_HOST: "smtp.example", SMTP_PORT: "587", SMTP_USER: "contact@beeside.you", MAIL_FROM: "contact@beeside.you", MAIL_REPLY_TO: "contact@beeside.you",
  DEPLOY_WORKER: "true", MAIL_DNS_CONFIRMED: "true", LAUNCH_PHASE: "controlled", ACCESS_GATE_MODE: "basic", ROBOTS_NOINDEX: "true",
  DB_PROVISIONED_CONFIRMED: "true", DB_BACKUPS_CONFIRMED: "true", DB_PITR_CONFIRMED: "true", EDGE_ROUTING_CONFIRMED: "true", ORG_POLICY_CONFIRMED: "true", ALERT_CHANNEL: "12345",
};
const blockedIds = (env: Record<string, string>) => evaluate(env).rows.filter((r) => ["MISSING", "INVALID", "EXTERNAL"].includes(r.status)).map((r) => r.id);

describe("production preflight (refuses a deployment while configuration is missing)", () => {
  it("a complete controlled-launch configuration passes (WARN for LEGAL-1 until Legal clears real data)", () => {
    const r = evaluate(OK); expect(r.blocked).toBe(0);
    expect(r.rows.find((x) => x.id === "LEGAL-1 final validation")!.status).toBe("WARN");
  });
  it("the shipped template is NOT deployable as is (everything external/missing is reported)", () => {
    const env = parseEnvFile(fs.readFileSync(path.join(__dirname, "../../../deploy/production/production.env.example"), "utf8"));
    const r = evaluate(env); expect(r.blocked).toBeGreaterThan(10);
    expect(r.rows.find((x) => x.id === "ALERT_CHANNEL (who is notified)")!.status).toBe("MISSING");     // inline comments are not values
  });
  it.each<[string, Record<string, string>, string]>([
    ["a development project", { PROJECT_ID: "beeside-dev-508220" }, "PROJECT_ID is a production project"],
    ["the shared dev Cloud SQL instance", { SQL_CONNECTION_NAME: "beeside-prod-1:northamerica-south1:beeside-dev-canonical-db" }, "Cloud SQL instance is not the dev instance"],
    ["an unpinned image", { IMAGE_TAG: "latest" }, "IMAGE_TAG"],
    ["the technical /fa4 as the public path", { PUBLIC_PATH: "/fa4", FA4_PUBLIC_PATH: "/fa4" }, "PUBLIC_PATH is /discovery (shared host) or / (dedicated host)"],
    ["e-mailed links not pointing at the public path", { FA4_PUBLIC_PATH: "/fa4" }, "FA4_PUBLIC_PATH matches PUBLIC_PATH (e-mailed links)"],
    ["an http origin", { PUBLIC_BASE_URL: "http://beeside.you", APP_BASE_URL: "http://beeside.you", ALLOWED_ORIGINS: "http://beeside.you" }, "PUBLIC_BASE_URL = https host without path"],
    ["a root-built web bundle for a path deployment", { VITE_BASE_PATH: "/" }, "VITE_BASE_PATH matches PUBLIC_PATH"],
    ["taking over the company site root", { PUBLIC_PATH: "/", FA4_PUBLIC_PATH: "/", VITE_BASE_PATH: "/" }, "PUBLIC_PATH is /discovery (shared host) or / (dedicated host)"],
    ["a bundle that still contains the legacy apps", { VITE_DISCOVERY_ONLY: "" }, "VITE_DISCOVERY_ONLY = true"],
    ["an admin surface wired before it exists", { OPS_CONTROL_MODE: "admin" }, "/ops-control reserved (no admin surface wired)"],
    ["internal-staging mode left on", { FA4_ENV: "staging" }, "no internal-staging mode"],
    ["a development switch", { FA4_EMAIL_DISPATCH: "inline" }, "no development switches"],
    ["a database credential inlined", { DATABASE_URL: "postgres://x:y@h/db" }, "migration credential not given to runtime services"],
    ["runtime and migration sharing one credential", { SECRET_MIGRATION_DATABASE_URL: "disc-db-url" }, "runtime and migration secrets differ"],
    ["no proxy-hop count", { TRUST_PROXY_HOPS: "" }, "TRUST_PROXY_HOPS"],
    ["no Privacy version (never invented)", { FA4_PRIVACY_VERSION: "" }, "FA4_PRIVACY_VERSION"],
    ["log-only e-mail", { FA4_EMAIL_TRANSPORT: "log" }, "e-mail transport is real SMTP"],
    ["another sender mailbox", { MAIL_FROM: "someone@beeside.you" }, "sender, Reply-To and contact mailbox are contact@beeside.you"],
    ["no outbox worker", { DEPLOY_WORKER: "" }, "FA4 outbox worker"],
    ["no explicit launch phase", { LAUNCH_PHASE: "" }, "LAUNCH_PHASE"],
    ["no gate mode (no implicit default)", { ACCESS_GATE_MODE: "" }, "ACCESS_GATE_MODE"],
    ["an open gate during the controlled phase", { ACCESS_GATE_MODE: "off" }, "controlled phase keeps a gate"],
    ["an indexable closed environment", { ROBOTS_NOINDEX: "" }, "controlled phase is not indexable"],
    ["a basic gate without its credentials secret", { SECRET_ACCESS_GATE_CREDENTIALS: "" }, "SECRET_ACCESS_GATE_CREDENTIALS"],
    ["an edge gate nobody confirmed", { ACCESS_GATE_MODE: "edge" }, "edge access control (IAP / Cloud Armor / proxy)"],
    ["no purchase URL and no acknowledgement", { PREMIUM_PURCHASE_DEFERRED_ACK: "" }, "VITE_FA4_PREMIUM_PURCHASE_URL"],
    ["a non-https purchase URL", { VITE_FA4_PREMIUM_PURCHASE_URL: "http://pay.example" }, "VITE_FA4_PREMIUM_PURCHASE_URL is https"],
    ["no backups confirmation", { DB_BACKUPS_CONFIRMED: "" }, "automated backups enabled"],
    ["no routing confirmation", { EDGE_ROUTING_CONFIRMED: "" }, "DNS + load balancer + certificate route beeside.you/discovery here"],
    ["no alert channel", { ALERT_CHANNEL: "" }, "ALERT_CHANNEL (who is notified)"],
    ["premium commercial content without Legal", { FA4_PREMIUM_COMMERCIAL_CONTENT_ALLOWED: "true" }, "premium commercial content only with Legal"],
  ])("refuses: %s", (_n, patch, id) => {
    expect(blockedIds({ ...OK, ...patch })).toContain(id);
  });
  it("opening commercially needs explicit confirmations, Legal, the purchase URL and the approved comparison — and is otherwise refused", () => {
    const open = { ...OK, LAUNCH_PHASE: "open", ACCESS_GATE_MODE: "off", ROBOTS_NOINDEX: "" };
    const b = blockedIds(open);
    for (const id of ["LEGAL-1 final validation", "VITE_FA4_PREMIUM_PURCHASE_URL", "opening commercially is an explicit confirmation", "open phase: Premium comparison approved"]) expect(b).toContain(id);
    expect(evaluate({ ...open, LEGAL1_CONFIRMED: "true", OPEN_COMMERCIAL_CONFIRMED: "true", COMPARISON_APPROVED: "true", VITE_FA4_PREMIUM_PURCHASE_URL: "https://pay.example/x", PREMIUM_PURCHASE_DEFERRED_ACK: "" }).blocked).toBe(0);
  });
  it("a dedicated host owning / is accepted when everything agrees, and its build must be root-relative", () => {
    const d = { ...OK, PUBLIC_BASE_URL: "https://discovery.beeside.you", APP_BASE_URL: "https://discovery.beeside.you", ALLOWED_ORIGINS: "https://discovery.beeside.you", PUBLIC_PATH: "/", FA4_PUBLIC_PATH: "/", VITE_BASE_PATH: "/" };
    expect(evaluate(d).blocked).toBe(0);
    expect(blockedIds({ ...d, VITE_BASE_PATH: "/discovery/" })).toContain("VITE_BASE_PATH matches PUBLIC_PATH");
  });
  it("never prints a secret value or an inlined credential", () => {
    const out = JSON.stringify(evaluate({ ...OK, DATABASE_URL: "postgres://user:SuperSecret123@h/db" }).rows);
    expect(out).not.toContain("SuperSecret123");
  });
  it("checks the built frontend: only /discovery/ references are accepted", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-dist-"));
    try {
      fs.writeFileSync(path.join(dir, "index.html"), '<script src="/assets/app.js"></script>');
      expect(evaluate(OK, { dist: dir }).rows.find((r: { id: string }) => r.id === "built index.html references only assets under the public path")!.status).toBe("INVALID");
      fs.writeFileSync(path.join(dir, "index.html"), '<script src="/discovery/assets/app.js"></script><link href="/discovery/assets/a.css">');
      expect(evaluate(OK, { dist: dir }).blocked).toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
