import * as fs from "node:fs";
import * as path from "node:path";
import { sha256OfBytes } from "./upload-validator";

/** Almacén de originales inmutables. La implementación local es solo de desarrollo; producción usa el bucket privado con retención (B9). */
export interface ObjectStore {
  /** Guarda por huella; si ya existe con la misma huella no escribe de nuevo. Devuelve la llave de almacenamiento. */
  put(sha256: string, bytes: Uint8Array): Promise<string>;
  get(storageKey: string): Promise<Buffer>;
  /** Guarda bajo una llave fija de edición o vista previa (`kl/editions/…` o `kl/previews/…`); inmutable y verificada por huella. */
  putKeyed(storageKey: string, sha256: string, bytes: Uint8Array): Promise<string>;
}

const KEYED = /^kl\/(editions|previews)\/[a-z0-9_]+(\/[A-Za-z0-9._-]+){2,3}\.pdf$/;

export class LocalObjectStore implements ObjectStore {
  constructor(
    private readonly root: string,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    if (env.NODE_ENV === "production") throw new Error("LocalObjectStore es solo de desarrollo (B9: producción usa el bucket privado con retención)");
    fs.mkdirSync(root, { recursive: true });
  }

  async put(sha256: string, bytes: Uint8Array): Promise<string> {
    if (sha256OfBytes(bytes) !== sha256) throw new Error("la huella no corresponde al contenido");
    const key = `local/${sha256.slice(0, 2)}/${sha256}`;
    const file = path.join(this.root, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o444 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return key;
  }

  async putKeyed(storageKey: string, sha256: string, bytes: Uint8Array): Promise<string> {
    if (!KEYED.test(storageKey) || storageKey.includes("..")) throw new Error("llave de almacenamiento no válida");
    if (sha256OfBytes(bytes) !== sha256) throw new Error("la huella no corresponde al contenido");
    const file = path.join(this.root, storageKey);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o444 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (sha256OfBytes(fs.readFileSync(file)) !== sha256) throw new Error("la llave ya existe con otro contenido");
    }
    return storageKey;
  }

  async get(storageKey: string): Promise<Buffer> {
    const ok = /^local\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(storageKey) || (KEYED.test(storageKey) && !storageKey.includes(".."));
    if (!ok) throw new Error("llave de almacenamiento no válida");
    return fs.readFileSync(path.join(this.root, storageKey));
  }
}
