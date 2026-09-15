import { createHash, createPublicKey, randomBytes, verify as verifySignature, JsonWebKey } from "node:crypto";

/**
 * Provider-agnostic Admin/Supervisor sign-in (Technical Architecture: "the organization's existing
 * identity provider (SSO)"). No identity provider is selected here: any standards-compliant OpenID
 * Connect provider is configured by issuer, client id and client secret (Secret Manager in a
 * deployment). Authorization Code flow with PKCE (S256), state and nonce; the ID token is verified
 * locally against the provider's published JWKS (RS256 or ES256 only), including issuer, audience,
 * expiry, nonce and a verified email.
 */

export class AdminAuthError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = "AdminAuthError";
  }
}

export interface IdentityClaims {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: true;
}

export interface AdminIdentityProvider {
  readonly issuer: string;
  authorizationUrl(input: { state: string; nonce: string; codeChallenge: string }): Promise<string>;
  exchangeCode(input: { code: string; codeVerifier: string; nonce: string }): Promise<IdentityClaims>;
}

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Optional restriction to the organization's email domains (lower-case). */
  allowedEmailDomains?: string[];
  clockSkewSeconds?: number;
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

type Jwk = JsonWebKey & { kid?: string; use?: string; alg?: string; kty?: string; crv?: string };

export function base64url(input: Buffer): string {
  return input.toString("base64url");
}

export function randomUrlToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

export function pkceChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

function isLocalhostUrl(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

/** HTTPS everywhere; plain HTTP is accepted only for a localhost test/development issuer. */
export function assertSecureUrl(value: unknown, what: string, allowLocalhostHttp: boolean): string {
  if (typeof value !== "string") throw new AdminAuthError("provider_misconfigured", `${what} is missing`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AdminAuthError("provider_misconfigured", `${what} is not a URL`);
  }
  if (url.protocol === "https:" || (allowLocalhostHttp && url.protocol === "http:" && isLocalhostUrl(url))) return value;
  throw new AdminAuthError("provider_misconfigured", `${what} must use HTTPS`);
}

function decodeSegment(segment: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new AdminAuthError("invalid_token", "the ID token is malformed");
  }
}

export interface VerifyIdTokenOptions {
  jwks: { keys: Jwk[] };
  issuer: string;
  clientId: string;
  nonce: string;
  now: Date;
  clockSkewSeconds?: number;
  allowedEmailDomains?: string[];
}

/** Verifies a compact JWS ID token. Throws AdminAuthError with a technical reason on any failure. */
export function verifyIdToken(idToken: unknown, options: VerifyIdTokenOptions): IdentityClaims {
  if (typeof idToken !== "string") throw new AdminAuthError("invalid_token", "no ID token was returned");
  const parts = idToken.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) throw new AdminAuthError("invalid_token", "the ID token is malformed");
  const [headerPart = "", payloadPart = "", signaturePart = ""] = parts;
  const header = decodeSegment(headerPart);
  const claims = decodeSegment(payloadPart);
  const alg = header.alg;
  if (alg !== "RS256" && alg !== "ES256") throw new AdminAuthError("invalid_token", "unsupported ID token algorithm");
  const candidates = options.jwks.keys.filter(
    (k) => (header.kid === undefined || k.kid === header.kid) && (k.use === undefined || k.use === "sig") && (alg === "RS256" ? k.kty === "RSA" : k.kty === "EC" && k.crv === "P-256"),
  );
  if (candidates.length === 0) throw new AdminAuthError("unknown_key", "the ID token signing key is not published by the provider");
  const data = Buffer.from(`${headerPart}.${payloadPart}`);
  const signature = Buffer.from(signaturePart, "base64url");
  const valid = candidates.some((jwk) => {
    try {
      const key = createPublicKey({ key: jwk, format: "jwk" });
      return verifySignature("sha256", data, alg === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key, signature);
    } catch {
      return false;
    }
  });
  if (!valid) throw new AdminAuthError("invalid_signature", "the ID token signature is invalid");

  const skew = options.clockSkewSeconds ?? 60;
  const nowSeconds = Math.floor(options.now.getTime() / 1000);
  if (claims.iss !== options.issuer) throw new AdminAuthError("wrong_issuer", "the ID token was issued by another provider");
  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(options.clientId)) throw new AdminAuthError("wrong_audience", "the ID token is for another client");
  if (audiences.length > 1 && claims.azp !== options.clientId) throw new AdminAuthError("wrong_audience", "the ID token authorized party does not match");
  if (typeof claims.exp !== "number" || claims.exp + skew <= nowSeconds) throw new AdminAuthError("expired", "the ID token has expired");
  if (typeof claims.iat !== "number" || claims.iat - skew > nowSeconds) throw new AdminAuthError("not_yet_valid", "the ID token is not valid yet");
  if (typeof claims.nbf === "number" && claims.nbf - skew > nowSeconds) throw new AdminAuthError("not_yet_valid", "the ID token is not valid yet");
  if (claims.nonce !== options.nonce) throw new AdminAuthError("nonce_mismatch", "the sign-in response does not match this sign-in attempt");
  if (typeof claims.sub !== "string" || claims.sub === "") throw new AdminAuthError("invalid_token", "the ID token has no subject");
  if (typeof claims.email !== "string" || !claims.email.includes("@")) throw new AdminAuthError("email_missing", "the identity provider did not return an email");
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new AdminAuthError("email_unverified", "the email is not verified by the identity provider");
  const email = claims.email.trim().toLowerCase();
  const domain = email.split("@")[1] ?? "";
  if (options.allowedEmailDomains && options.allowedEmailDomains.length > 0 && !options.allowedEmailDomains.includes(domain)) {
    throw new AdminAuthError("domain_not_allowed", "this email domain cannot sign in to the Control Center");
  }
  return { issuer: options.issuer, subject: claims.sub, email, emailVerified: true };
}

export class OidcIdentityProvider implements AdminIdentityProvider {
  private discovery: Discovery | null = null;
  private jwks: { keys: Jwk[] } | null = null;
  private jwksFetchedAt = 0;

  constructor(
    private readonly config: OidcConfig,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly now: () => Date = () => new Date(),
  ) {
    const issuerUrl = new URL(assertSecureUrl(config.issuer, "issuer", true));
    if (issuerUrl.protocol === "http:" && process.env.NODE_ENV === "production") {
      throw new AdminAuthError("provider_misconfigured", "a production identity provider must use HTTPS");
    }
    if (!config.clientId || !config.clientSecret) throw new AdminAuthError("provider_misconfigured", "client id and secret are required");
    assertSecureUrl(config.redirectUri, "redirect URI", true);
  }

  get issuer(): string {
    return this.config.issuer;
  }

  private allowHttp(): boolean {
    return new URL(this.config.issuer).protocol === "http:";
  }

  private async getJson(url: string): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new AdminAuthError("provider_unavailable", `identity provider request failed (${res.status})`);
    const body = (await res.json()) as unknown;
    if (typeof body !== "object" || body === null) throw new AdminAuthError("provider_unavailable", "identity provider returned an invalid response");
    return body as Record<string, unknown>;
  }

  private async getDiscovery(): Promise<Discovery> {
    if (this.discovery) return this.discovery;
    const doc = await this.getJson(`${this.config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
    if (doc.issuer !== this.config.issuer) throw new AdminAuthError("provider_misconfigured", "discovery issuer does not match the configured issuer");
    const allowHttp = this.allowHttp();
    this.discovery = {
      issuer: doc.issuer,
      authorization_endpoint: assertSecureUrl(doc.authorization_endpoint, "authorization endpoint", allowHttp),
      token_endpoint: assertSecureUrl(doc.token_endpoint, "token endpoint", allowHttp),
      jwks_uri: assertSecureUrl(doc.jwks_uri, "JWKS URI", allowHttp),
    };
    return this.discovery;
  }

  private async getJwks(force: boolean): Promise<{ keys: Jwk[] }> {
    const age = Date.now() - this.jwksFetchedAt;
    if (this.jwks && !(force && age > 60_000)) return this.jwks;
    const doc = await this.getJson((await this.getDiscovery()).jwks_uri);
    if (!Array.isArray(doc.keys)) throw new AdminAuthError("provider_unavailable", "the provider JWKS is invalid");
    this.jwks = { keys: doc.keys as Jwk[] };
    this.jwksFetchedAt = Date.now();
    return this.jwks;
  }

  async authorizationUrl(input: { state: string; nonce: string; codeChallenge: string }): Promise<string> {
    const url = new URL((await this.getDiscovery()).authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("scope", "openid email");
    url.searchParams.set("state", input.state);
    url.searchParams.set("nonce", input.nonce);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async exchangeCode(input: { code: string; codeVerifier: string; nonce: string }): Promise<IdentityClaims> {
    const discovery = await this.getDiscovery();
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: this.config.redirectUri,
      code_verifier: input.codeVerifier,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    const res = await this.fetchImpl(discovery.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form.toString(),
    });
    if (!res.ok) throw new AdminAuthError("code_rejected", `the identity provider rejected the sign-in code (${res.status})`);
    const tokens = (await res.json()) as Record<string, unknown>;
    const verifyWith = (jwks: { keys: Jwk[] }) =>
      verifyIdToken(tokens.id_token, {
        jwks,
        issuer: discovery.issuer,
        clientId: this.config.clientId,
        nonce: input.nonce,
        now: this.now(),
        clockSkewSeconds: this.config.clockSkewSeconds,
        allowedEmailDomains: this.config.allowedEmailDomains,
      });
    try {
      return verifyWith(await this.getJwks(false));
    } catch (error) {
      // Signing keys rotate: refresh the JWKS once when the key is unknown.
      if (error instanceof AdminAuthError && error.reason === "unknown_key") return verifyWith(await this.getJwks(true));
      throw error;
    }
  }
}
