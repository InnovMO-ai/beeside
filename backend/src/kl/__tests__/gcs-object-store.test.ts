import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { GcsObjectStore, GcsObjectStoreError } from "../ingest/gcs-object-store";
import { objectStoreFromEnv, LocalObjectStore } from "../ingest/object-store";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const PDF_KEY = "kl/editions/doing_business_mx/2026.1/es.pdf";

/** Servidor de Cloud Storage en memoria (solo lo que usa el adaptador): crea con ifGenerationMatch=0, lee con alt=media. */
function fakeGcs(opts: { failFirst?: number[] } = {}) {
  const objects = new Map<string, Buffer>();
  const calls: { method: string; url: string; auth: string | null }[] = [];
  const transient = [...(opts.failFirst ?? [])];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null });
    if (transient.length > 0) return new Response("boom", { status: transient.shift() as number });
    const u = new URL(url);
    if (method === "POST" && u.pathname.startsWith("/upload/storage/v1/b/bkt/o")) {
      const name = u.searchParams.get("name") as string;
      if (u.searchParams.get("ifGenerationMatch") === "0" && objects.has(name)) return new Response("exists", { status: 412 });
      objects.set(name, Buffer.from(init?.body as Buffer));
      return new Response(JSON.stringify({ name }), { status: 200 });
    }
    const m = u.pathname.match(/^\/storage\/v1\/b\/bkt\/o\/(.+)$/);
    if (method === "GET" && m) {
      const obj = objects.get(decodeURIComponent(m[1] as string));
      return obj ? new Response(obj, { status: 200 }) : new Response("nope", { status: 404 });
    }
    return new Response("bad", { status: 400 });
  }) as typeof fetch;
  return { objects, calls, fetchImpl };
}

const make = (g: ReturnType<typeof fakeGcs>, tokenCalls = { n: 0 }) =>
  new GcsObjectStore("bkt", { endpoint: "https://gcs.test", fetchImpl: g.fetchImpl, tokenProvider: async () => { tokenCalls.n += 1; return "tok-secret"; }, backoffMs: 1 });

describe("GcsObjectStore (almacén de objetos de KL en Cloud Storage, D8)", () => {
  it("guarda por huella, es idempotente con el mismo contenido y lee los mismos bytes", async () => {
    const g = fakeGcs(); const store = make(g);
    const bytes = Buffer.from("original inmutable");
    const key = await store.put(sha(bytes), bytes);
    expect(key).toBe(`kl/objects/${sha(bytes).slice(0, 2)}/${sha(bytes)}`);
    expect(await store.put(sha(bytes), bytes)).toBe(key); // 412 → compara y no reescribe
    expect(g.objects.size).toBe(1);
    expect((await store.get(key)).equals(bytes)).toBe(true);
  });

  it("toda escritura usa ifGenerationMatch=0 (nunca sobrescribe) y la llave de edición no cambia de contenido", async () => {
    const g = fakeGcs(); const store = make(g);
    const a = Buffer.from("%PDF-a"); const b = Buffer.from("%PDF-b");
    await store.putKeyed(PDF_KEY, sha(a), a);
    expect(g.calls.find((c) => c.method === "POST")?.url).toContain("ifGenerationMatch=0");
    await expect(store.putKeyed(PDF_KEY, sha(b), b)).rejects.toMatchObject({ code: "conflict" });
    expect((await store.get(PDF_KEY)).equals(a)).toBe(true); // el original sigue intacto
    expect(await store.putKeyed(PDF_KEY, sha(a), a)).toBe(PDF_KEY); // mismo contenido: idempotente
  });

  it("rechaza huellas que no corresponden y llaves fuera de los patrones permitidos, sin tocar la red", async () => {
    const g = fakeGcs(); const store = make(g);
    const bytes = Buffer.from("x");
    await expect(store.put(sha(Buffer.from("otro")), bytes)).rejects.toMatchObject({ code: "integrity" });
    await expect(store.putKeyed("kl/editions/../secreto.pdf", sha(bytes), bytes)).rejects.toMatchObject({ code: "invalid_key" });
    await expect(store.putKeyed("kl/otra/cosa.pdf", sha(bytes), bytes)).rejects.toMatchObject({ code: "invalid_key" });
    await expect(store.get("../../etc/passwd")).rejects.toMatchObject({ code: "invalid_key" });
    await expect(store.get("local/ab/" + "a".repeat(64))).rejects.toMatchObject({ code: "invalid_key" });
    expect(g.calls).toHaveLength(0);
  });

  it("un objeto inexistente es not_found; un fallo transitorio se reintenta; uno persistente es unavailable sin exponer el token", async () => {
    const g1 = fakeGcs({ failFirst: [503, 429] }); const s1 = make(g1);
    const bytes = Buffer.from("%PDF-ok");
    await s1.putKeyed(PDF_KEY, sha(bytes), bytes); // 503, 429 y éxito al tercer intento
    expect(g1.calls.filter((c) => c.method === "POST")).toHaveLength(3);
    await expect(make(fakeGcs()).get("kl/previews/doing_business_mx/2026.1/es.pdf")).rejects.toMatchObject({ code: "not_found" });
    const g2 = fakeGcs({ failFirst: [500, 500, 500] });
    const err = await make(g2).get(PDF_KEY).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GcsObjectStoreError);
    expect((err as GcsObjectStoreError).code).toBe("unavailable");
    expect(String((err as Error).message)).not.toContain("tok-secret");
  });

  it("pide el token una sola vez mientras es válido y lo envía como Bearer", async () => {
    const g = fakeGcs(); const tokenCalls = { n: 0 }; const store = make(g, tokenCalls);
    const bytes = Buffer.from("%PDF-t");
    await store.putKeyed(PDF_KEY, sha(bytes), bytes); await store.get(PDF_KEY); await store.get(PDF_KEY);
    expect(tokenCalls.n).toBe(1);
    expect(g.calls.every((c) => c.auth === "Bearer tok-secret")).toBe(true);
  });

  it("valida el nombre del bucket", () => {
    for (const bad of ["", "A", "x", "bucket con espacios", "../x", "UPPER"]) expect(() => new GcsObjectStore(bad)).toThrow();
    expect(() => new GcsObjectStore("beeside-dev-508220-beeside-dev-kl-store")).not.toThrow();
  });
});

describe("objectStoreFromEnv (elección del almacén por entorno)", () => {
  it("con KL_STORE_BUCKET usa Cloud Storage; sin él, el local solo fuera de producción; en producción sin bucket se niega", () => {
    expect(objectStoreFromEnv({ NODE_ENV: "development", KL_STORE_BUCKET: "bkt-dev-1" } as NodeJS.ProcessEnv).kind).toBe("gcs");
    expect(objectStoreFromEnv({ NODE_ENV: "production", KL_STORE_BUCKET: "bkt-prod-1" } as NodeJS.ProcessEnv).kind).toBe("gcs");
    const local = objectStoreFromEnv({ NODE_ENV: "development", KL_STORAGE_DIR: `${tmpdir()}/kl-store-test` } as NodeJS.ProcessEnv);
    expect(local.kind).toBe("local");
    expect(local.store).toBeInstanceOf(LocalObjectStore);
    expect(() => objectStoreFromEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/KL_STORE_BUCKET/);
  });

  it("usa la caducidad real del token de metadatos (expires_in) y vuelve a pedirlo antes de que venza", async () => {
    const g = fakeGcs(); let metaCalls = 0;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("metadata.google.internal")) { metaCalls += 1; return new Response(JSON.stringify({ access_token: `tok-${metaCalls}`, expires_in: 130 }), { status: 200 }); }
      return g.fetchImpl(input, init);
    }) as typeof fetch;
    const store = new GcsObjectStore("bkt", { endpoint: "https://gcs.test", fetchImpl, backoffMs: 1 });
    await store.put(sha(Buffer.from("a")), Buffer.from("a"));
    await store.put(sha(Buffer.from("b")), Buffer.from("b"));
    expect(metaCalls).toBe(2); // 130 s − 120 s de margen = 10 s < 60 s: no se reutiliza (antes se reutilizaba hasta 50 min)
  });

  it("ante un 401 descarta el token y reintenta con uno nuevo", async () => {
    const g = fakeGcs(); const tokens = { n: 0 };
    const store = new GcsObjectStore("bkt", { endpoint: "https://gcs.test", fetchImpl: ((input: string | URL | Request, init?: RequestInit) => g.fetchImpl(input, init)) as typeof fetch, tokenProvider: async () => { tokens.n += 1; return `tok-${tokens.n}`; }, backoffMs: 1 });
    const auths: string[] = [];
    const wrapped = new GcsObjectStore("bkt", {
      endpoint: "https://gcs.test", backoffMs: 1,
      tokenProvider: async () => { tokens.n += 1; return `t${tokens.n}`; },
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        const a = (init?.headers as Record<string, string>).Authorization ?? ""; auths.push(a);
        if (a === "Bearer t1") return new Response("expired", { status: 401 });
        return g.fetchImpl(input, init);
      }) as typeof fetch,
    });
    void store;
    const key = await wrapped.put(sha(Buffer.from("x")), Buffer.from("x"));
    expect(key).toContain("kl/objects/");
    expect(auths[0]).toBe("Bearer t1");
    expect(auths[1]).toBe("Bearer t2");
  });
});
