import { createSign, generateKeyPairSync, sign as signRaw } from "node:crypto";
import { openLoginState, parseCookies, safeReturnTo, sealLoginState } from "../admin/admin-session";
import { AdminAuthError, pkceChallenge, verifyIdToken } from "../admin/oidc";
import { PERMISSIONS, can, permissionsFor } from "../admin/rbac";
import { buildQuestionBankBundle } from "../fa/content/question-bank";
import { validateQuestionBankBundle } from "../fa/engine/validate-bundle";
import {
  LIFECYCLE_POLICY_V1,
  LifecyclePolicy,
  lifecyclePolicyOf,
  lifecyclePolicyToConfig,
  openAccessWindow,
  recoveryDue,
  reminderDue,
  retentionFromOrigin,
  validateLifecyclePolicyConfig,
} from "../fa/services/access-lifecycle";
import { KNOWN_QUESTION_SCHEMA_FINGERPRINTS, questionSchemaFingerprint } from "../fa/services/bundle-store";
import { adminDepsFromEnv } from "../index";
import { sanitizeAuditDetails } from "../operations/audit";
import { backoffSeconds, isEmailTemplate, sanitizeDeliveryError, snapshotLinkDays } from "../operations/email-outbox";

const DAY = 86_400_000;
const day = (n: number, base = Date.UTC(2026, 8, 1)) => new Date(base + n * DAY);

describe("access lifecycle policy", () => {
  it("keeps the v1 calendar (15 / 10 / 21 / 45 / 60) valid and coherent", () => {
    expect(validateLifecyclePolicyConfig(lifecyclePolicyToConfig(LIFECYCLE_POLICY_V1))).toEqual([]);
    const w = openAccessWindow(day(0));
    expect([w.expiresAt, w.maxUntil, w.retentionUntil]).toEqual([day(15), day(45), day(60)]);
    expect(retentionFromOrigin(day(0))).toEqual(day(60));
    expect(lifecyclePolicyOf({})).toEqual({ policy: LIFECYCLE_POLICY_V1, source: "legacy_default" });
    expect(lifecyclePolicyOf(buildQuestionBankBundle()).source).toBe("bundle");
  });

  it("rejects incoherent calendars instead of silently changing one number", () => {
    const base = lifecyclePolicyToConfig(LIFECYCLE_POLICY_V1);
    expect(validateLifecyclePolicyConfig({ ...base, initial_access_days: 21 })).toContain("lifecycle.recovery_email_day must fall after the initial expiry and before the maximum access day");
    expect(validateLifecyclePolicyConfig({ ...base, reminder_day: 15 })).toContain("lifecycle.reminder_day must come before access expires");
    expect(validateLifecyclePolicyConfig({ ...base, extension_days: [20] })[0]).toMatch(/extension_days/);
    expect(validateLifecyclePolicyConfig({ ...base, temporary_retention_day: 30 })).toContain("lifecycle.temporary_retention_day cannot end before the maximum access day");
    expect(validateLifecyclePolicyConfig({ ...base, initial_access_days: 21, reminder_day: 16, recovery_email_day: 27 })).toEqual([]);
  });

  it("sends one reminder at the lead time before expiry and one recovery email while still recoverable", () => {
    const p: LifecyclePolicy = LIFECYCLE_POLICY_V1;
    const m = { accessWindowStartedAt: day(0), accessExpiresAt: day(15), accessMaxUntil: day(45), reminderSentAt: null, recoverySentAt: null };
    expect(reminderDue(m, p, day(9.9))).toBe(false);
    expect(reminderDue(m, p, day(10))).toBe(true);
    expect(reminderDue({ ...m, reminderSentAt: day(10) }, p, day(11))).toBe(false);
    // Extended before day 10: the reminder waits until 5 days before the new expiry.
    expect(reminderDue({ ...m, accessExpiresAt: day(30) }, p, day(10))).toBe(false);
    expect(reminderDue({ ...m, accessExpiresAt: day(30) }, p, day(25))).toBe(true);
    expect(reminderDue(m, p, day(15))).toBe(false);
    expect(recoveryDue(m, p, day(20.9))).toBe(false);
    expect(recoveryDue(m, p, day(21))).toBe(true);
    expect(recoveryDue({ ...m, recoverySentAt: day(21) }, p, day(22))).toBe(false);
    expect(recoveryDue(m, p, day(45))).toBe(false);
    // After the recovery email nothing else is automated.
    expect(reminderDue({ ...m, accessExpiresAt: day(40), recoverySentAt: day(21) }, p, day(36))).toBe(false);
  });
});

describe("question bank compatibility and validation", () => {
  it("fingerprints only what the rules engine depends on", () => {
    const bundle = buildQuestionBankBundle();
    const copyChanged = JSON.parse(JSON.stringify(bundle));
    copyChanged.questions[0].copy.en.title = "A different title";
    copyChanged.emails.resume_link.copy.en.subject = "Different";
    copyChanged.lifecycle.initial_access_days = 21;
    expect(questionSchemaFingerprint(copyChanged)).toBe(questionSchemaFingerprint(bundle));
    const logicChanged = JSON.parse(JSON.stringify(bundle));
    logicChanged.questions[0].required = !logicChanged.questions[0].required;
    expect(questionSchemaFingerprint(logicChanged)).not.toBe(questionSchemaFingerprint(bundle));
    // fa-qb-1.1.0 keeps exactly the questions of fa-qb-1.0.0 (the version re-1.0.0 evaluates).
    expect(questionSchemaFingerprint(bundle)).toBe(KNOWN_QUESTION_SCHEMA_FINGERPRINTS["fa-qb-1.0.0"]);
  });

  it("publishes fa-qb-1.1.0 with valid lifecycle, links, Premium copy and every email in both locales", () => {
    const bundle = buildQuestionBankBundle();
    expect(validateQuestionBankBundle(bundle)).toEqual([]);
    expect(bundle.links.privacy_policy_url).toBeNull();
    const broken = { ...bundle, links: { ...bundle.links, preview_room_url: "http://insecure.example" } };
    expect(validateQuestionBankBundle(broken)).toContain("links.preview_room_url must be an https URL");
    for (const template of ["access_reminder_day10", "access_recovery_day21", "access_followup_missing_information", "access_followup_something_else"]) {
      expect(isEmailTemplate(template)).toBe(true);
    }
    expect(bundle.emails.access_recovery_day21?.copy.en.cta).toBe("Recover my assessment");
    expect(bundle.emails.access_reminder_day10?.copy.en.body).toContain("{{access_until}}");
    const followups = Object.entries(bundle.emails).filter(([name]) => name.startsWith("access_followup_"));
    expect(followups).toHaveLength(4);
    for (const [, email] of followups) {
      expect(email.copy.en.cta).toBe("Continue First Assessment");
      expect(`${email.copy.en.subject} ${email.copy.en.body}`).not.toMatch(/price|\$|discount|limited time|buy|upgrade now/i);
    }
  });
});

describe("email outbox helpers", () => {
  it("backs off exponentially and caps", () => {
    expect([1, 2, 3, 4, 5, 6].map(backoffSeconds)).toEqual([60, 300, 1800, 7200, 43_200, 43_200]);
  });
  it("never stores recipient addresses in delivery errors", () => {
    expect(sanitizeDeliveryError(new Error("550 mailbox ana.rivera@northwind.example unavailable"))).toBe("550 mailbox [address] unavailable");
  });
  it("keeps Snapshot link validity separate and configurable (default 60 days)", () => {
    expect(snapshotLinkDays({})).toBe(60);
    expect(snapshotLinkDays({ links: { snapshot_link_days: 90 } })).toBe(90);
    expect(snapshotLinkDays({ links: { snapshot_link_days: -1 } })).toBe(60);
  });
});

describe("RBAC", () => {
  it("makes SUPERVISOR strictly read-only and ADMIN complete", () => {
    expect(permissionsFor("SUPERVISOR").sort()).toEqual(["config.read", "operations.read", "projects.read"]);
    expect(permissionsFor("ADMIN").sort()).toEqual((Object.keys(PERMISSIONS) as string[]).sort());
    for (const permission of ["config.write", "config.publish", "operations.execute", "premium.manage", "audit.read", "admin_users.manage"] as const) {
      expect(can("SUPERVISOR", permission)).toBe(false);
    }
  });
});

describe("audit details", () => {
  it("keeps technical facts and drops personal data and secrets", () => {
    expect(sanitizeAuditDetails({ reason: "denied for ana@x.example", email: "ana@x.example", token: "abc", query_length: 4, deleted_rows: { answer: 3 } })).toEqual({
      reason: "denied for [address]",
      query_length: 4,
      deleted_rows: { answer: 3 },
    });
  });
});

describe("admin sign-in primitives", () => {
  const secret = "unit-login-state-secret-0123456789abcdef";
  it("seals the login state and refuses tampered or expired cookies", () => {
    const now = new Date();
    const sealed = sealLoginState(secret, { state: "s", nonce: "n", verifier: "v", returnTo: "/admin", exp: now.getTime() + 60_000 });
    expect(openLoginState(secret, sealed, now)).toMatchObject({ state: "s", nonce: "n" });
    expect(openLoginState(secret, `${sealed}x`, now)).toBeNull();
    expect(openLoginState("another-secret-0123456789abcdef-012345", sealed, now)).toBeNull();
    expect(openLoginState(secret, sealed, new Date(now.getTime() + 120_000))).toBeNull();
  });
  it("only redirects to the Control Center after sign-in", () => {
    expect(safeReturnTo("/admin/projects")).toBe("/admin/projects");
    for (const bad of ["https://evil.example", "//evil.example", "/admin//evil.example", "/admin/../api", "/other"]) expect(safeReturnTo(bad)).toBe("/admin");
    expect(parseCookies("a=1; beeside_admin_session=tok%3D; b")).toEqual({ a: "1", beeside_admin_session: "tok=" });
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("ID token verification", () => {
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwks = {
    keys: [
      { ...rsa.publicKey.export({ format: "jwk" }), kid: "rsa-1", use: "sig" },
      { ...ec.publicKey.export({ format: "jwk" }), kid: "ec-1", use: "sig" },
    ],
  };
  const now = new Date("2026-09-15T12:00:00Z");
  const seconds = Math.floor(now.getTime() / 1000);
  const claims = { iss: "https://idp.example", aud: "client-1", sub: "subject-1", email: "Ops@Beeside-Ops.example", email_verified: true, nonce: "nonce-1", iat: seconds, exp: seconds + 300 };
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const rs256 = (payload: object, header: object = { alg: "RS256", kid: "rsa-1" }) => {
    const data = `${b64(header)}.${b64(payload)}`;
    return `${data}.${createSign("RSA-SHA256").update(data).sign(rsa.privateKey).toString("base64url")}`;
  };
  const es256 = (payload: object) => {
    const data = `${b64({ alg: "ES256", kid: "ec-1" })}.${b64(payload)}`;
    return `${data}.${signRaw("sha256", Buffer.from(data), { key: ec.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  };
  const options = { jwks, issuer: "https://idp.example", clientId: "client-1", nonce: "nonce-1", now };
  const reason = (fn: () => unknown) => {
    try {
      fn();
      return "accepted";
    } catch (error) {
      return error instanceof AdminAuthError ? error.reason : String(error);
    }
  };

  it("accepts RS256 and ES256 tokens from the configured provider", () => {
    expect(verifyIdToken(rs256(claims), options)).toEqual({ issuer: "https://idp.example", subject: "subject-1", email: "ops@beeside-ops.example", emailVerified: true });
    expect(verifyIdToken(es256(claims), options).subject).toBe("subject-1");
  });

  it("rejects every forged, replayed, misdirected or unverified token", () => {
    const [h, p] = rs256(claims).split(".");
    expect(reason(() => verifyIdToken(`${b64({ alg: "none" })}.${p}.`, options))).toBe("invalid_token");
    expect(reason(() => verifyIdToken(rs256(claims, { alg: "HS256", kid: "rsa-1" }), options))).toBe("invalid_token");
    expect(reason(() => verifyIdToken(rs256(claims, { alg: "RS256", kid: "rotated" }), options))).toBe("unknown_key");
    expect(reason(() => verifyIdToken(`${h}.${b64({ ...claims, email: "attacker@evil.example" })}.${rs256(claims).split(".")[2]}`, options))).toBe("invalid_signature");
    expect(reason(() => verifyIdToken(rs256({ ...claims, iss: "https://other.example" }), options))).toBe("wrong_issuer");
    expect(reason(() => verifyIdToken(rs256({ ...claims, aud: "another-client" }), options))).toBe("wrong_audience");
    expect(reason(() => verifyIdToken(rs256({ ...claims, aud: ["client-1", "x"], azp: "x" }), options))).toBe("wrong_audience");
    expect(reason(() => verifyIdToken(rs256({ ...claims, exp: seconds - 120 }), options))).toBe("expired");
    expect(reason(() => verifyIdToken(rs256({ ...claims, nonce: "old" }), options))).toBe("nonce_mismatch");
    expect(reason(() => verifyIdToken(rs256({ ...claims, email_verified: false }), options))).toBe("email_unverified");
    expect(reason(() => verifyIdToken(rs256(claims), { ...options, allowedEmailDomains: ["beeside.you"] }))).toBe("domain_not_allowed");
  });
});

describe("Admin API configuration", () => {
  const complete = {
    ADMIN_API_ENABLED: "true",
    DATABASE_URL: "postgres://localhost:1/none",
    APP_BASE_URL: "https://fa.example",
    ADMIN_APP_ORIGIN: "https://admin.example",
    ADMIN_OIDC_ISSUER: "https://idp.example",
    ADMIN_OIDC_CLIENT_ID: "client",
    ADMIN_OIDC_CLIENT_SECRET: "secret",
    ADMIN_OIDC_REDIRECT_URI: "https://admin.example/api/admin/auth/callback",
    ADMIN_SESSION_SECRET: "a-session-secret-that-is-long-enough-000",
  };
  it("is never mounted by convenience", () => {
    expect(adminDepsFromEnv({})).toBeUndefined();
    expect(() => adminDepsFromEnv({ ADMIN_API_ENABLED: "true" })).toThrow(/requires/);
    expect(() => adminDepsFromEnv({ ...complete, ADMIN_SESSION_SECRET: "short" })).toThrow(/at least 32/);
    expect(() => adminDepsFromEnv({ ...complete, ADMIN_COOKIE_SECURE: "false", NODE_ENV: "production" })).toThrow(/not allowed in production/);
    expect(() => adminDepsFromEnv({ ...complete, ADMIN_OIDC_ISSUER: "http://idp.example" })).toThrow(/HTTPS/);
    expect(adminDepsFromEnv(complete)?.session).toMatchObject({ cookieSecure: true, idleTimeoutMinutes: 30 });
  });
});
