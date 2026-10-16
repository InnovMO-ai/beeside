import { displayNameOf, resourceFormat } from "../identity";

describe("displayNameOf", () => {
  it("prefers the Person's preferred name", () => {
    expect(displayNameOf({ first_name: "María José", last_name: "Torres", preferred_name: "Majo Torres" })).toBe("Majo Torres");
  });
  it("falls back to first + last, normalising whitespace", () => {
    expect(displayNameOf({ first_name: " Mariana ", last_name: "  Torres", preferred_name: "  " })).toBe("Mariana Torres");
    expect(displayNameOf({ first_name: "Mariana", last_name: "", preferred_name: null })).toBe("Mariana");
  });
  it("is null without a usable name (the UI then shows no block, never a placeholder)", () => {
    expect(displayNameOf(undefined)).toBeNull();
    expect(displayNameOf({ first_name: " ", last_name: "", preferred_name: null })).toBeNull();
  });
});

describe("resourceFormat", () => {
  it("an https URL whose path ends in .pdf is a PDF, query strings notwithstanding", () => {
    expect(resourceFormat("https://files.example/guides/doing-business-mx.pdf")).toBe("pdf");
    expect(resourceFormat("https://files.example/Guide.PDF?v=2#p1")).toBe("pdf");
  });
  it("everything else is a web page", () => {
    expect(resourceFormat("https://example.org/doing-business")).toBe("web");
    expect(resourceFormat("https://example.org/a?file=x.pdf")).toBe("web");
    expect(resourceFormat("http://example.org/x.pdf")).toBe("web");
    expect(resourceFormat("not a url")).toBe("web");
  });
});
