import { TEMPLATE_FILES } from "./email-templates/templates.generated";

/**
 * Renders the three frozen FA4 email templates (Design v2). Contract (FA4_EMAIL_HANDOFF §8):
 *  - `{{var}}` variables, `<!--IF:flag-->…<!--ENDIF:flag-->` / `<!--IFNOT:flag-->…<!--ENDIFNOT:flag-->` conditionals; conditionals first, then variables;
 *  - every HTML variable is escaped; `message` additionally keeps its line breaks (`\n` → `<br>`); `*_url` must be https;
 *  - plain text is not HTML-escaped but loses control characters; nothing unresolved may remain in the output;
 *  - the Subject never contains a raw user value: values are sanitized (controls, CR/LF, U+2028/9, bidi controls, encoded-words) and capped.
 */
export type EmailKind = "resume" | "yev" | "talk";
export type EmailLocale = "es" | "en";
export interface RenderedEmail { subject: string; html: string; text: string }

const htmlEscape = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
// C0 / DEL / C1 controls except \n; line and paragraph separators; bidi override/isolate controls
const CONTROLS = new RegExp("[\\u0000-\\u0009\\u000B-\\u001F\\u007F-\\u009F\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069]", "g");
const stripControls = (v: string) => v.replace(/\r\n?/g, "\n").replace(CONTROLS, "");

/** Value of the user inside a header (Subject): one clean line, no encoded-word, ≤ 60 code points. */
export function sanitizeSubjectValue(v: string, max = 60): string {
  let s = String(v ?? "").replace(/\r\n?|\n/g, " ").replace(CONTROLS, " ");
  s = s.replace(/=\?[^?\s]*\?[A-Za-z]\?[^?\s]*\?=/g, " ").replace(/=\?|\?=/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return Array.from(s).slice(0, max).join("").trim();
}

function resolveConditionals(src: string, flags: Record<string, boolean>): string {
  let out = src;
  for (let guard = 0; guard < 50 && /<!--(IF|IFNOT):/.test(out); guard++) {
    out = out.replace(/<!--IF:(\w+)-->([\s\S]*?)<!--ENDIF:\1-->/g, (_m, f: string, body: string) => (flags[f] ? body : ""));
    out = out.replace(/<!--IFNOT:(\w+)-->([\s\S]*?)<!--ENDIFNOT:\1-->/g, (_m, f: string, body: string) => (flags[f] ? "" : body));
  }
  return out;
}

function fill(src: string, vars: Record<string, string>, mode: "html" | "text"): string {
  return src.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) => {
    const raw = vars[name] ?? "";
    if (/_url$/.test(name)) {
      if (!/^https:\/\//i.test(raw)) throw new Error(`email variable ${name} must be an https URL`);
      return mode === "html" ? htmlEscape(raw) : raw;
    }
    const clean = stripControls(raw);
    if (mode === "text") return clean;
    const esc = htmlEscape(clean);
    return name === "message" ? esc.replace(/\n/g, "<br>") : esc.replace(/\n/g, " ");
  });
}

const FILE = (kind: EmailKind, locale: EmailLocale, ext: "html" | "txt") => {
  const f = TEMPLATE_FILES[`fa4_${kind}_${locale}.${ext}`];
  if (!f) throw new Error(`missing email template fa4_${kind}_${locale}.${ext}`);
  return f;
};
const SUBJECTS = JSON.parse(TEMPLATE_FILES["subjects.json"]!) as Record<EmailKind, Record<EmailLocale, { subject: string; preheader: string | null }>>;

export function renderFa4Email(kind: EmailKind, locale: EmailLocale, vars: Record<string, string | undefined>, flags: Record<string, boolean>): RenderedEmail {
  const v: Record<string, string> = Object.fromEntries(Object.entries(vars).map(([k, x]) => [k, x ?? ""]));
  const html = fill(resolveConditionals(FILE(kind, locale, "html"), flags), v, "html");
  const text = fill(resolveConditionals(FILE(kind, locale, "txt"), flags), v, "text");
  for (const [label, out] of [["html", html], ["text", text]] as const)
    if (/\{\{|<!--(IF|IFNOT|ENDIF|ENDIFNOT)/.test(out)) throw new Error(`unresolved template marker in ${kind}/${locale} ${label}`);
  let subject = SUBJECTS[kind][locale].subject;
  if (kind === "talk") {
    const company = sanitizeSubjectValue(v.company ?? ""), name = sanitizeSubjectValue(v.name ?? "");
    subject = subject.replace(" — {{company}}", company ? " — {{company}}" : "").replace("{{company}}", company).replace("{{name}}", name || "—");
  }
  return { subject: subject.replace(/\s+/g, " ").trim(), html, text };
}
