import { ObjectStore, KEYED_STORAGE_KEY } from "./object-store";
import { sha256OfBytes } from "./upload-validator";

/**
 * Adaptador de Cloud Storage para el almacén de objetos de KL (B9, decisión D8). Usa la API JSON de Cloud Storage con el token de la cuenta de
 * servicio del servidor de metadatos de Cloud Run: **sin dependencias nuevas** (ni `@google-cloud/storage`) y sin llaves.
 *
 * Inmutabilidad: toda escritura lleva `ifGenerationMatch=0` (solo crea; nunca sobrescribe). Si el objeto ya existe, se lee y se compara la huella:
 * igual → idempotente; distinta → error. El bucket además tiene política de retención y versionado (Terraform `modules/kl-runtime`).
 * Nunca se registran tokens ni cuerpos de respuesta.
 */
export interface GcsObjectStoreOptions {
  /** Endpoint base; por omisión el de Google. Para emuladores/pruebas. */
  endpoint?: string;
  /** Proveedor de token; por omisión el servidor de metadatos. Para pruebas. */
  tokenProvider?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Espera entre reintentos (ms); para pruebas. */
  backoffMs?: number;
}

const BUCKET = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;
const CONTENT_KEY = /^kl\/objects\/[0-9a-f]{2}\/[0-9a-f]{64}$/;
const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

export class GcsObjectStoreError extends Error {
  constructor(
    readonly code: "not_found" | "conflict" | "unavailable" | "invalid_key" | "integrity",
    message: string,
  ) {
    super(message);
    this.name = "GcsObjectStoreError";
  }
}

export class GcsObjectStore implements ObjectStore {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private cached: { token: string; expiresAt: number } | null = null;
  private readonly tokenProvider: () => Promise<string>;

  constructor(
    private readonly bucket: string,
    options: GcsObjectStoreOptions = {},
  ) {
    if (!BUCKET.test(bucket)) throw new Error("nombre de bucket no válido");
    this.endpoint = (options.endpoint ?? "https://storage.googleapis.com").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.backoffMs = options.backoffMs ?? 400;
    this.tokenProvider = options.tokenProvider ?? (() => this.metadataToken());
  }

  async put(sha256: string, bytes: Uint8Array): Promise<string> {
    if (!/^[0-9a-f]{64}$/.test(sha256) || sha256OfBytes(bytes) !== sha256) throw new GcsObjectStoreError("integrity", "la huella no corresponde al contenido");
    const key = `kl/objects/${sha256.slice(0, 2)}/${sha256}`;
    await this.createOnce(key, sha256, bytes, "application/octet-stream");
    return key;
  }

  async putKeyed(storageKey: string, sha256: string, bytes: Uint8Array): Promise<string> {
    if (!KEYED_STORAGE_KEY.test(storageKey) || storageKey.includes("..")) throw new GcsObjectStoreError("invalid_key", "llave de almacenamiento no válida");
    if (sha256OfBytes(bytes) !== sha256) throw new GcsObjectStoreError("integrity", "la huella no corresponde al contenido");
    await this.createOnce(storageKey, sha256, bytes, "application/pdf");
    return storageKey;
  }

  async get(storageKey: string): Promise<Buffer> {
    if (!(CONTENT_KEY.test(storageKey) || KEYED_STORAGE_KEY.test(storageKey)) || storageKey.includes("..")) throw new GcsObjectStoreError("invalid_key", "llave de almacenamiento no válida");
    const res = await this.request("GET", `/storage/v1/b/${this.bucket}/o/${encodeURIComponent(storageKey)}?alt=media`);
    if (res.status === 404) throw new GcsObjectStoreError("not_found", "objeto no encontrado");
    if (!res.ok) throw new GcsObjectStoreError("unavailable", `almacenamiento no disponible (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  private async createOnce(key: string, sha256: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const res = await this.request("POST", `/upload/storage/v1/b/${this.bucket}/o?uploadType=media&name=${encodeURIComponent(key)}&ifGenerationMatch=0`, bytes, contentType);
    if (res.ok) return;
    if (res.status === 412) {
      // Ya existe: es idempotente solo si el contenido es exactamente el mismo.
      const existing = await this.get(key);
      if (sha256OfBytes(existing) !== sha256) throw new GcsObjectStoreError("conflict", "la llave ya existe con otro contenido");
      return;
    }
    throw new GcsObjectStoreError("unavailable", `almacenamiento no disponible (HTTP ${res.status})`);
  }

  /** Solicitud con token, tiempo límite y reintentos ante errores transitorios (429/5xx/red). Escribir con `ifGenerationMatch=0` es idempotente. */
  private async request(method: "GET" | "POST", path: string, body?: Uint8Array, contentType?: string): Promise<Response> {
    let last: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const token = await this.token();
        const res = await this.fetchImpl(`${this.endpoint}${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(contentType ? { "Content-Type": contentType } : {}) },
          ...(body ? { body: Buffer.from(body) } : {}),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.status === 401) {
          // Token caducado o revocado: se descarta la caché y se reintenta con uno nuevo (nunca se reutiliza un token rechazado).
          this.cached = null;
          last = new GcsObjectStoreError("unavailable", "almacenamiento no disponible (HTTP 401)");
          try { await res.arrayBuffer(); } catch { /* se descarta el cuerpo */ }
        } else if (res.status === 429 || res.status >= 500) {
          last = new GcsObjectStoreError("unavailable", `almacenamiento no disponible (HTTP ${res.status})`);
          try { await res.arrayBuffer(); } catch { /* se descarta el cuerpo */ }
        } else return res;
      } catch (error) {
        last = error;
      }
      if (attempt < this.maxAttempts) await new Promise((r) => setTimeout(r, this.backoffMs * attempt));
    }
    throw last instanceof GcsObjectStoreError ? last : new GcsObjectStoreError("unavailable", "almacenamiento no disponible");
  }

  private async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now() + 60_000) return this.cached.token;
    this.cached = null;
    const token = await this.tokenProvider();
    // El proveedor por defecto (servidor de metadatos) fija la caducidad REAL (`expires_in`); un proveedor inyectado no la declara y se asume vigencia de 50 min.
    this.cached ??= { token, expiresAt: Date.now() + 50 * 60_000 };
    return token;
  }

  private async metadataToken(): Promise<string> {
    const res = await this.fetchImpl(METADATA_TOKEN_URL, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new GcsObjectStoreError("unavailable", "no se pudo obtener el token de la cuenta de servicio");
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new GcsObjectStoreError("unavailable", "respuesta de token no válida");
    if (typeof body.expires_in === "number" && body.expires_in > 0) this.cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in - 120) * 1000 };
    return body.access_token;
  }
}
