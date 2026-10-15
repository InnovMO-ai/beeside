import fs from "node:fs";
import path from "node:path";
import { renderFa4Email, sanitizeSubjectValue } from "./email-render";
import { TEMPLATE_FILES } from "./email-templates/templates.generated";
import { premiumEnabled } from "./email";

const dir = path.join(__dirname, "email-templates");

describe("FA4 email v2 templates", () => {
  it("the embedded templates are exactly the frozen Design files (no drift)", () => {
    for (const f of fs.readdirSync(dir).filter((x) => /\.(html|txt|json)$/.test(x))) expect(TEMPLATE_FILES[f]).toBe(fs.readFileSync(path.join(dir, f), "utf8"));
  });

  const yev = (l: "es" | "en", f: Partial<Record<string, boolean>>) => renderFa4Email("yev", l, {
    first_name: "Lucía <b>", yev_url: "https://x.test/fa4#r=T&view=result", talk_to_beeside_url: "https://x.test/fa4#r=T&view=result&contact=open&origin=yev_email",
    premium_url: "https://x.test/premium", destination: "México, India", declared_objective: "Un buen equipo & sin complicaciones",
  }, { has_first_name: true, has_destination: true, has_objective: true, show_focus_block: true, premium_enabled: true, ...f });

  it.each(["es", "en"] as const)("%s: every YEV variant (2 Premium × 4 personalization) renders with no marker, no gap, no unescaped data", (l) => {
    for (const premium of [true, false]) for (const [dest, obj] of [[true, true], [true, false], [false, true], [false, false]] as const) {
      const r = yev(l, { premium_enabled: premium, has_destination: dest, has_objective: obj, show_focus_block: dest || obj });
      expect(r.html + r.text).not.toMatch(/\{\{|<!--(IF|ENDIF)/);
      expect(/Explor(ar|e) beeside Premium/.test(r.html)).toBe(premium);
      expect(/Si decides continuar con beeside Premium|If you decide to continue with beeside Premium/.test(r.html + r.text)).toBe(premium);
      expect(/TU PRÓXIMO MERCADO, EN FOCO|YOUR NEXT MARKET, IN FOCUS/.test(r.html)).toBe(dest || obj);
      expect(r.html).not.toContain("Lucía <b>"); expect(r.html).toContain("Lucía &lt;b&gt;");
      expect(r.html).toContain("https://beeside.you/termsandconditions"); expect(r.html).toContain("https://www.beeside.you/privacy");
      expect(r.html).not.toMatch(/mailto:|Policiescommercialnotices|PolíticaPrivacidad|beeside\.you\/HelpCenter/);
    }
  });

  it("resume + talk render in both languages; plain text is complete; talk has no public legal footer", () => {
    for (const l of ["es", "en"] as const) {
      const r = renderFa4Email("resume", l, { first_name: "", resume_url: "https://x.test/fa4#r=T" }, { has_first_name: false });
      expect(r.text).toContain("https://x.test/fa4#r=T"); expect(r.text).toContain("https://www.beeside.you/helpcenter"); expect(r.text).toMatch(/Hola:|Hi,/);
      const t = renderFa4Email("talk", l, { topic: "x", message: "a\nb <script>", name: "N", company: "C", email: "n@c.example", stage: "YEV", fa_language: "Español", destinations: "", project_id: "" }, { has_destinations: false, has_project_id: false });
      expect(t.html).toContain("a<br>b &lt;script&gt;"); expect(t.html).not.toContain("termsandconditions"); expect(t.html).not.toContain("<script>");
    }
  });

  it("refuses non-https URLs (no javascript:, no http:) in any link variable", () => {
    for (const bad of ["javascript:alert(1)", "http://x.test", "//x.test", ""])
      expect(() => renderFa4Email("resume", "es", { first_name: "A", resume_url: bad }, { has_first_name: true })).toThrow(/https/);
  });
});

describe("Subject sanitation (header injection)", () => {
  it.each([
    ["Eve\r\nBcc: a@b.c", "Eve Bcc: a@b.c"], ["Eve Cc: a", "Eve Cc: a"], ["x\u0085y", "x y"], ["=?utf-8?B?QQ==?=", ""], ["a=?b", "a b"], ["‮evil", "evil"],
  ])("%j", (raw, expected) => {
    const s = sanitizeSubjectValue(raw);
    expect(s).toBe(expected); expect(s).not.toMatch(/[\r\n]/);
  });
  it("caps at 60 code points and renders a subject with no raw user header text", () => {
    expect(Array.from(sanitizeSubjectValue("é".repeat(200))).length).toBe(60);
    const r = renderFa4Email("talk", "es", { topic: "t", message: "m", name: "Eve\r\nBcc: x@y.z", company: "=?utf-8?Q?x?=", email: "e@x.test", stage: "FA", fa_language: "Español" }, { has_destinations: false, has_project_id: false });
    expect(r.subject).not.toMatch(/[\r\n]|=\?|\?=/);
  });
});

describe("Premium block gate", () => {
  it("needs a real continuation AND a URL for the language AND the commercial-content policy", () => {
    expect(premiumEnabled(true, "https://x.test/p", true)).toBe(true);
    for (const c of [[false, "https://x.test/p", true], [true, undefined, true], [true, "", true], [true, "http://x.test/p", true], [true, "https://x.test/p", false], [true, "https://x.test/p", undefined]] as const)
      expect(premiumEnabled(c[0], c[1], c[2])).toBe(false);
  });

  describe("brand header (FA Public v1.0)", () => {
    const TAG = { es: "EXPANDE TU NEGOCIO CON CONFIANZA", en: "EXPAND YOUR BUSINESS WITH TRUST" } as const;
    it.each(["es", "en"] as const)("%s: the YEV and resume emails open with the full official logo + tagline; the YEV has no repeated lower «beeside» wordmark", (l) => {
      const logo = "https://fa.test/brand/beeside-lockup.png";
      const html = renderFa4Email("yev", l, { first_name: "L", yev_url: "https://x.test/a", talk_to_beeside_url: "https://x.test/b", premium_url: "https://x.test/p", logo_url: logo }, { has_logo: true, premium_enabled: true });
      expect(html.html).toContain(`<img src="${logo}"`); expect(html.html).toContain(TAG[l]);
      expect(html.html).not.toMatch(/font-weight:bold;">beeside<\/p>/);                      // the repeated lower wordmark is gone
      expect(html.text).not.toMatch(/\n\nbeeside\n\n/);
      const r = renderFa4Email("resume", l, { first_name: "L", resume_url: "https://x.test/r", logo_url: logo }, { has_first_name: true, has_logo: true });
      expect(r.html).toContain(`<img src="${logo}"`); expect(r.html).toContain(TAG[l]);
    });
    it("without a usable logo URL the header falls back to the text wordmark (never a broken image or a thrown error)", () => {
      const r = renderFa4Email("resume", "es", { first_name: "L", resume_url: "https://x.test/r", logo_url: "" }, { has_first_name: true });
      expect(r.html).not.toContain("<img"); expect(r.html).toContain(">beeside</span>");
    });
  });
});

describe("release audit — customer emails", () => {
  const logo = "https://fa.test/brand/beeside-lockup.png";
  const vars = { first_name: "L", resume_url: "https://fa.test/fa4#r=T", yev_url: "https://fa.test/fa4#r=T&view=result", talk_to_beeside_url: "https://fa.test/fa4#r=T&contact=open", premium_url: "https://beeside.you/", logo_url: logo, destination: "México", declared_objective: "x" };
  it.each([["resume", "es"], ["resume", "en"], ["yev", "es"], ["yev", "en"]] as const)("%s/%s: Discovery naming, one logo image, only https links, no leftovers, no First Assessment / FA", (kind, l) => {
    const r = renderFa4Email(kind, l, vars, { has_logo: true, has_first_name: true, premium_enabled: false, has_destination: true, show_focus_block: true });
    const all = r.html + r.text;
    expect(all).not.toMatch(/First Assessment|FIRST ASSESSMENT|\bFA4?\b/); expect(all).toContain("Discovery");
    expect((r.html.match(/<img\b/g) ?? []).length).toBe(1); expect(r.html).toContain(`src="${logo}"`);
    for (const m of r.html.matchAll(/(?:href|src)="([^"{]+)"/g)) expect(m[1]).toMatch(/^(https:\/\/|mailto:contact@beeside\.you$|#)/);
    expect(all).not.toMatch(/\{\{|<!--(IF|ENDIF)/);
    if (kind === "yev") { expect(all).toContain(l === "es" ? "La información que nos compartiste no se comparte con proveedores en esta etapa." : "The information you shared with us is not shared with providers at this stage."); expect(r.html).not.toMatch(/>beeside<\/p>/); }
    expect(r.html).not.toMatch(/Start Your Expansion/);                                      // the CTA button is not part of the email design
  });
});

import { safeReturnTo } from "../admin/admin-session";
describe("canonical routes", () => {
  it("safeReturnTo accepts the technical and the canonical admin routes and nothing else", () => {
    expect(safeReturnTo("/ops-control/audit")).toBe("/ops-control/audit"); expect(safeReturnTo("/admin/audit")).toBe("/admin/audit");
    for (const bad of ["/discovery", "//evil.test", "/ops-controlx", "https://evil.test/admin", "/ops-control/../x", "/ops-control//x"]) expect(safeReturnTo(bad)).toBe("/admin");
  });
});
