# CR-KL-003 · Addendum aprobado a KL 1.0 (instancia dedicada)

Addendum que formaliza la **instancia Cloud SQL dedicada** para `beeside_kl` y las desviaciones de implementación verificadas en G1–G2 (roles por SQL, Cloud Scheduler en `us-south1`, almacén local de desarrollo). **No modifica CR-KL-002.**

| Archivo | Contenido |
|---|---|
| `CR-KL-003.md` | Decisiones del PO sobre la v0.1, decisión, evidencia, reglas **C1–C6**, secciones de CR-KL-002 que sustituye, condiciones G1–G4 y riesgos |
| `CR-KL-003_Anexo_Implementacion.md` | Reglas operativas **AI-1…AI-3** (antes C7–C9) y su verificación en dev |
| `CR-KL-003_Recomendacion_Plataforma.md` | Recomendación a Plataforma (degradar `beeside_app`) y defectos relacionados; no normativa, no enviada |
| `MANIFEST.sha256` | Huellas de los archivos anteriores |

**Estado:** **aprobado por el PO el 17-oct-2026** (versión 1.0; texto del borrador v0.2 con las cinco decisiones del PO). Se aplica sobre CR-KL-002 (que no se modifica) y sobre `kl-design-1.0-frozen`. **Integridad:** desde esta carpeta, `shasum -a 256 -c MANIFEST.sha256`. Por decisión del PO **no se fija en el preflight por ahora**.
