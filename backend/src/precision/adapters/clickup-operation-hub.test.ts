import { ohPortConformance, samplePayload } from "../../__tests__/helpers/oh-conformance";
import { makeClickUpHarness } from "../../__tests__/helpers/clickup-harness";
import { OhHandoffPayload, OhPortError, payloadChecksum } from "../ports/operation-hub";
import { buildDescription, clickUpConfigFromEnv, clickUpProjectRef, keyTag, parseMarker, projectTag } from "./clickup-operation-hub";

// The SAME conformance suite as the simulator. Retries are off here (maxAttempts 1) so every injected fault surfaces as its error code.
ohPortConformance("clickup (local fake)", () => {
  const h = makeClickUpHarness();
  return { port: h.port, faults: h.server.injector(1), storedCount: () => h.server.taskCount() };
});

const err = async (p: Promise<unknown>): Promise<OhPortError> => (await p.then(() => { throw new Error("expected rejection"); }, (e: unknown) => e)) as OhPortError;

describe("ClickUp adapter — structure resolution", () => {
  it("creates folder/lists once and never duplicates them across deliveries, instances and restarts", async () => {
    const h = makeClickUpHarness();
    await h.port.publish(samplePayload());
    await h.port.publish(samplePayload());
    await h.another().publish(samplePayload());
    expect(h.server.allFolders()).toHaveLength(1);
    expect(h.server.allFolders()[0]!.lists.map((l) => l.name).sort()).toEqual(["Logistics", "Project Overview"]);
    expect(h.server.taskCount()).toBe(3);
    expect(h.server.taskCount({ includeOverview: true })).toBe(4); // one PSM overview, shared
  });

  it("uses a different list per workstream and keeps projects apart", async () => {
    const h = makeClickUpHarness();
    const a = samplePayload();
    const b = samplePayload();
    b.workstream = { ...b.workstream, category_label: "Customs" };
    const c = samplePayload({ project: "00000000-0000-4000-8000-0000000000a2" });
    await h.port.publish(a); await h.port.publish(b); await h.port.publish(c);
    expect(h.server.allFolders()).toHaveLength(2);
    expect(h.server.allFolders().flatMap((f) => f.lists.map((l) => l.name)).sort()).toEqual(["Customs", "Logistics", "Logistics", "Project Overview", "Project Overview"]);
  });

  it("converges on one canonical folder when another creator raced us (lowest id wins)", async () => {
    const h = makeClickUpHarness();
    const p = samplePayload();
    const ref = clickUpProjectRef(p.identity.project_id);
    h.server.injectFolder(`Synthetic Co · ${ref}`);
    h.server.injectFolder(`Synthetic Co · ${ref}`);
    await h.port.publish(p);
    const used = h.server.allFolders().filter((f) => f.lists.length > 0);
    expect(used).toHaveLength(1);
    expect(used[0]!.id).toBe(h.server.allFolders()[0]!.id);
  });

  it("recovers when a human deleted the list between deliveries (cache invalidated, structure rebuilt)", async () => {
    const h = makeClickUpHarness({ retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, lookupLagRetries: 1, lookupLagDelayMs: 1 } });
    await h.port.publish(samplePayload());
    h.server.deleteAllStructure();
    const second = await h.port.publish(samplePayload());
    expect(second.replayed).toBe(false);
    expect(h.server.allFolders()).toHaveLength(1);
  });
});

describe("ClickUp adapter — idempotency and verification", () => {
  it("serialises two simultaneous publishes of the same key into one task", async () => {
    const h = makeClickUpHarness();
    const p = samplePayload();
    const [a, b] = await Promise.all([h.port.publish(p), h.port.publish(p)]);
    expect(a.reference).toEqual(b.reference);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(h.server.taskCount()).toBe(1);
  });

  it("finds a closed task (a finished delivery is still the delivery)", async () => {
    const h = makeClickUpHarness();
    const p = samplePayload();
    const first = await h.port.publish(p);
    h.server.closeAllTasks();
    const again = await h.port.publish(p);
    expect(again.replayed).toBe(true);
    expect(again.reference).toEqual(first.reference);
    expect(h.server.taskCount()).toBe(1);
  });

  it("detects content altered by the platform on read-back, removes its own corrupt creation, and a later retry is clean", async () => {
    const h = makeClickUpHarness();
    const p = samplePayload();
    h.server.injector(1).corruptNext();
    expect((await err(h.port.publish(p))).code).toBe("CHECKSUM_MISMATCH");
    expect(h.server.taskCount()).toBe(0);
    const ok = await h.port.publish(p);
    expect(ok.replayed).toBe(false);
    expect(ok.checksum).toBe(payloadChecksum(p));
  });

  it("verify recomputes the checksum from the stored body (a tampered body is not reported as the sent checksum)", async () => {
    const h = makeClickUpHarness();
    const p = samplePayload();
    await h.port.publish(p);
    const task = h.server.allTasks().find((t) => !t.tags.includes("oh-overview"))!;
    const m = parseMarker(task.description)!;
    (task as { description: string }).description = buildDescription(m.key, m.kind, m.body.replace("Synthetic Co", "Other Co"), m.checksum);
    const seen = await h.port.verify(p.contract.idempotency_key);
    expect(seen.found).toBe(true);
    expect(seen.checksum).not.toBe(payloadChecksum(p));
    expect((await err(h.port.publish(p))).code).toBe("CHECKSUM_MISMATCH");
  });

  it("refuses a project that already belongs to another company", async () => {
    const h = makeClickUpHarness();
    await h.port.publish(samplePayload());
    const other = samplePayload();
    other.identity = { ...other.identity, company_id: "00000000-0000-4000-8000-0000000000c9" };
    expect((await err(h.port.publish(other))).code).toBe("IDENTITY_MISMATCH");
  });

  it("stores the identity in tags and a marker block, never the token", async () => {
    const h = makeClickUpHarness();
    const p = samplePayload();
    await h.port.publish(p);
    const t = h.server.allTasks().find((x) => !x.tags.includes("oh-overview"))!;
    expect(t.tags).toEqual(expect.arrayContaining([keyTag(p.contract.idempotency_key), projectTag(p.identity.project_id)]));
    expect(parseMarker(t.description)!.checksum).toBe(payloadChecksum(p));
    expect(t.description).not.toContain("tk_fake");
    expect(h.server.log.every((r) => r.authorization === "tk_fake_not_a_secret")).toBe(true);
  });

  it("psm_update goes to the overview list and does not need a workstream list", async () => {
    const h = makeClickUpHarness();
    const p = samplePayload({ kind: "psm_update" });
    const a = await h.port.publish(p);
    expect(a.replayed).toBe(false);
    expect(h.server.allFolders()[0]!.lists.map((l) => l.name)).toEqual(["Project Overview"]);
  });
});

describe("ClickUp adapter — retry, timeout and network behaviour (maxAttempts 3)", () => {
  const retrying = { retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, maxRateLimitWaitMs: 5000, lookupLagRetries: 3, lookupLagDelayMs: 7 } };

  it("timeout after the platform stored the task: the retry looks up first and returns it, no duplicate", async () => {
    const h = makeClickUpHarness(retrying);
    h.server.injector(1).timeoutAfterStore();
    const p = samplePayload();
    const a = await h.port.publish(p);
    expect(a.replayed).toBe(true);
    expect(h.server.taskCount()).toBe(1);
    expect(h.sleeps.length).toBeGreaterThan(0);
  });

  it("connection reset after the platform stored the task is recovered the same way", async () => {
    const h = makeClickUpHarness(retrying);
    h.server.fail(h.server.matchers.isCreateArtifact, { kind: "store_then_reset" });
    const a = await h.port.publish(samplePayload());
    expect(a.replayed).toBe(true);
    expect(h.server.taskCount()).toBe(1);
  });

  it("connection reset before storing: retried, one task", async () => {
    const h = makeClickUpHarness(retrying);
    h.server.fail(h.server.matchers.isCreateArtifact, { kind: "reset" });
    const a = await h.port.publish(samplePayload());
    expect(a.replayed).toBe(false);
    expect(h.server.taskCount()).toBe(1);
  });

  it("5xx twice then success, with bounded exponential backoff", async () => {
    const h = makeClickUpHarness(retrying);
    h.server.injector(2).unavailableBeforeStore();
    await h.port.publish(samplePayload());
    expect(h.sleeps).toEqual(expect.arrayContaining([50, 100])); // random()=0.5 * min(max, base*2^n)
    expect(h.server.taskCount()).toBe(1);
  });

  it("gives up after maxAttempts with the retryable error", async () => {
    const h = makeClickUpHarness(retrying);
    h.server.injector(3).unavailableBeforeStore();
    const e = await err(h.port.publish(samplePayload()));
    expect(e.code).toBe("UNAVAILABLE");
    expect(e.retryable).toBe(true);
    expect(h.server.taskCount()).toBe(0);
  });

  it("429: waits for the platform reset hint, then succeeds", async () => {
    const h = makeClickUpHarness(retrying);
    h.server.fail(h.server.matchers.anyRequest, { kind: "status", status: 429, body: { err: "Rate limit", ECODE: "APP_002" }, headers: { "Retry-After": "2" } });
    await h.port.publish(samplePayload());
    expect(Math.max(...h.sleeps)).toBeGreaterThanOrEqual(2000);
  });

  it("429 with a reset hint beyond the wait budget fails fast as RATE_LIMITED", async () => {
    const h = makeClickUpHarness(retrying);
    h.server.fail(h.server.matchers.anyRequest, { kind: "status", status: 429, body: {}, headers: { "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 600) } });
    expect((await err(h.port.publish(samplePayload()))).code).toBe("RATE_LIMITED");
    expect(h.sleeps).toHaveLength(0);
  });

  it("401 is never retried", async () => {
    const h = makeClickUpHarness(retrying);
    h.server.injector(5).authFailureNext();
    const e = await err(h.port.publish(samplePayload()));
    expect(e.code).toBe("AUTH");
    expect(h.server.log).toHaveLength(1);
  });

  it("a wrong token is AUTH", async () => {
    const h = makeClickUpHarness({ token: "wrong" });
    expect((await err(h.port.publish(samplePayload()))).code).toBe("AUTH");
  });

  it("a non-existent configured space is a configuration error (AUTH), not a payload rejection", async () => {
    const h = makeClickUpHarness({ spaceId: "nope" });
    expect((await err(h.port.publish(samplePayload()))).code).toBe("AUTH");
  });

  it("a slow response beyond the per-request timeout is TIMEOUT with outcome unknown", async () => {
    const h = makeClickUpHarness();
    h.server.fail(h.server.matchers.isCreateArtifact, { kind: "store_then_hang" });
    const e = await err(h.port.publish(samplePayload()));
    expect(e.code).toBe("TIMEOUT");
    expect(e.outcomeUnknown).toBe(true);
  });

  it("a slow but in-budget response succeeds", async () => {
    const h = makeClickUpHarness({ requestTimeoutMs: 1000 });
    h.server.fail(h.server.matchers.isCreateArtifact, { kind: "delay", ms: 100 });
    expect((await h.port.publish(samplePayload())).replayed).toBe(false);
  });

  it("a server that is not listening at all is UNAVAILABLE, outcome known for a request that was never sent", async () => {
    const h = makeClickUpHarness({ fetch: async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); } });
    const e = await err(h.port.publish(samplePayload()));
    expect(e.code).toBe("UNAVAILABLE");
  });

  it("paces requests against the per-minute budget", async () => {
    let t = 0;
    const h = makeClickUpHarness({ requestsPerMinute: 3, now: () => t, sleep: async (ms) => { h.sleeps.push(ms); t += ms; } });
    await h.port.publish(samplePayload());
    expect(h.sleeps.length).toBeGreaterThan(0);
  });
});

describe("ClickUp adapter — search-after-write lag", () => {
  const retrying = { retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, lookupLagRetries: 4, lookupLagDelayMs: 1 } };

  it("short index lag after a lost response: the lag-aware lookup finds the task, no duplicate", async () => {
    const h = makeClickUpHarness(retrying);
    h.server.lagSearches(4);
    h.server.injector(1).timeoutAfterStore();
    const a = await h.port.publish(samplePayload());
    expect(a.replayed).toBe(true);
    expect(h.server.taskCount()).toBe(1);
  });

  it("lag longer than the lookup window can create a duplicate; later lookups converge on the oldest task", async () => {
    const h = makeClickUpHarness({ retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2, lookupLagRetries: 1, lookupLagDelayMs: 1 } });
    const p = samplePayload();
    h.server.lagSearches(1000);
    h.server.injector(1).timeoutAfterStore();
    await h.port.publish(p);
    expect(h.server.taskCount()).toBe(2); // documented residual risk: sandbox must measure real lag
    h.server.endLag();
    const dups: string[] = [];
    const next = h.another({ onDuplicate: (d) => dups.push(d.keptTaskId) });
    const again = await next.publish(p);
    const oldest = [...h.server.allTasks()].filter((t) => !t.tags.includes("oh-overview")).sort((x, y) => x.seq - y.seq)[0]!;
    expect(again.reference.workItemId).toBe(oldest.id);
    expect(again.replayed).toBe(true);
  });

  it("duplicate sweep removes the task we created when an older one with the same key becomes visible", async () => {
    const h = makeClickUpHarness(retrying);
    const p = samplePayload();
    await h.port.publish(p); // task 1 (visible)
    // a second creator that cannot see task 1 yet (search lag on the first lookups only)
    h.server.allTasks().forEach((t) => ((t as { hiddenFor: number }).hiddenFor = 3));
    const removed: string[] = [];
    const racer = h.another({ onDuplicate: (d) => d.removedTaskId && removed.push(d.removedTaskId), retry: { maxAttempts: 1, lookupLagRetries: 0, lookupLagDelayMs: 0 } });
    const acc = await racer.publish(p);
    expect(h.server.taskCount()).toBe(1);
    expect(acc.replayed).toBe(true);
  });
});

describe("ClickUp adapter — access state (only what the adapter can honestly know)", () => {
  it("provisioned after an accepted send; clientAccessible and Sherpa stay false without an explicit signal", async () => {
    const h = makeClickUpHarness();
    const p = samplePayload();
    expect(await h.port.accessState(p.identity.project_id)).toEqual({ provisioned: false, clientAccessible: false, sherpaAssigned: false });
    await h.port.publish(p);
    expect(await h.port.accessState(p.identity.project_id)).toEqual({ provisioned: true, clientAccessible: false, sherpaAssigned: false });
    // a fresh process learns provisioning from the platform, not from memory
    expect((await h.another().accessState(p.identity.project_id)).provisioned).toBe(true);
  });

  it("an overview-only project is not provisioned (only a delivered artifact counts)", async () => {
    const h = makeClickUpHarness();
    const p = samplePayload();
    h.server.fail(h.server.matchers.isCreateTask, { kind: "status", status: 400, body: {} }, 1); // first create = overview task
    await h.port.publish(p).catch(() => undefined);
    expect((await h.another().accessState(p.identity.project_id)).provisioned).toBe(false);
  });

  it("reports client access / Sherpa only from the configured signal, and never Sherpa without access", async () => {
    const p = samplePayload();
    let signal = { clientAccessible: false, sherpaAssigned: true, sherpaDisplayName: "Ana" };
    const h = makeClickUpHarness({ accessSignal: async () => signal });
    await h.port.publish(p);
    expect(await h.port.accessState(p.identity.project_id)).toEqual({ provisioned: true, clientAccessible: false, sherpaAssigned: false });
    signal = { clientAccessible: true, sherpaAssigned: true, sherpaDisplayName: "Ana" };
    expect(await h.port.accessState(p.identity.project_id)).toEqual({ provisioned: true, clientAccessible: true, sherpaAssigned: true, sherpaDisplayName: "Ana" });
    // a direct Sherpa channel passes through only with an assigned, accessible Sherpa
    const withChannel = { clientAccessible: true, sherpaAssigned: true, sherpaDisplayName: "Ana", sherpaContactEmail: "ana@channel.example.test" };
    signal = withChannel;
    expect((await h.port.accessState(p.identity.project_id)).sherpaContactEmail).toBe("ana@channel.example.test");
    signal = { ...withChannel, clientAccessible: false };
    expect((await h.port.accessState(p.identity.project_id)).sherpaContactEmail).toBeUndefined();
  });

  it("describes itself as REAL / NOT_VERIFIED by default and SANDBOX when configured", () => {
    expect(makeClickUpHarness().port.describe()).toMatchObject({ implementation: "clickup", mode: "REAL", verification: "NOT_VERIFIED" });
    expect(makeClickUpHarness({ mode: "SANDBOX" }).port.describe().mode).toBe("SANDBOX");
  });
});

describe("ClickUp adapter — marker format", () => {
  it("round-trips and tolerates CRLF normalisation by the platform", () => {
    const desc = buildDescription("k:1", "crp", '{"a":1}', "a".repeat(64));
    expect(parseMarker(desc)).toMatchObject({ key: "k:1", kind: "crp", body: '{"a":1}' });
    expect(parseMarker(desc.replace(/\n/g, "\r\n"))).toMatchObject({ key: "k:1" });
    expect(parseMarker("hello")).toBeUndefined();
  });
  it("the payload body hashes to payloadChecksum (sent_at excluded)", () => {
    const p: OhHandoffPayload = samplePayload();
    const q = { ...p, contract: { ...p.contract, sent_at: "2030-01-01T00:00:00.000Z" } };
    expect(payloadChecksum(p)).toBe(payloadChecksum(q));
  });
});

describe("clickUpConfigFromEnv", () => {
  const env = { CLICKUP_TOKEN: "t", CLICKUP_WORKSPACE_ID: "1", CLICKUP_SPACE_ID: "2" };
  it("reads the required ids and defaults to the public API and REAL mode", () => {
    expect(clickUpConfigFromEnv(env)).toMatchObject({ apiBaseUrl: "https://api.clickup.com/api/v2", workspaceId: "1", spaceId: "2", mode: "REAL" });
  });
  it("fails loudly on missing or invalid settings without echoing the token", () => {
    expect(() => clickUpConfigFromEnv({ ...env, CLICKUP_SPACE_ID: "" })).toThrow(/CLICKUP_SPACE_ID/);
    expect(() => clickUpConfigFromEnv({ ...env, CLICKUP_MODE: "x" })).toThrow(/CLICKUP_MODE/);
    expect(() => clickUpConfigFromEnv({ ...env, CLICKUP_TOKEN: "" })).toThrow(/CLICKUP_TOKEN is required/);
    try { clickUpConfigFromEnv({ ...env, CLICKUP_MODE: "x" }); } catch (e) { expect(String(e)).not.toContain('"t"'); }
  });
});

describe("ClickUp adapter — what a Sherpa reads", () => {
  it("puts a readable brief above the machine body, and read-back/idempotency still work from the machine body", async () => {
    const h = makeClickUpHarness();
    const p = samplePayload();
    const accepted = await h.port.publish(p);
    const t = h.server.allTasks().find((x) => !x.tags.includes("oh-overview"))!;
    expect(t.description).toMatch(/^beeside-oh\/2\n/);
    expect(t.description).toContain("PROJECT: Synthetic Co");
    const marker = parseMarker(t.description)!;
    expect(marker.body.includes("\n")).toBe(false);
    expect(JSON.parse(marker.body).identity.project_id).toBe(p.identity.project_id);
    expect(marker.checksum).toBe(payloadChecksum(p));
    expect((await h.port.verify(p.contract.idempotency_key)).checksum).toBe(payloadChecksum(p));
    expect((await h.port.publish(p)).replayed).toBe(true);
    expect(accepted.checksum).toBe(payloadChecksum(p));
  });

  it("client text that imitates the delimiter cannot break parsing (the machine body is the last line)", () => {
    const body = '{"a":"x"}';
    const desc = buildDescription("k:2", "crp", body, "b".repeat(64), "PROJECT: X\n--- machine ---\n{\"evil\":1}");
    expect(parseMarker(desc)).toMatchObject({ key: "k:2", body });
  });

  it("still reads descriptions written before the brief existed", () => {
    expect(parseMarker(buildDescription("k:3", "crp", '{"a":1}', "c".repeat(64)))).toMatchObject({ body: '{"a":1}' });
  });
});
