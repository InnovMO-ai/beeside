import { ohPortConformance } from "../../__tests__/helpers/oh-conformance";
import { SimulatedOperationHub } from "./simulator-operation-hub";

ohPortConformance("simulator", () => {
  const sim = new SimulatedOperationHub();
  return { port: sim, faults: sim, storedCount: () => sim.storedCount() };
});

describe("SimulatedOperationHub access states", () => {
  it("is pending after the first send by default (no Sherpa implied)", async () => {
    const sim = new SimulatedOperationHub();
    const { samplePayload } = await import("../../__tests__/helpers/oh-conformance");
    const p = samplePayload();
    await sim.publish(p);
    expect(await sim.accessState(p.identity.project_id)).toEqual({ provisioned: true, clientAccessible: false, sherpaAssigned: false });
  });

  it("reports an assigned Sherpa only when configured to", async () => {
    const sim = new SimulatedOperationHub({ accessAfterFirstSend: "accessible_with_sherpa" });
    const { samplePayload } = await import("../../__tests__/helpers/oh-conformance");
    const p = samplePayload();
    await sim.publish(p);
    const s = await sim.accessState(p.identity.project_id);
    expect(s.clientAccessible).toBe(true);
    expect(s.sherpaAssigned).toBe(true);
    expect(s.sherpaContactEmail).toBeUndefined(); // no direct Sherpa channel unless the platform provides one
  });

  it("exposes a direct Sherpa channel only when one is configured on the platform side", async () => {
    const sim = new SimulatedOperationHub({ accessAfterFirstSend: "accessible_with_sherpa", sherpaContactEmail: "ana@channel.example.test" });
    const { samplePayload } = await import("../../__tests__/helpers/oh-conformance");
    const p = samplePayload();
    await sim.publish(p);
    expect((await sim.accessState(p.identity.project_id)).sherpaContactEmail).toBe("ana@channel.example.test");
  });

  it("refuses a company that does not match the project", async () => {
    const { samplePayload } = await import("../../__tests__/helpers/oh-conformance");
    const p = samplePayload();
    const sim = new SimulatedOperationHub({ knownCompanies: { [p.identity.project_id]: "other-company" } });
    await expect(sim.publish(p)).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
  });
});
