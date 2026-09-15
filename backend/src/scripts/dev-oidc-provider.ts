import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import http from "node:http";

/**
 * LOCAL DEVELOPMENT ONLY — a minimal OpenID Connect provider for exercising the real Control Center
 * sign-in flow (Authorization Code + PKCE, signed ID token, JWKS) on a developer machine before the
 * organization's identity provider is chosen. It is not an identity provider choice, has no user
 * store, binds to 127.0.0.1 only, refuses to start in production and is never deployed.
 *
 *   DEV_OIDC_CLIENT_SECRET=<random> npm run dev:oidc --workspace=backend -- --development-only
 */

if (process.env.NODE_ENV === "production" || !process.argv.includes("--development-only")) {
  console.error("refusing to start: the development OIDC provider needs --development-only and never runs in production");
  process.exit(1);
}
const clientSecret = process.env.DEV_OIDC_CLIENT_SECRET;
if (!clientSecret || clientSecret.length < 16) {
  console.error("DEV_OIDC_CLIENT_SECRET (16+ characters) is required");
  process.exit(1);
}

const port = Number(process.env.DEV_OIDC_PORT ?? 9400);
const issuer = `http://localhost:${port}`;
const clientId = process.env.DEV_OIDC_CLIENT_ID ?? "beeside-dev-control-center";
const redirectUri = process.env.DEV_OIDC_REDIRECT_URI ?? "http://localhost:5173/api/admin/auth/callback";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = randomBytes(8).toString("hex");
const jwk = { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" };
const codes = new Map<string, { email: string; nonce: string; challenge: string; expires: number }>();

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function send(res: http.ServerResponse, status: number, body: unknown, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : String(body));
}

async function readForm(req: http.IncomingMessage): Promise<URLSearchParams> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return new URLSearchParams(raw);
}

http
  .createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", issuer);
      if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
        return send(res, 200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, response_types_supported: ["code"], id_token_signing_alg_values_supported: ["RS256"] });
      }
      if (req.method === "GET" && url.pathname === "/jwks") return send(res, 200, { keys: [jwk] });
      if (req.method === "GET" && url.pathname === "/authorize") {
        const q = url.searchParams;
        if (q.get("client_id") !== clientId || q.get("redirect_uri") !== redirectUri || q.get("code_challenge_method") !== "S256") return send(res, 400, "invalid authorization request", "text/plain");
        const hidden = ["state", "nonce", "code_challenge"].map((k) => `<input type="hidden" name="${k}" value="${escape(q.get(k) ?? "")}">`).join("");
        return send(
          res,
          200,
          `<!doctype html><meta charset="utf-8"><title>Development identity provider</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto">
<h1>Development identity provider</h1><p><strong>Local testing only.</strong> Any email typed here is treated as verified.</p>
<form method="post" action="/authorize">${hidden}<label>Work email <input name="email" type="email" required value="${escape(process.env.DEV_OIDC_EMAIL ?? "")}"></label> <button type="submit">Sign in</button></form></body>`,
          "text/html; charset=utf-8",
        );
      }
      if (req.method === "POST" && url.pathname === "/authorize") {
        const form = await readForm(req);
        const code = randomBytes(24).toString("base64url");
        codes.set(code, { email: (form.get("email") ?? "").trim().toLowerCase(), nonce: form.get("nonce") ?? "", challenge: form.get("code_challenge") ?? "", expires: Date.now() + 60_000 });
        const target = new URL(redirectUri);
        target.searchParams.set("code", code);
        target.searchParams.set("state", form.get("state") ?? "");
        res.writeHead(302, { Location: target.toString() });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/token") {
        const form = await readForm(req);
        const entry = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        const verifier = form.get("code_verifier") ?? "";
        if (
          form.get("client_id") !== clientId ||
          form.get("client_secret") !== clientSecret ||
          form.get("redirect_uri") !== redirectUri ||
          !entry ||
          entry.expires < Date.now() ||
          createHash("sha256").update(verifier).digest("base64url") !== entry.challenge
        ) {
          return send(res, 400, { error: "invalid_grant" });
        }
        const now = Math.floor(Date.now() / 1000);
        const payload = { iss: issuer, aud: clientId, sub: `dev-${createHash("sha256").update(entry.email).digest("hex").slice(0, 16)}`, email: entry.email, email_verified: true, nonce: entry.nonce, iat: now, exp: now + 300 };
        const data = `${b64({ alg: "RS256", kid, typ: "JWT" })}.${b64(payload)}`;
        const signature = createSign("RSA-SHA256").update(data).sign(privateKey).toString("base64url");
        return send(res, 200, { id_token: `${data}.${signature}`, token_type: "Bearer", expires_in: 300 });
      }
      send(res, 404, { error: "not_found" });
    })().catch(() => send(res, 500, { error: "server_error" }));
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`[dev-oidc] LOCAL DEVELOPMENT identity provider at ${issuer} (client ${clientId}) — never deploy`);
  });
