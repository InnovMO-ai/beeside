/**
 * ADMIN IDENTITY — can the Admin sign-in reuse the organisation's EXISTING Google identity (the same beeside.you Workspace that Google IAP
 * already authenticates) without introducing a separate identity provider?
 *
 * The Admin sign-in is a provider-agnostic OpenID Connect client. This proves, with a token shaped exactly like the ones Google issues
 * (issuer https://accounts.google.com, RS256 from Google's published keys, azp/aud = the client id, `hd` = the Workspace domain,
 * email_verified), that the unchanged code accepts a beeside.you account and refuses everything else.
 */
import { createSign, generateKeyPairSync } from "node:crypto";
import { AdminAuthError, OidcIdentityProvider, pkceChallenge } from "../admin/oidc";

const ISSUER = "https://accounts.google.com";
const CLIENT_ID = "1234567890-abc.apps.googleusercontent.com";
const NOW = new Date("2026-10-16T12:00:00Z");
const secs = Math.floor(NOW.getTime() / 1000);
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString("base64url");
const idToken = (over: Record<string, unknown> = {}, kid = "google-key-1"): string => {
  const data = `${b64({ alg: "RS256", kid, typ: "JWT" })}.${b64({
    iss: ISSUER, azp: CLIENT_ID, aud: CLIENT_ID, sub: "108234726387462387462", hd: "beeside.you", email: "Mike@Beeside.You", email_verified: true,
    at_hash: "x", nonce: "n-1", iat: secs, exp: secs + 3600, ...over,
  })}`;
  return `${data}.${createSign("RSA-SHA256").update(data).sign(rsa.privateKey).toString("base64url")}`;
};

/** A fake Google: the published discovery document, JWKS and token endpoint. */
function fakeGoogle(token: string): { fetch: (url: string, init?: { method?: string; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>; tokenRequests: string[] } {
  const tokenRequests: string[] = [];
  const respond = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  return {
    tokenRequests,
    fetch: async (url, init) => {
      if (url === `${ISSUER}/.well-known/openid-configuration`) return respond({ issuer: ISSUER, authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth", token_endpoint: "https://oauth2.googleapis.com/token", jwks_uri: "https://www.googleapis.com/oauth2/v3/certs" });
      if (url === "https://www.googleapis.com/oauth2/v3/certs") return respond({ keys: [{ ...rsa.publicKey.export({ format: "jwk" }), kid: "google-key-1", use: "sig", alg: "RS256" }] });
      if (url === "https://oauth2.googleapis.com/token" && init?.method === "POST") { tokenRequests.push(init.body ?? ""); return respond({ id_token: token, access_token: "ya29.x", token_type: "Bearer", expires_in: 3599 }); }
      throw new Error(`unexpected request ${url}`);
    },
  };
}
const provider = (token: string, allowed: string[] = ["beeside.you"]) => {
  const g = fakeGoogle(token);
  return { g, p: new OidcIdentityProvider({ issuer: ISSUER, clientId: CLIENT_ID, clientSecret: "client-secret-from-secret-manager", redirectUri: "https://web.example/api/admin/auth/callback", allowedEmailDomains: allowed }, g.fetch, () => NOW) };
};
const reason = async (fn: () => Promise<unknown>): Promise<string> => { try { await fn(); return "accepted"; } catch (e) { return e instanceof AdminAuthError ? e.reason : String(e); } };

describe("Admin sign-in with the organisation's Google identity (no separate IdP)", () => {
  it("builds a Google authorization request: code flow, PKCE S256, state, nonce, openid+email", async () => {
    const { p } = provider(idToken());
    const url = new URL(await p.authorizationUrl({ state: "s-1", nonce: "n-1", codeChallenge: pkceChallenge("verifier-0123456789-0123456789-0123456789") }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: "code", client_id: CLIENT_ID, scope: "openid email", state: "s-1", nonce: "n-1", code_challenge_method: "S256" });
  });

  it("accepts a beeside.you Workspace account (token as Google issues it) and returns its verified identity", async () => {
    const { p, g } = provider(idToken());
    expect(await p.exchangeCode({ code: "c", codeVerifier: "v", nonce: "n-1" })).toEqual({ issuer: ISSUER, subject: "108234726387462387462", email: "mike@beeside.you", emailVerified: true });
    expect(g.tokenRequests[0]).toContain("code_verifier=v");       // PKCE verifier travels with the code
    expect(g.tokenRequests[0]).toContain(`client_id=${encodeURIComponent(CLIENT_ID)}`);
  });

  it("refuses everything that is not a verified beeside.you account", async () => {
    const run = (over: Record<string, unknown>, allowed?: string[]) => { const { p } = provider(idToken(over), allowed); return reason(() => p.exchangeCode({ code: "c", codeVerifier: "v", nonce: "n-1" })); };
    expect(await run({ email: "someone@gmail.com", hd: undefined })).toBe("domain_not_allowed");
    expect(await run({ email: "x@beeside.you.evil.example" })).toBe("domain_not_allowed");
    expect(await run({ email_verified: false })).toBe("email_unverified");
    expect(await run({ aud: "another-client.apps.googleusercontent.com", azp: "another-client.apps.googleusercontent.com" })).toBe("wrong_audience");
    expect(await run({ iss: "https://evil.example" })).toBe("wrong_issuer");
    expect(await run({ nonce: "replayed" })).toBe("nonce_mismatch");
    expect(await run({ exp: secs - 600 })).toBe("expired");
    const { p } = provider(idToken({}, "unknown-kid"));
    expect(await reason(() => p.exchangeCode({ code: "c", codeVerifier: "v", nonce: "n-1" }))).toBe("unknown_key");
  });

  // Authentication is not authorization: a verified Google account becomes an Admin session only if an active, login-enabled admin_user
  // exists for that email (reason "not_provisioned" otherwise) and then only with that user's role (RBAC). Covered by
  // __integration__/admin.int.test.ts ("not_provisioned", "login_not_enabled", "subject_mismatch").
});
