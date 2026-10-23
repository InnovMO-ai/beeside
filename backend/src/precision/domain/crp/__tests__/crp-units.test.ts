import { lintCopy } from "../../../manifest/copy-lint";
import { ERROR_COPY, NOT_SENT, NOTICE_REQUEST_CHANGES, PREVIEW_COPY, errorMessage } from "../copy";
import { HTTP_STATUS, CrpError } from "../errors";
import { sanitizeOrNull, sanitizeText } from "../sanitize";
import { DEMO_SCRIPT_FIXTURE } from "../../seed";

const BIDI = String.fromCharCode(0x202e);
const BELL = String.fromCharCode(7);
const ZWSP = String.fromCharCode(0x200b);

describe("sanitizeText", () => {
  it("removes markup, entities, control and invisible direction characters", () => {
    expect(sanitizeText(`<script>alert(1)</script>Hello${BIDI} wor${ZWSP}ld${BELL}`)).toBe("alert(1) Hello world");
    expect(sanitizeText("a &lt;b&gt; c &#60;")).toBe("a b c");
    expect(sanitizeText("x < y > z")).toBe("x z");
    expect(sanitizeText("2 > 1 and 1 < 2")).toBe("2 1 and 1 2");
  });
  it("keeps line structure, bounds length and treats non-strings as empty", () => {
    expect(sanitizeText("one  \r\n\r\n\r\n\r\ntwo\t\tthree")).toBe("one\n\ntwo three");
    const long = sanitizeText("a".repeat(50), 10);
    expect(long.length).toBe(10);
    expect(long.endsWith("…")).toBe(true);
    expect(sanitizeText(42 as never)).toBe("");
    expect(sanitizeOrNull("   ")).toBeNull();
    expect(sanitizeOrNull(" ok ")).toBe("ok");
  });
});

describe("customer copy of the CRP surface", () => {
  const all: Array<[string, string]> = [];
  for (const [code, pair] of Object.entries(ERROR_COPY)) for (const loc of ["en", "es"] as const) all.push([`${code}.${loc}`, pair[loc]]);
  for (const loc of ["en", "es"] as const) {
    all.push([`notice.${loc}`, NOTICE_REQUEST_CHANGES[loc]]);
    NOT_SENT[loc].forEach((t, i) => all.push([`not_sent.${loc}.${i}`, t]));
    for (const [k, v] of Object.entries(PREVIEW_COPY)) all.push([`preview.${k}.${loc}`, v[loc]]);
  }
  it("has both languages for every error code and passes the voice lint (no exclamations, no quality judgements)", () => {
    expect(all.length).toBeGreaterThan(20);
    for (const [key, text] of all) {
      expect(text.trim().length).toBeGreaterThan(0);
      expect(lintCopy(key, text)).toEqual([]);
      expect(text).not.toMatch(/MOCK|SIMULATOR|JSON|_generic|new:|\bOH\b|\bPSM\b|\bFA4?\b|Stripe|ClickUp|stack|exception|SQLSTATE/);
    }
  });
  it("never shows an error code, a version number or a Sherpa before one is assigned", () => {
    for (const [, text] of all) expect(text).not.toMatch(/\b[A-Z]{3,}_[A-Z_]{3,}\b|\bv\d|versi[oó]n \d|sherpa/i);
  });
  it("maps every error code to an HTTP status and a message in both languages", () => {
    for (const code of Object.keys(HTTP_STATUS)) {
      const dto = new CrpError(code as never).toDto("en");
      expect(dto.error).toBe(code);
      expect(dto.message.length).toBeGreaterThan(0);
      expect(errorMessage(code, "es").length).toBeGreaterThan(0);
    }
  });
});

describe("demo script fixture", () => {
  const extract = DEMO_SCRIPT_FIXTURE["category:logistics_flows"]!.extract as (req: never) => Array<{ name: string; value: unknown; status: string }>;
  const spec = (name: string, type: string, isTarget: boolean, extra: object = {}) => ({ name, type, description: type === "multi_enum" ? "country (ISO 3166-1 alpha-2 country codes)" : name, isTarget, ...extra });
  it("reads a country only for the field being asked", () => {
    const req = { clientText: "Chile", specs: [spec("lane__origin_country", "multi_enum", true), spec("lane__destination_country", "multi_enum", false)] } as never;
    const out = extract(req);
    expect(out[0]).toMatchObject({ status: "ok", value: ["CL"] });
    expect(out[1]).toMatchObject({ status: "not_found", value: null });
  });
  it("reads quantity, unit and option from one answer", () => {
    const req = { clientText: "20 pallets", specs: [spec("lane__volume__value", "number", true), spec("lane__volume__unit", "enum", false, { enumValues: ["units", "pallets"], enumLabels: { units: "Units", pallets: "Pallets" } })] } as never;
    const out = extract(req);
    expect(out[0]).toMatchObject({ status: "ok", value: 20 });
    expect(out[1]).toMatchObject({ status: "ok", value: "pallets" });
  });
});
