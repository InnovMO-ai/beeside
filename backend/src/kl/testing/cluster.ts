import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Clúster PostgreSQL 16 efímero para las pruebas de KL. Nunca toca una base compartida: arranca su propio
 * directorio de datos en un puerto libre de 127.0.0.1, o usa el superusuario de un servicio de CI
 * (`KL_TEST_PG_URL`, p. ej. `postgres:16` en GitHub Actions).
 */
export interface KlCluster {
  /** URL de superusuario hacia la base de mantenimiento `postgres`. */
  superUrl: string;
  /** Detiene y borra el clúster local (no hace nada con un servicio externo). */
  stop(): void;
}

const ROLES_SQL = path.join(__dirname, "..", "db", "bootstrap", "roles.sql");

export function findPgBin(): string | null {
  const candidates = [
    process.env.KL_PG_BIN,
    path.join(os.homedir(), "Developer", "beeside-kl-tools", "node_modules", "@embedded-postgres", "darwin-arm64", "native", "bin"),
    "/usr/lib/postgresql/16/bin",
    "/opt/homebrew/opt/postgresql@16/bin",
    "/usr/local/opt/postgresql@16/bin",
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) if (fs.existsSync(path.join(dir, "initdb")) && fs.existsSync(path.join(dir, "pg_ctl"))) return dir;
  return null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

export async function startCluster(): Promise<KlCluster> {
  if (process.env.KL_TEST_PG_URL) return { superUrl: process.env.KL_TEST_PG_URL, stop: () => undefined };
  const bin = findPgBin();
  if (!bin) throw new Error("PostgreSQL 16 no encontrado: define KL_PG_BIN o KL_TEST_PG_URL (ver scripts/kl/README.md)");
  const version = spawnSync(path.join(bin, "postgres"), ["--version"], { encoding: "utf8" }).stdout;
  if (!/ 16\./.test(version)) throw new Error(`se requiere PostgreSQL 16 y ${bin} es ${version.trim()}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-pg-"));
  const data = path.join(dir, "data");
  const port = await freePort();
  execFileSync(path.join(bin, "initdb"), ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C"], { stdio: "ignore" });
  execFileSync(
    path.join(bin, "pg_ctl"),
    ["-D", data, "-o", `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${dir} -c fsync=off -c synchronous_commit=off -c max_connections=60`, "-l", path.join(dir, "pg.log"), "-w", "start"],
    { stdio: "ignore" },
  );
  return {
    superUrl: `postgres://postgres@127.0.0.1:${port}/postgres`,
    stop() {
      try {
        execFileSync(path.join(bin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

export function rolesSql(): string {
  return fs.readFileSync(ROLES_SQL, "utf8");
}
