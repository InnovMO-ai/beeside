import { emptyFrame } from "../../understanding/types";
import { orientationOffer, topicDrivers } from "../drivers";

const NOW = "2026-10-14T10:00:00.000Z";

describe("Knowledge drives questions and findings", () => {
  it("150 hires make labor-market knowledge relevant; a logistics hub makes infrastructure relevant", () => {
    const f = emptyFrame("es");
    f.items["workforce.headcount"] = { key: "workforce.headcount", value: { min: 150, max: 150 }, display: "150 personas", status: "known", provenance: "client_stated", interpretive: "observed", quote: "150", at: NOW };
    f.concepts["logistics_transport"] = { first: "logística", origin: "client" };
    const t = topicDrivers(f).map((d) => d.topic);
    expect(t).toEqual(expect.arrayContaining(["labor_market", "wages", "infrastructure", "transportation_logistics"]));
  });
  it("the orientation offer is optional, appears only after criteria are known and only once", () => {
    const f = emptyFrame("es");
    expect(orientationOffer(f, true)).toBeNull();
    f.items["location.criteria"] = { key: "location.criteria", value: ["talent"], display: "talento disponible", status: "known", provenance: "client_stated", interpretive: "observed", quote: "talento", at: NOW };
    const o = orientationOffer(f, true)!;
    expect(o.topics).toEqual(expect.arrayContaining(["labor_market"]));
    expect(o.question.es).toMatch(/no una recomendación/);
    expect(orientationOffer(f, false)).toBeNull();
    f.asked["offer:orientation"] = 1;
    expect(orientationOffer(f, true)).toBeNull();
  });
});
