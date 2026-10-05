# FA Public v1.0 — copy decisions (PO, VERIFY close)

Status: **Bucket A (67) applied from canon · Bucket B approved with adjustments · C1–C11 decided · Bucket D (legal / brand) still blocked.**
The decisions are in code (`frontend/src/fa4/copy/ui.ts`, `shared/fa-public-engine/src/engine/yev.ts`, `backend/src/fa4/email.ts`) and asserted by `frontend/src/fa4/copyGate.test.ts`.

Remaining `NEEDS_CANONICAL_COPY` entries (see `COPY_INVENTORY.md`): **4**, all legal / brand blocked:
`continued` (LEGAL-1), `emailHelp` (LEGAL-1), `logoAlt` (BRAND-1), `privacy` (CHK-1).

Notes: the C3 size buckets are 1–10 · 11–50 · 51–250 · 251–1,000 · Más de 1,000 (no overlap). The R1 company block is structured
(`[Company] / [What it does] · [size bucket]`); the size shown is the declared bucket, not a headcount.
