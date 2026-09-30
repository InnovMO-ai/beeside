import { parseEntryApproach, parsePrimaryDriver } from "./structured-echo";

describe("parseEntryApproach", () => {
  it("matches a distributor answer in English", () => {
    expect(parseEntryApproach("We plan to work with a local distributor to reach retailers")?.value).toBe("distributor_partner");
  });

  it("matches a distributor answer in Spanish", () => {
    expect(parseEntryApproach("Vamos a buscar un distribuidor local")?.value).toBe("distributor_partner");
  });

  it("prefers joint_venture over the broader partner group", () => {
    expect(parseEntryApproach("We're forming a joint venture with a local partner")?.value).toBe("joint_venture");
  });

  it("prefers acquisition over the broader distributor group", () => {
    expect(parseEntryApproach("We are planning to acquire a small local distributor")?.value).toBe("acquisition");
  });

  it("matches ecommerce-only entry", () => {
    expect(parseEntryApproach("We'll just sell through our online store for now")?.value).toBe("ecommerce_only");
  });

  it("matches direct entity in Spanish", () => {
    expect(parseEntryApproach("Queremos abrir nuestra propia entidad legal")?.value).toBe("direct_entity");
  });

  it("returns null when nothing matches (no chip offered)", () => {
    expect(parseEntryApproach("Not sure yet, still thinking about it")).toBeNull();
  });

  it("returns null on empty text", () => {
    expect(parseEntryApproach("")).toBeNull();
  });

  it("is accent-insensitive for Spanish keywords", () => {
    expect(parseEntryApproach("Buscamos una licencia para operar")?.value).toBe("licensing_franchise");
  });
});

describe("parsePrimaryDriver", () => {
  it("prefers customer_request over generic existing_customer_demand", () => {
    expect(parsePrimaryDriver("A customer asked us to be able to deliver locally")?.value).toBe("customer_request");
  });

  it("matches competitive pressure", () => {
    expect(parsePrimaryDriver("Our competitors are already established there and we're losing market share")?.value).toBe("competitive_pressure");
  });

  it("matches board direction in Spanish", () => {
    expect(parsePrimaryDriver("El consejo decidio que debemos expandirnos este ano")?.value).toBe("investor_board_direction");
  });

  it("matches new market opportunity", () => {
    expect(parsePrimaryDriver("We saw an opportunity to grow in this region")?.value).toBe("new_market_opportunity");
  });

  it("returns null when nothing matches", () => {
    expect(parsePrimaryDriver("It's complicated and hard to summarize")).toBeNull();
  });
});
