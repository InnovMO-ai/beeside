import { samplePayload } from "../../__tests__/helpers/oh-conformance";
import { payloadChecksum, type OhHandoffPayload } from "./operation-hub";
import { payloadHygiene } from "./payload-hygiene";
import { briefFor, sherpaBrief } from "./sherpa-brief";

function realistic(language: "en" | "es" = "en"): OhHandoffPayload {
  const p = samplePayload();
  p.project_context = {
    psm: {
      psm_version: 1,
      objectives: ["Open a distribution centre in Mexico"],
      destinations: ["Mexico"],
      time_window: "Q2 2027",
      product_or_service: "Dry goods",
      operating_entity: null,
      categories: [{ category_label: "Logistics", kind: "category", items: [{ label: "Warehousing", why: "Need a bonded warehouse", priority: "high", timing: "Q1 2027", state: "confirmed" }] }],
      open_items: ["Customs broker not chosen"],
    },
  };
  p.artifact.structured = {
    language,
    crp_kind: "operational",
    title: "Logistics requirements",
    context: ["Monthly flows from Chile"],
    sections: [{ title: "Flows", items: [
      { label: "Origin", value: "Chile", state: "confirmed", execution_dependency: false, entries: ["Santiago port"] },
      { label: "Volume", value: null, state: "pending", execution_dependency: true, missing: ["Pallets per month"] },
      { label: "Insurance", value: "Cargo", state: "assumed", execution_dependency: false, visibility: "context_only" },
    ] }],
    pending: [{ label: "Customs broker", value: null, state: "pending", execution_dependency: false }],
    required_later: ["Import licence"],
  };
  return p;
}

describe("Sherpa brief", () => {
  it("renders the whole payload for a person: project, frame, requirements, pending and what is required later", () => {
    const text = sherpaBrief(realistic());
    expect(text).toContain("PROJECT: Synthetic Co");
    expect(text).toContain("WORKSTREAM: Logistics · First send v1");
    expect(text).toContain("Objective: Open a distribution centre in Mexico");
    expect(text).toContain("   - Warehousing [confirmed] (why: Need a bonded warehouse; priority: high; timing: Q1 2027)");
    expect(text).toContain("- Origin: Chile [confirmed]");
    expect(text).toContain("    · Santiago port");
    expect(text).toContain("- Volume [pending; needed before execution]");
    expect(text).toContain("    Missing: Pallets per month");
    expect(text).toContain("[assumed; context only, not for the provider RFI]");
    expect(text).toContain("PENDING\n- Customs broker [pending]");
    expect(text).toContain("INFORMATION REQUIRED LATER\n- Import licence");
    expect(text).not.toMatch(/undefined|null|\[object/);
  });

  it("is written in the content language", () => {
    const text = sherpaBrief(realistic("es"));
    expect(text).toContain("PROYECTO: Synthetic Co");
    expect(text).toContain("REQUERIMIENTOS DEL CLIENTE: Logistics requirements");
    expect(text).toContain("INFORMACIÓN REQUERIDA MÁS ADELANTE");
  });

  it("is a pure function of the payload and does not touch the delivery checksum", () => {
    const p = realistic();
    const before = payloadChecksum(p);
    expect(sherpaBrief(p)).toBe(sherpaBrief(JSON.parse(JSON.stringify(p))));
    expect(payloadChecksum(p)).toBe(before);
  });

  it("a Service Map update renders the frame only", () => {
    const p = realistic();
    p.contract.kind = "psm_update";
    const text = briefFor(p);
    expect(text).toContain("PROJECT FRAME (confirmed Service Map v1)");
    expect(text).not.toContain("CLIENT REQUIREMENTS");
  });

  it("carries nothing the hygiene lint would reject", () => {
    expect(payloadHygiene(realistic())).toEqual([]);
  });
});

describe("payload hygiene lint", () => {
  const dirty = (value: string): ReturnType<typeof payloadHygiene> => {
    const p = realistic();
    (p.artifact.structured as { context: string[] }).context = [value];
    return payloadHygiene(p);
  };
  it.each([
    ["Do you ship by sea?", "question mark"],
    ["¿Cuántos pallets?", "question mark"],
    ["Sure! Let me know if you need more", "assistant phrasing"],
    ["Assistant: here is the list", "chat role prefix"],
    ["```json {} ```", "code fence / markup"],
    ["value is undefined", "placeholder or empty literal"],
    ["logistics_flows_origin", "internal marker or key"],
    ["sent through ClickUp", "platform or vendor name"],
    ["write to ana@example.com", "e-mail address"],
  ])("flags %s", (text, rule) => {
    expect(dirty(text).map((f) => f.rule)).toContain(rule);
  });
  it("lets ordinary business content through", () => {
    expect(dirty("Monthly ocean freight, 5 pallets, from Santiago to Veracruz")).toEqual([]);
  });
});
