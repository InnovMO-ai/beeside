import { ADMIN_LOGIN_COOKIE, ADMIN_SESSION_COOKIE, cookieHeader } from "../admin/admin-session";
import { createAdminRouter } from "../admin/admin-router";

describe("Admin cookies · SameSite", () => {
  it("la cookie de sesión es Strict por omisión y la del estado de inicio de sesión puede ser Lax", () => {
    expect(cookieHeader(ADMIN_SESSION_COOKIE, "t", { secure: true, maxAgeSeconds: 60, path: "/api/admin" })).toContain("SameSite=Strict");
    const login = cookieHeader(ADMIN_LOGIN_COOKIE, "s", { secure: true, maxAgeSeconds: 600, path: "/api/admin/auth", sameSite: "Lax" });
    expect(login).toContain("SameSite=Lax");
    expect(login).not.toContain("SameSite=Strict");
    expect(login).toEqual(expect.stringContaining("HttpOnly"));
    expect(login).toEqual(expect.stringContaining("Secure"));
  });

  it("el inicio de sesión emite la cookie de estado con SameSite=Lax (el regreso desde el IdP es una navegación entre sitios)", async () => {
    const request = (await import("supertest")).default;
    const express = (await import("express")).default;
    const identity = { issuer: "https://idp.test", authorizationUrl: async () => "https://idp.test/auth", exchangeCode: async () => { throw new Error("no"); } };
    const app = express();
    app.use("/api/admin", createAdminRouter({
      fa: { db: { query: async () => ({ rows: [] }), transaction: async (fn: (x: unknown) => unknown) => fn({}) }, config: { now: () => new Date() } },
      identity,
      session: { sessionSecret: "s".repeat(40), sessionTtlMinutes: 480, idleTimeoutMinutes: 30, cookieSecure: true, appOrigin: "https://admin.test" },
    } as never));
    const res = await request(app).get("/api/admin/auth/login");
    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith(`${ADMIN_LOGIN_COOKIE}=`)) as string;
    expect(res.status).toBe(302);
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/api/admin/auth");
  });
});
