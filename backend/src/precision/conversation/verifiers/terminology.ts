/** R9 — terminology and acronyms (Build Readiness L-5, decisions D-9/D-10). */
import { CRP_FULL, FORBIDDEN_INTERNAL_TERMS, UNAPPROVED_VARIANTS } from "../process-knowledge/term-registry";
import type { Violation, VerifyContext } from "./types";

function r9(code: string, hit: string, message: string): Violation {
  return { rule: "R9", code, hit, message, critical: true };
}

export function checkTerminology(text: string, ctx: Pick<VerifyContext, "introducedTerms">): Violation[] {
  const out: Violation[] = [];

  for (const f of FORBIDDEN_INTERNAL_TERMS) {
    const m = text.match(f.pattern);
    if (m) out.push(r9(`forbidden_${f.id}`, m[0], f.reason));
  }
  for (const f of UNAPPROVED_VARIANTS) {
    const m = text.match(f.pattern);
    if (m) out.push(r9(`variant_${f.id}`, m[0], f.reason));
  }

  // CRP: first mention is "Category Requirement Pack (CRP)", afterwards only "CRP".
  const introduced = ctx.introducedTerms.has("crp");
  const FULL_MARK = "\u0000";
  const masked = text.split(CRP_FULL).join(FULL_MARK);
  const firstFull = masked.indexOf(FULL_MARK);
  const bareAcronym = /(?<![\p{L}\p{N}_])CRP(?![\p{L}\p{N}_])/u.exec(masked);
  const bareName = /Category Requirement Pack/u.exec(masked);

  if (bareName) out.push(r9("crp_name_without_acronym", bareName[0], 'spell "Category Requirement Pack (CRP)" together'));
  if (!introduced) {
    if (bareAcronym && (firstFull === -1 || bareAcronym.index < firstFull)) {
      out.push(r9("unintroduced_crp", "CRP", 'first mention must be "Category Requirement Pack (CRP)"'));
    }
    const occurrences = masked.split(FULL_MARK).length - 1;
    if (occurrences > 1) out.push(r9("crp_full_repeated", CRP_FULL, "after the first mention write CRP only"));
  } else if (firstFull !== -1) {
    out.push(r9("crp_full_repeated", CRP_FULL, "after the first mention write CRP only"));
  }
  return out;
}
