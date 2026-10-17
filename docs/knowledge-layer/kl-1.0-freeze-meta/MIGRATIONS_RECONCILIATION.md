# Estrategia de reconciliación de migraciones · KL 1.0

Estado: aceptada por el PO el 16-oct-2026 para **desarrollo aislado con identificadores provisionales**. No fija numeración definitiva ni autoriza aplicar nada sobre bases compartidas.

## 1. Hechos verificados (16-oct-2026)

| Línea | Commit | Migraciones |
|---|---|---|
| `origin/main` (base de KL) | `bc3f527` | `0000 … 0016_fa4_public_v1_integrity` |
| `feat/fa4-launch-config` (Discovery) | `e9b258d` | `0017_fa4_marketing_consent … 0023_fa4_public_v1_envelope_integrity` |
| `feature/precision-v2-f5` (Precision) | `a8f8f3e` | `0017_precision_persistence … 0026_precision_product_surface_integrity` |

- **Colisión:** Discovery y Precision usan los números 0017–0023 para migraciones distintas, y sus entradas `idx`/`tag` del `meta/_journal.json` también chocan.
- **Comportamiento del migrador** (`backend/src/scripts/migrate.ts` → `drizzle-orm@0.45.2`, `pg-core/dialect.js`):
  - Lee solo la última fila aplicada de `drizzle.__drizzle_migrations` (`order by created_at desc limit 1`).
  - Aplica únicamente las migraciones cuyo `when` del journal es **mayor** que ese `created_at`.
  - No compara las huellas de las migraciones ya aplicadas.
- **Consecuencia:** una migración con `when` anterior a la última aplicada en un entorno **se omite en silencio**. Este riesgo es de la convergencia Discovery/Precision (P5), no de KL, pero afecta a cualquier migración que se agregue después.

## 2. Reglas

1. Nunca se renumera, renombra ni edita una migración ya aplicada en un entorno compartido. Su `tag`, su SQL (huella) y su `when` son inmutables.
2. KL no aplica migraciones a bases compartidas ni fija números definitivos hasta que P5 deje en `main` un journal único y contiguo (condición A3).
3. Mientras tanto, KL desarrolla con **identificadores provisionales** y fuera del journal oficial.

## 3. Desarrollo aislado (ahora)

- El SQL de KL vive en `backend/src/kl/db/provisional/` con nombres `KLP-001_kl_<tema>.sql` y su pareja `KLP-001_kl_<tema>_integrity.sql`, en el orden de la Spec §5.
- **No** se agregan a `backend/db/migrations/` ni a `meta/_journal.json`.
- Un arnés de prueba (solo local o CI con base de datos efímera) hace lo siguiente:
  1. Aplica las migraciones oficiales de la rama base.
  2. Aplica después los `KLP-*` en orden.
  3. Corre las pruebas de integridad.
- Cada `KLP-*` queda con su SHA-256 en `backend/src/kl/db/provisional/MANIFEST.sha256`. Ese archivo es la huella que se conservará en la integración.
- **Lint obligatorio en CI:**
  - Los `KLP-*` solo crean o alteran objetos del esquema `kl`.
  - Además pueden crear los roles y permisos listados en Contratos §8: `kl_owner`, `kl_app`, `kl_reader_precision`, `kl_agent` y `kl_knowledge`.
  - No tocan tablas de `public`, `drizzle` ni de otros módulos.

## 4. Integración (después de P5)

1. **Inventario por entorno compartido**, en solo lectura: exportar `drizzle.__drizzle_migrations` (hash y `created_at`) de cada base y compararlo con el journal convergido de `main`. Las tres condiciones deben cumplirse; si alguna falla, se detiene y se escala al responsable de P5:
   - Toda fila aplicada existe en el journal.
   - Ninguna fila aplicada cambió de huella.
   - No hay migraciones del journal con `when` menor al último aplicado que sigan pendientes, porque serían omitidas en silencio.
2. **Asignación definitiva para KL:**
   - `idx` = cabeza del journal + 1, consecutivos.
   - `tag` = `00NN_kl_<tema>` y `00NN_kl_<tema>_integrity`.
   - `when` estrictamente mayor que la cabeza del journal y que el máximo `created_at` de todos los entornos objetivo.
   - El SQL es byte a byte el de los `KLP-*`; solo cambia el nombre del archivo.
3. **Prueba en seco:** para cada entorno, restaurar una copia y correr `migrate.ts`. El resultado esperado es que se apliquen exactamente las migraciones KL, en orden, y que la base quede igual fuera del esquema `kl`.
4. **Reversión:**
   - Fuera de producción: `DROP SCHEMA kl CASCADE`, más el retiro de los roles de KL y de las filas KL en `drizzle.__drizzle_migrations`.
   - En producción: el punto de restauración del respaldo acordado en A3.

## 5. Comprobaciones automáticas que Code debe implementar

| # | Comprobación | Cuándo |
|---|---|---|
| M1 | Journal: `idx` contiguo desde 0, `tag` únicos, `when` estrictamente creciente | En cada PR que toque migraciones |
| M2 | Huella de cada `KLP-*` igual a la de `MANIFEST.sha256`; al integrar, igual a la de su `00NN_kl_*` | En cada PR y en la integración |
| M3 | El lint DDL de KL solo toca el esquema `kl` y los roles listados | En cada PR |
| M4 | Por entorno: lo aplicado está contenido en el journal sin cambios, y lo pendiente es exactamente KL | Antes de cada despliegue con migraciones |
| M5 | La prueba en seco sobre una copia reproduce el estado esperado | Antes de la primera aplicación compartida |
