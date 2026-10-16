import http from "node:http";
import type { AddressInfo } from "node:net";
import { startHealthServer } from "./worker";

describe("worker health listener (Cloud Run needs a port to call the revision healthy)", () => {
  it("answers /health with no data and 404 for everything else", async () => {
    const server = startHealthServer(0);
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as AddressInfo).port;
    const get = (path: string) => new Promise<{ status: number; body: string }>((resolve, reject) => { http.get({ host: "127.0.0.1", port, path }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b })); }).on("error", reject); });
    expect(await get("/health")).toEqual({ status: 200, body: '{"status":"ok","service":"discovery-worker","busy":false}' });
    expect((await get("/")).status).toBe(200); expect((await get("/anything")).status).toBe(404);
    await new Promise((r) => server.close(r));
  });
});
