import { randomUUID } from "node:crypto";
import { ApiHarness, startApiHarness } from "../testing/api-harness";
import { describeKl } from "../testing/env";

describeKl("R2 · KL Admin API de gobierno y periodicidad", () => {
  let h: ApiHarness;
  const u = (l: string) => h.users[l] as NonNullable<(typeof h.users)[string]>;
  const grant = async (label: string, role: string, extra: object = {}) => {
    await h.mkUser(label, "ADMIN");
    await h.send("post", "padmin", "/role-grants", { adminUserId: u(label).id, role, ...extra }).expect(201);
    await h.get(label, "/me").expect(200);
  };

  beforeAll(async () => {
    h = await startApiHarness();
    await grant("peditor", "KL_EDITOR");
    await grant("previewer", "KL_REVIEWER");
    await grant("pspec", "SPECIALIST_VALIDATOR", { domains: ["legal.mx"] });
    await h.mkUser("psup", "SUPERVISOR");
  });
  afterAll(() => h.close());

  it("productos: solo KL_ADMIN crea y cambia la periodicidad; 'daily' y valores desconocidos se rechazan en la API", async () => {
    await h.send("post", "peditor", "/products", { key: "doing_business_mx", country: "MX" }).expect(403);
    await h.send("post", "padmin", "/products", { key: "Doing Business", country: "MX" }).expect(422);
    await h.send("post", "padmin", "/products", { key: "doing_business_mx", country: "MX", reviewPeriodicity: "daily" }).expect(422);
    await h.send("post", "padmin", "/products", { key: "doing_business_mx", country: "MX" }).expect(201);
    await h.send("post", "padmin", "/products", { key: "doing_business_mx", country: "MX" }).expect(409);
    const list = await h.get("padmin", "/products").expect(200);
    expect(list.body.items[0]).toMatchObject({ key: "doing_business_mx", review_periodicity: "semiannual" });
    await h.send("patch", "peditor", "/products/doing_business_mx", { reviewPeriodicity: "monthly" }).expect(403);
    await h.send("patch", "padmin", "/products/doing_business_mx", { reviewPeriodicity: "daily" }).expect(422);
    await h.send("patch", "padmin", "/products/doing_business_mx", { reviewPeriodicity: "semiannual" }).expect(409);
    const ok = await h.send("patch", "padmin", "/products/doing_business_mx", { reviewPeriodicity: "quarterly", reason: "ciclo trimestral" }).expect(200);
    expect(ok.body.nextCycleAt).toBeTruthy();
    expect((await h.adminAudit("kl.product.periodicity")).filter((e) => e.outcome === "ALLOWED")).toHaveLength(1);
    expect((await h.adminAudit("kl.product.periodicity")).filter((e) => e.outcome === "DENIED")).toHaveLength(1);
    await h.send("patch", "padmin", "/products/no_existe", { reviewPeriodicity: "monthly" }).expect(404);
  });

  it("fuentes: frecuencia propia, herencia y excepción por la API, con la programación efectiva visible", async () => {
    const { withAttestation } = await import("../db/attested-tx");
    const { klAdmin } = await import("../service/admin-service");
    await withAttestation(h.klApp, { adminUserId: u("peditor").id, email: u("peditor").email, role: "ADMIN", sessionId: randomUUID() }, randomUUID(), async (tx) => {
      await klAdmin.proposeInstitution(tx, { key: "inst.r2", name: "Inst", country: "MX", authorityClass: "A", kind: "public" });
      await klAdmin.proposePublication(tx, { key: "pub.r2", institutionKey: "inst.r2", title: "Pub", jurisdiction: "MX", officialUrl: "https://r2.sintetico.example/x", permittedUse: "paraphrase_and_cite", defaultContentRisk: "low" });
    });
    await h.send("post", "padmin", "/publications/pub.r2/decision", { decision: "approve" }).expect(200);
    await h.send("patch", "previewer", "/publications/pub.r2", { checkFrequency: "weekly" }).expect(403);
    await h.send("patch", "padmin", "/publications/pub.r2", { checkFrequency: "daily" }).expect(422);
    await h.send("patch", "padmin", "/publications/pub.r2", { checkFrequency: "inherit" }).expect(409); // ya es inherit
    const set = await h.send("patch", "padmin", "/publications/pub.r2", { checkFrequency: "monthly", reason: "ventana mensual" }).expect(200);
    expect(new Date(set.body.nextCheckAt).getTime()).toBeGreaterThan(Date.now() + 25 * 86_400_000);
    const sched = await h.get("peditor", "/schedule").expect(200);
    expect(sched.body.items.find((r: { key: string }) => r.key === "pub.r2")).toMatchObject({ check_frequency: "monthly", effective_check_frequency: "monthly" });
    await h.send("put", "padmin", "/settings/ram-cadence", { cadence: "daily" }).expect(422);
    await h.send("put", "padmin", "/settings/ram-cadence", { cadence: "none" }).expect(200);
    await h.send("put", "peditor", "/settings/ram-cadence", { cadence: "weekly" }).expect(403);
  });

  it("«Revisar ahora»: KL_EDITOR y KL_ADMIN, con motivo; un revisor o un supervisor no; queda auditada en ambas bases", async () => {
    await h.send("post", "peditor", "/publications/pub.r2/check-now", {}).expect(422); // sin motivo
    await h.send("post", "previewer", "/publications/pub.r2/check-now", { reason: "quiero revisar" }).expect(403);
    await h.send("post", "psup", "/publications/pub.r2/check-now", { reason: "solo lectura" }).expect(403);
    const res = await h.send("post", "peditor", "/publications/pub.r2/check-now", { reason: "la fuente anunció un cambio" }).expect(202);
    expect(res.body.jobs).toHaveLength(1);
    const again = await h.send("post", "padmin", "/publications/pub.r2/check-now", { reason: "confirmación del administrador" }).expect(202);
    expect(again.body.jobs).toEqual(res.body.jobs);
    expect((await h.klAudit("kl.check_now")).some((e) => e.request_id === res.headers["x-request-id"] && e.reason === "la fuente anunció un cambio")).toBe(true);
    expect((await h.adminAudit("kl.check_now")).some((e) => e.request_id === res.headers["x-request-id"] && e.outcome === "ALLOWED")).toBe(true);
    await h.send("post", "peditor", "/publications/no.existe/check-now", { reason: "motivo válido" }).expect(409);
    await h.send("post", "peditor", "/products/doing_business_mx/check-now", { reason: "producto sin fuentes" }).expect(409);
  });

  it("edición extraordinaria: solo KL_ADMIN, con código y motivo; una pendiente por producto", async () => {
    await h.send("post", "peditor", "/products/doing_business_mx/extraordinary-edition", { reasonCode: "reforma_dof", reason: "reforma" }).expect(403);
    await h.send("post", "padmin", "/products/doing_business_mx/extraordinary-edition", { reason: "sin código" }).expect(422);
    await h.send("post", "padmin", "/products/doing_business_mx/extraordinary-edition", { reasonCode: "reforma_dof" }).expect(422);
    const ok = await h.send("post", "padmin", "/products/doing_business_mx/extraordinary-edition", { reasonCode: "reforma_dof", reason: "reforma publicada en el DOF" }).expect(202);
    expect(ok.body.jobId).toMatch(/^[0-9a-f-]{36}$/);
    await h.send("post", "padmin", "/products/doing_business_mx/extraordinary-edition", { reasonCode: "otra", reason: "segunda" }).expect(409);
    expect((await h.klAudit("kl.extraordinary_edition")).some((e) => e.request_id === ok.headers["x-request-id"])).toBe(true);
  });

  it("validadores y validación por la API, con autorización por rol y dominio", async () => {
    await h.send("post", "peditor", "/validators", { kind: "external", displayName: "Despacho", domains: ["legal.mx"] }).expect(403);
    await h.send("post", "previewer", "/validators", { kind: "external", displayName: "Despacho", domains: [] }).expect(422);
    await h.send("post", "previewer", "/validators", { kind: "internal", displayName: "Sin usuario", domains: ["legal.mx"] }).expect(422);
    await h.send("post", "previewer", "/validators", { kind: "internal", adminUserId: randomUUID(), displayName: "Fantasma", domains: ["legal.mx"] }).expect(422);
    const ext = await h.send("post", "previewer", "/validators", { kind: "external", displayName: "Despacho Sintético", organization: "Firma", domains: ["legal.mx"], engagementRef: "ENG-1" }).expect(201);
    const internal = await h.send("post", "previewer", "/validators", { kind: "internal", adminUserId: u("pspec").id, displayName: "Especialista", domains: ["legal.mx"] }).expect(201);
    expect((await h.get("peditor", "/validators").expect(200)).body.items).toHaveLength(2);
    await h.send("patch", "previewer", `/validators/${ext.body.id}`, { status: "inactive" }).expect(403);
    await h.send("patch", "padmin", `/validators/${ext.body.id}`, { status: "borrado" }).expect(422);
    await h.send("patch", "padmin", `/validators/${ext.body.id}`, { status: "inactive", reason: "contrato terminado" }).expect(200);
    await h.send("patch", "padmin", `/validators/${ext.body.id}`, { status: "inactive" }).expect(409);
    await h.send("patch", "padmin", "/validators/no-es-uuid", { status: "active" }).expect(404);

    // una versión de nivel 3 esperando validación (creada con las funciones de la base: la UI de edición llega después)
    const { withAttestation } = await import("../db/attested-tx");
    const { klAdmin } = await import("../service/admin-service");
    const as = (label: string) => ({ adminUserId: u(label).id, email: u(label).email, role: "ADMIN" as const, sessionId: randomUUID() });
    const versionId = await withAttestation(h.klApp, as("peditor"), randomUUID(), async (tx) => {
      const id = await klAdmin.createCardVersion(tx, { unitKey: "card.mx.r2.norma", country: "MX", topicKey: "r2.norma", contentRisk: "high", cardType: "normative", titleEs: "Norma", bodyEs: "Texto normativo sintético.", limitsEs: ["Límite"], variantEn: { title: "Rule", body: "Synthetic rule text." } });
      await klAdmin.submitVersion(tx, id);
      return id;
    });
    await withAttestation(h.klApp, as("previewer"), randomUUID(), (tx) => klAdmin.approveVersion(tx, versionId));
    const body = { validatorId: internal.body.id, domain: "legal.mx", scopeStatement: "alcance sintético", locale: "es", verdict: "approved", validatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString() };
    await h.send("post", "peditor", `/unit-versions/${versionId}/validations`, body).expect(403);
    await h.send("post", "pspec", `/unit-versions/${versionId}/validations`, { ...body, domain: "fiscal.mx" }).expect(403); // fuera de su dominio
    await h.send("post", "pspec", `/unit-versions/${versionId}/validations`, { ...body, verdict: "quizas" }).expect(422);
    await h.send("post", "pspec", `/unit-versions/${versionId}/validations`, { ...body, expiresAt: new Date(Date.now() + 400 * 86_400_000).toISOString() }).expect(422); // más de 12 meses
    const queue = await h.get("pspec", "/validation-queue").expect(200);
    expect(queue.body.items).toEqual([]); // la versión no declara dominio de especialista: un validador no ve lo que no es de su dominio
    const done = await h.send("post", "pspec", `/unit-versions/${versionId}/validations`, body).expect(201);
    expect(done.body.result).toBe("published");
    expect((await h.klAudit("kl.validation.record")).some((e) => e.request_id === done.headers["x-request-id"])).toBe(true);
  });

  it("el supervisor de plataforma lee las vistas de R2; ninguna acción de R2 funciona sin sesión", async () => {
    for (const r of ["products", "validators", "schedule", "audit-correlation"]) await h.get("psup", `/${r}`).expect(200);
    const anon = await import("supertest");
    await anon.default(h.app).patch("/api/admin/kl/products/doing_business_mx").set({ "x-beeside-admin": "1", origin: "https://admin.test" }).send({ reviewPeriodicity: "weekly" }).expect(401);
  });
});
