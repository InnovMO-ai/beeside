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
});
