import { describe, expect, it } from "vitest";
import type { TurnDto } from "../api/dto";
import { mergeTurns, waitStage } from "../state/thread";
import { parseRoute, routePath, type Route } from "../state/router";

describe("router", () => {
  const routes: Route[] = [
    { name: "cover" }, { name: "center" }, { name: "understanding" }, { name: "serviceMap" }, { name: "addService" }, { name: "help" }, { name: "accessEnded" },
    { name: "category", id: "logistics" }, { name: "crp", id: "logistics" }, { name: "preview", id: "logistics" }, { name: "sent", id: "logistics" },
    { name: "category", id: "a b/ç" },
  ];
  it("round-trips every route", () => { for (const r of routes) expect(parseRoute(routePath(r))).toEqual(r); });
  it("treats the base as the root and unknown paths as not found", () => {
    expect(parseRoute("/precision")).toEqual({ name: "root" });
    expect(parseRoute("/precision/")).toEqual({ name: "root" });
    expect(parseRoute("/precision/nope")).toEqual({ name: "notFound" });
    expect(parseRoute("/precision/category/x/other")).toEqual({ name: "notFound" });
  });
});

describe("waiting stages", () => {
  it("moves by elapsed time only", () => {
    expect([0, 2999, 3000, 6999, 7000, 14999, 15000, 90000].map(waitStage)).toEqual(["read", "read", "relate", "relate", "prepare", "prepare", "long", "long"]);
  });
});

describe("mergeTurns", () => {
  const t = (id: string, text: string) => ({ id, role: "assistant", kind: "message", text }) as unknown as TurnDto;
  it("replaces a turn with the same id and appends new ones in order", () => {
    const out = mergeTurns([t("1", "a"), t("2", "b")], [t("2", "b2"), t("3", "c")]);
    expect(out.map((x) => x.id)).toEqual(["1", "2", "3"]);
    expect((out[1] as unknown as { text: string }).text).toBe("b2");
  });
  it("does not mutate its inputs", () => {
    const a = [t("1", "a")];
    mergeTurns(a, [t("2", "b")]);
    expect(a).toHaveLength(1);
  });
});
