import { faContextConformance } from "../../__tests__/helpers/fa-context-conformance";
import type { FaClientSafeContext } from "../ports/fa-context";
import { FixtureFaContextReader } from "./fixture-fa-context";

const ctx = (company: string): FaClientSafeContext => ({
  project: { destinationCountry: "Mexico", sector: "Food and beverage", expansionObjective: "Open a distribution hub" },
  company: { displayName: company, operatingCountries: ["CL"] },
  needs: [{ capabilityId: "logistics", label: "Logistics", priority: "high" }],
  literals: { motive: "We want to grow in Mexico." },
  locale: "en",
});

faContextConformance("fixture", () => {
  const reader = new FixtureFaContextReader([
    { projectId: "00000000-0000-4000-8000-0000000000a1", resultId: "res-1", context: ctx("Northwind Foods") },
    { projectId: "00000000-0000-4000-8000-0000000000a2", resultId: "res-2", context: ctx("Contoso Beverages") },
  ]);
  return {
    reader,
    projectId: "00000000-0000-4000-8000-0000000000a1",
    otherProjectId: "00000000-0000-4000-8000-0000000000a2",
    unknownProjectId: "00000000-0000-4000-8000-0000000000ff",
    redeliver: () => reader.add({ projectId: "00000000-0000-4000-8000-0000000000a1", resultId: "res-1b", context: ctx("Northwind Foods") }),
  };
});
