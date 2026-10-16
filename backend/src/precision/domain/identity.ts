/**
 * Who is signed in, and what kind of country guide a configured destination is. Both are read models over configuration/profile data:
 * the name is the project's responsible Person (never hardcoded); the guide format is derived from the Admin-configured URL.
 */

export interface PersonNameParts { first_name: string | null; last_name: string | null; preferred_name: string | null }

/** Preferred name when the Person set one, else "First Last". Null when the profile has no usable name. */
export function displayNameOf(p: PersonNameParts | undefined | null): string | null {
  if (!p) return null;
  const preferred = (p.preferred_name ?? "").trim();
  const full = [p.first_name, p.last_name].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
  const name = (preferred || full).replace(/\s+/g, " ").trim();
  return name || null;
}

/** A guide configured as an https URL whose path ends in `.pdf` is a PDF (offered as "View guide" + "Download PDF"); anything else is a web page. */
export function resourceFormat(url: string): "pdf" | "web" {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /\.pdf$/i.test(u.pathname) ? "pdf" : "web";
  } catch {
    return "web";
  }
}
