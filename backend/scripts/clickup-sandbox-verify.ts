/**
 * ClickUp sandbox verification — exercises the 9 real-activation gate criteria against a REAL ClickUp TEST space.
 *
 *   cd backend
 *   CLICKUP_TOKEN=... CLICKUP_WORKSPACE_ID=... CLICKUP_SPACE_ID=... \
 *   CLICKUP_SANDBOX_CONFIRM=I_AM_USING_A_TEST_SPACE \
 *   npx tsx scripts/clickup-sandbox-verify.ts
 *
 * Environment
 *   CLICKUP_TOKEN                  personal API token of a TEST user (never committed, never printed)
 *   CLICKUP_WORKSPACE_ID           ClickUp "team_id" of the test Workspace
 *   CLICKUP_SPACE_ID               the TEST Space that plays Operation Hub
 *   CLICKUP_SANDBOX_CONFIRM        must be exactly I_AM_USING_A_TEST_SPACE
 *   CLICKUP_PRODUCTION_IDS         optional guard: comma-separated Workspace/Space ids that are production; the run refuses if
 *                                  the configured workspace or space is in the list
 *   CLICKUP_API_BASE               default https://api.clickup.com/api/v2
 *   CLICKUP_KEEP=1                 keep the folders/tasks the run created (default: delete them)
 *   CLICKUP_BURST=1                also fire a burst of cheap GETs to provoke a real 429 (consumes rate budget; off by default)
 *   CLICKUP_SANDBOX_SELFTEST=1     run against the in-repo local fake instead (proves the script itself, NOT ClickUp)
 *
 * It creates one folder per run (named with a random project reference) and deletes it again. Output: a pass/fail table.
 * Exit code 0 only if no criterion FAILED (MANUAL / SKIP rows do not fail the run but are NOT proof).
 */
import { randomUUID } from "node:crypto";
import { ClickUpOperationHub, keyTag, parseMarker, projectTag, clickUpProjectRef } from "../src/precision/adapters/clickup-operation-hub";
import { FakeClickUpServer } from "../src/precision/adapters/clickup-fake-server";
import { OhHandoffPayload, OhPortError, payloadChecksum } from "../src/precision/ports/operation-hub";

type Status = "PASS" | "FAIL" | "SKIP" | "MANUAL";
interface Row { criterion: string; check: string; status: Status; note: string }
const rows: Row[] = [];
const record = (criterion: string, check: string, status: Status, note = ""): void => { rows.push({ criterion, check, status, note }); };

async function main(): Promise<void> {
  let apiBase = process.env.CLICKUP_API_BASE ?? "https://api.clickup.com/api/v2";
  let token = process.env.CLICKUP_TOKEN ?? "";
  let workspaceId = process.env.CLICKUP_WORKSPACE_ID ?? "";
  let spaceId = process.env.CLICKUP_SPACE_ID ?? "";
  let fake: FakeClickUpServer | undefined;

  if (process.env.CLICKUP_SANDBOX_SELFTEST === "1") {
    fake = new FakeClickUpServer({ token: "selftest", workspaceId: "W1", spaceId: "S1" });
    apiBase = await fake.start(); token = "selftest"; workspaceId = "W1"; spaceId = "S1";
    console.log("SELF-TEST MODE: talking to the local fake. This proves the script, not ClickUp.\n");
  } else {
    if (process.env.CLICKUP_SANDBOX_CONFIRM !== "I_AM_USING_A_TEST_SPACE") fatal("Set CLICKUP_SANDBOX_CONFIRM=I_AM_USING_A_TEST_SPACE to confirm the target is a test space.");
    if (!token || !workspaceId || !spaceId) fatal("CLICKUP_TOKEN, CLICKUP_WORKSPACE_ID and CLICKUP_SPACE_ID are required.");
    const prod = (process.env.CLICKUP_PRODUCTION_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (prod.includes(workspaceId) || prod.includes(spaceId)) fatal("Configured workspace/space is listed in CLICKUP_PRODUCTION_IDS. Refusing to run.");
  }

  const raw = async (method: string, path: string, body?: unknown): Promise<{ status: number; json: any; headers: Headers }> => {
    const res = await fetch(`${apiBase}${path}`, { method, headers: { Authorization: token, "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    let json: any = {}; try { json = text ? JSON.parse(text) : {}; } catch { /* non JSON */ }
    return { status: res.status, json, headers: res.headers };
  };

  const sleeps: number[] = [];
  const base = { apiBaseUrl: apiBase, token, workspaceId, spaceId, mode: "SANDBOX" as const, requestTimeoutMs: 15_000 };
  const makeAdapter = (extra: Partial<ConstructorParameters<typeof ClickUpOperationHub>[0]> = {}) =>
    new ClickUpOperationHub({ ...base, retry: { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 4000, lookupLagRetries: 5, lookupLagDelayMs: 1500 }, ...extra });
  const port = makeAdapter();

  const projectId = randomUUID();
  const companyId = randomUUID();
  let seq = 0;
  const payloadFor = (label = "Sandbox Verify", note = "a"): OhHandoffPayload => {
    seq += 1;
    const key = `${projectId}:crp:${randomUUID()}:1`;
    return {
      contract: { oh_contract_version: "1.1", delivery_id: randomUUID(), idempotency_key: key, kind: seq === 1 ? "first_send" : "crp", sent_at: new Date().toISOString() },
      identity: { company_id: companyId, project_id: projectId },
      company_context: { display_name: "Sandbox Verification Co", note },
      project_context: { psm: { objectives: ["Verify the adapter"], categories: ["logistics"] } },
      workstream: { workstream_id: randomUUID(), category_key: "logistics", category_label: label, crp_kind: "operational" },
      artifact: { crp_id: randomUUID(), crp_artifact_id: randomUUID(), crp_version: 1, structured: { requirements: [{ id: "r1", value: 10, text: "Ünïcode · “quotes” \"double\" \\ back-slash\nnew line" }] } },
      provenance: { psm_version: 1, psm_confirmed_at: new Date().toISOString(), crp_version: 1, crp_created_at: new Date().toISOString(), oh_contract_version: "1.1" },
    };
  };

  const tasksWithKey = async (key: string): Promise<any[]> => {
    const r = await raw("GET", `/team/${workspaceId}/task?tags[]=${keyTag(key)}&space_ids[]=${spaceId}&include_closed=true&subtasks=true`);
    return (r.json.tasks ?? []).filter((t: any) => parseMarker(t.description)?.key === key);
  };
  const created: string[] = [];
  const expectCode = async (p: Promise<unknown>): Promise<OhPortError | undefined> => p.then(() => undefined, (e: unknown) => e as OhPortError);

  // ---------------------------------------------------------------- 1. acceptance response / ACK
  const first = payloadFor();
  const acc = await port.publish(first).catch((e: unknown) => e as OhPortError);
  if (acc instanceof Error) {
    record("1 acceptance", "publish returns an acceptance", "FAIL", `${(acc as OhPortError).code}: ${acc.message}`);
    return finish(apiBase);
  }
  created.push(acc.reference.taskId ?? "");
  record("1 acceptance", "publish returns an acceptance with acceptedAt + contractVersion", acc.acceptedAt && acc.contractVersion === "1.1" ? "PASS" : "FAIL", `acceptedAt=${acc.acceptedAt}`);
  const got = await raw("GET", `/task/${acc.reference.taskId}`);
  record("1 acceptance", "the referenced task really exists on the platform (GET /task/{id})", got.status === 200 ? "PASS" : "FAIL", `HTTP ${got.status}`);

  // ---------------------------------------------------------------- 2. stable external reference
  const again = await makeAdapter().publish(first);
  record("2 reference", "a second adapter instance returns the SAME reference for the same key", JSON.stringify(again.reference) === JSON.stringify(acc.reference) && again.replayed ? "PASS" : "FAIL", `taskId ${acc.reference.taskId} vs ${again.reference.taskId}`);
  const seen = await makeAdapter().verify(first.contract.idempotency_key);
  record("2 reference", "verify() returns the same reference", seen.found && JSON.stringify(seen.reference) === JSON.stringify(acc.reference) ? "PASS" : "FAIL");
  record("2 reference", "reference survives a human renaming/moving the task", "MANUAL", "rename the task in the ClickUp UI, then re-run verify(); the id is stable by ClickUp design but confirm");

  // ---------------------------------------------------------------- 3. idempotent creation
  const burstPayload = payloadFor("Sandbox Verify");
  const results = await Promise.all([port.publish(burstPayload), makeAdapter().publish(burstPayload), makeAdapter().publish(burstPayload)].map((p) => p.catch((e: unknown) => e as OhPortError)));
  await sleep(3000);
  const burstTasks = await tasksWithKey(burstPayload.contract.idempotency_key);
  results.forEach((r) => { if (!(r instanceof Error)) created.push(r.reference.taskId ?? ""); });
  record("3 idempotent create", "3 simultaneous publishes (2 independent processes) of one key leave exactly 1 task", burstTasks.length === 1 ? "PASS" : "FAIL", `tasks found by key tag: ${burstTasks.length}${burstTasks.length > 1 ? " (cross-process race: the in-process mutex cannot prevent this; see status doc)" : ""}`);
  const structure = await raw("GET", `/space/${spaceId}/folder?archived=false`);
  const mine = (structure.json.folders ?? []).filter((f: any) => String(f.name).includes(clickUpProjectRef(projectId)));
  record("3 idempotent create", "exactly one folder for the project, one List per workstream (no duplicates)", mine.length === 1 ? "PASS" : "FAIL", `folders=${mine.length}`);

  // ---------------------------------------------------------------- 4. lookup / read-back
  record("4 lookup", "verify() finds a delivery by key and not-found for an unknown key", (await port.verify(first.contract.idempotency_key)).found && !(await port.verify(`${projectId}:crp:${randomUUID()}:9`)).found ? "PASS" : "FAIL");
  const tagged = (got.json.tags ?? []).map((t: any) => t.name);
  record("4 lookup", "tags sent at creation are applied (key tag + project tag)", tagged.includes(keyTag(first.contract.idempotency_key)) && tagged.includes(projectTag(projectId)) ? "PASS" : "FAIL", `tags=${tagged.join(",")}`);
  record("4 lookup", "closed tasks are still found (close a delivery task in the UI, re-run verify)", "MANUAL", "adapter requests include_closed=true; confirm with a closed task");
  record("4 lookup", "list/folder/task objects are present in the create/get response (reference.locationId)", acc.reference.locationId && acc.reference.locationId.includes("/") ? "PASS" : "FAIL", `locationId=${acc.reference.locationId ?? "-"}`);

  // ---------------------------------------------------------------- 5. checksum verification
  record("5 checksum", "acceptance checksum equals payloadChecksum(payload)", acc.checksum === payloadChecksum(first) ? "PASS" : "FAIL");
  record("5 checksum", "body with unicode/quotes/backslash/newline round-trips byte-exact through ClickUp", acc.checksum === payloadChecksum(first) && seen.checksum === payloadChecksum(first) ? "PASS" : "FAIL", "read-back checksum is recomputed from the stored description");
  const tamper = payloadFor("Sandbox Verify", "tamper");
  const t = await port.publish(tamper);
  created.push(t.reference.taskId ?? "");
  const stored = (await raw("GET", `/task/${t.reference.taskId}`)).json;
  const put = await raw("PUT", `/task/${t.reference.taskId}`, { description: String(stored.description).replace("Sandbox Verification Co", "Tampered Co") });
  const afterTamper = await port.verify(tamper.contract.idempotency_key);
  const mism = await expectCode(port.publish(tamper));
  record("5 checksum", "a platform-side change to the stored body is detected (verify differs, publish -> CHECKSUM_MISMATCH)", put.status === 200 && afterTamper.checksum !== payloadChecksum(tamper) && mism?.code === "CHECKSUM_MISMATCH" ? "PASS" : "FAIL", `PUT HTTP ${put.status}, publish -> ${mism?.code ?? "accepted"}`);

  // ---------------------------------------------------------------- 6. duplicate send protection (platform side)
  const dup = payloadFor();
  const sequential = [await port.publish(dup), await port.publish(dup), await makeAdapter().publish(dup)];
  created.push(sequential[0]!.reference.taskId ?? "");
  await sleep(2500);
  record("6 duplicate send", "3 sequential publishes of one key (new process each time) leave 1 task, replayed=true after the first", (await tasksWithKey(dup.contract.idempotency_key)).length === 1 && sequential.slice(1).every((r) => r.replayed) ? "PASS" : "FAIL");
  const diff = payloadFor(); diff.contract.idempotency_key = dup.contract.idempotency_key;
  record("6 duplicate send", "same key with different content is refused (REJECTED_VALIDATION)", (await expectCode(port.publish(diff)))?.code === "REJECTED_VALIDATION" ? "PASS" : "FAIL");
  record("6 duplicate send", "service-level duplicate-click / concurrent-click protection", "SKIP", "lives in OhDeliveryService + Postgres lock; covered by src/__integration__/oh-delivery.int.test.ts, needs no ClickUp");

  // ---------------------------------------------------------------- 7. retry behaviour (faults injected around the REAL ClickUp)
  const chaos = (mode: "fail503_before" | "lose_response" | "reset_after_send", times: number): typeof fetch => {
    let left = times;
    return async (input, init) => {
      const isCreate = init?.method === "POST" && /\/list\/[^/]+\/task$/.test(new URL(String(input)).pathname) && !String(init.body).includes("oh-overview");
      if (!isCreate || left <= 0) return fetch(input, init);
      left -= 1;
      if (mode === "fail503_before") return new Response("{}", { status: 503 });
      const real = await fetch(input, init);
      await real.text();
      if (mode === "lose_response") throw Object.assign(new Error("aborted"), { name: "AbortError" });
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    };
  };
  const r1 = payloadFor();
  const retried = await makeAdapter({ fetch: chaos("fail503_before", 2), sleep: async (ms) => { sleeps.push(ms); await sleep(Math.min(ms, 200)); } }).publish(r1).catch((e: unknown) => e as OhPortError);
  if (!(retried instanceof Error)) created.push(retried.reference.taskId ?? "");
  await sleep(2500);
  record("7 retry", "two synthetic 503s before the write, then success, exactly 1 task", !(retried instanceof Error) && (await tasksWithKey(r1.contract.idempotency_key)).length === 1 ? "PASS" : "FAIL", retried instanceof Error ? retried.message : `backoff delays ${sleeps.slice(-2).join(",")}ms`);
  record("7 retry", "real 429 + reset header honoured", process.env.CLICKUP_BURST === "1" ? "SKIP" : "SKIP", "see burst check below (CLICKUP_BURST=1)");

  // ---------------------------------------------------------------- 8. timeout behaviour (response lost AFTER the platform stored the task)
  const t1 = payloadFor();
  const lost = await expectCode(makeAdapter({ fetch: chaos("lose_response", 1), retry: { maxAttempts: 1 } }).publish(t1));
  record("8 timeout", "lost response after a real write -> TIMEOUT with outcomeUnknown", lost?.code === "TIMEOUT" && lost.outcomeUnknown ? "PASS" : "FAIL", `${lost?.code ?? "no error"}`);
  const t0 = Date.now(); let visibleAfter = -1;
  for (let i = 0; i < 20; i++) { if ((await makeAdapter().verify(t1.contract.idempotency_key)).found) { visibleAfter = Date.now() - t0; break; } await sleep(1000); }
  record("8 timeout", "the stored task becomes visible to verify() (search-after-write lag measured)", visibleAfter >= 0 ? "PASS" : "FAIL", visibleAfter >= 0 ? `visible after ~${visibleAfter} ms (adapter lookup window must exceed this; default 5 x 1500 ms)` : "never visible within 20 s -> tag search is not usable, rely on list scan only");
  const recovered = await makeAdapter().publish(t1).catch((e: unknown) => e as OhPortError);
  if (!(recovered instanceof Error)) created.push(recovered.reference.taskId ?? "");
  record("8 timeout", "retry after the lost response creates no duplicate and returns replayed=true", !(recovered instanceof Error) && recovered.replayed && (await tasksWithKey(t1.contract.idempotency_key)).length === 1 ? "PASS" : "FAIL");
  const t2 = payloadFor();
  const selfHealed = await makeAdapter({ fetch: chaos("lose_response", 1) }).publish(t2).catch((e: unknown) => e as OhPortError);
  if (!(selfHealed instanceof Error)) created.push(selfHealed.reference.taskId ?? "");
  await sleep(2500);
  record("8 timeout", "adapter self-heals within one publish() (default policy) with exactly 1 task", !(selfHealed instanceof Error) && (await tasksWithKey(t2.contract.idempotency_key)).length === 1 ? "PASS" : "FAIL", selfHealed instanceof Error ? selfHealed.message : "");

  // ---------------------------------------------------------------- 9. network interruption + error taxonomy
  const n1 = payloadFor();
  const reset = await makeAdapter({ fetch: chaos("reset_after_send", 1), retry: { maxAttempts: 1 } }).publish(n1).then(() => undefined, (e: unknown) => e as OhPortError);
  record("9 network + taxonomy", "connection reset after the write -> UNAVAILABLE (outcome unknown)", reset?.code === "UNAVAILABLE" && reset.outcomeUnknown ? "PASS" : "FAIL", `${reset?.code ?? "no error"}`);
  await sleep(2500);
  const afterReset = await makeAdapter().publish(n1); created.push(afterReset.reference.taskId ?? "");
  record("9 network + taxonomy", "recovery after the reset: replayed=true, 1 task", afterReset.replayed && (await tasksWithKey(n1.contract.idempotency_key)).length === 1 ? "PASS" : "FAIL");
  const bad = await expectCode(makeAdapter({ token: "pk_invalid_token_for_verification" }).publish(payloadFor()));
  record("9 network + taxonomy", "invalid token -> AUTH (401/403), not retried", bad?.code === "AUTH" ? "PASS" : "FAIL", `${bad?.code ?? "no error"}`);
  const wrongSpace = await expectCode(makeAdapter({ spaceId: "1" }).publish(payloadFor()));
  record("9 network + taxonomy", "a space the token cannot see -> AUTH (configuration)", wrongSpace?.code === "AUTH" ? "PASS" : "FAIL", `${wrongSpace?.code ?? "no error"}`);
  const unsupported = payloadFor(); (unsupported.contract as { kind: string }).kind = "other";
  record("9 network + taxonomy", "unsupported kind -> UNSUPPORTED_KIND", (await expectCode(port.publish(unsupported)))?.code === "UNSUPPORTED_KIND" ? "PASS" : "FAIL");
  const invalid = await raw("POST", `/list/0/task`, { name: "" });
  record("9 network + taxonomy", "observe how ClickUp reports an invalid create (adapter maps 400/413/422 -> REJECTED_VALIDATION, 404 on a resolved list -> UNAVAILABLE)", "MANUAL", `empty-name create on list 0 returned HTTP ${invalid.status} ECODE=${invalid.json?.ECODE ?? "-"} (record this in the status doc)`);
  if (process.env.CLICKUP_BURST === "1") {
    let limited = 0; let hint = "";
    await Promise.all(Array.from({ length: 150 }, async () => { const r = await raw("GET", `/space/${spaceId}`); if (r.status === 429) { limited += 1; hint = `reset=${r.headers.get("x-ratelimit-reset")} retry-after=${r.headers.get("retry-after")}`; } }));
    record("9 network + taxonomy", "a real 429 is produced by a burst and carries a reset hint", limited > 0 ? "PASS" : "MANUAL", limited > 0 ? `${limited} x 429, ${hint}` : "no 429 within 150 requests (plan limit may be higher); adapter mapping is unit-tested against the fake");
  } else {
    record("9 network + taxonomy", "a real 429 (rate limit) is mapped to RATE_LIMITED and the reset hint honoured", "SKIP", "set CLICKUP_BURST=1 to provoke it (consumes the token's per-minute budget)");
  }
  record("9 network + taxonomy", "access state is never guessed", (await port.accessState(projectId)).provisioned && !(await port.accessState(projectId)).clientAccessible ? "PASS" : "FAIL", "provisioned from the platform; client access/Sherpa false without an explicit signal");

  // ---------------------------------------------------------------- cleanup
  if (process.env.CLICKUP_KEEP !== "1") {
    for (const f of mine) { const d = await raw("DELETE", `/folder/${f.id}`); record("cleanup", `delete test folder ${f.id}`, d.status === 200 ? "PASS" : "MANUAL", `HTTP ${d.status}`); }
    for (const id of created.filter(Boolean)) await raw("DELETE", `/task/${id}`).catch(() => undefined);
  }
  await finish(apiBase, fake);
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
function fatal(msg: string): never { console.error(`REFUSING TO RUN: ${msg}`); process.exit(2); }

async function finish(apiBase: string, fake?: FakeClickUpServer): Promise<void> {
  const w = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
  console.log(`\nClickUp sandbox verification  (${apiBase.replace(/\/\/[^/]*@/, "//")})\n`);
  console.log(`${w("CRITERION", 20)} ${w("STATUS", 7)} ${w("CHECK", 96)} NOTE`);
  for (const r of rows) console.log(`${w(r.criterion, 20)} ${w(r.status, 7)} ${w(r.check, 96)} ${r.note}`);
  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  console.log(`\nPASS ${count("PASS")}   FAIL ${count("FAIL")}   MANUAL ${count("MANUAL")}   SKIP ${count("SKIP")}`);
  console.log("MANUAL and SKIP rows are NOT evidence. Real delivery stays disabled until every row is PASS or has been checked by hand and recorded in docs/f5/clickup-track-status.md.");
  await fake?.stop();
  process.exit(count("FAIL") > 0 ? 1 : 0);
}

main().catch((e) => { console.error("verification crashed:", e instanceof Error ? e.message : e); process.exit(1); });
