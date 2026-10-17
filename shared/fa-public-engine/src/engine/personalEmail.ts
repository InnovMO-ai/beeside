/**
 * «Corporate e-mail is preferred, a personal one is NOT blocked»: a reasonable detector of the common free-mail providers, used only to show a warning.
 * Deliberately not exhaustive (no attempt to catalogue every domain): provider families with country variants are matched by pattern, the rest by a short list.
 * An unknown domain is treated as corporate — the warning is advisory and never a blocker.
 */
const FAMILIES = /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|rocketmail|icloud|aol|gmx|proton|protonmail|yandex|zoho|mail|inbox|fastmail|hey)\.(com|net|org|[a-z]{2})(\.[a-z]{2})?$/;
const EXACT = new Set(['me.com', 'mac.com', 'pm.me', 'proton.me', 'qq.com', '163.com', '126.com', 'terra.com.mx', 'prodigy.net.mx', 'att.net', 'sbcglobal.net', 'comcast.net', 'verizon.net', 'web.de', 'libero.it', 'orange.fr', 'wanadoo.fr', 'free.fr', 'telefonica.net']);

export function emailDomain(email: string): string {
  const at = email.trim().toLowerCase().lastIndexOf('@');
  return at < 0 ? '' : email.trim().toLowerCase().slice(at + 1);
}
export function isLikelyPersonalEmail(email: string): boolean {
  if (!/^[^\s@]+@/.test(email.trim())) return false;     // a domain alone is not an address
  const d = emailDomain(email);
  if (!d || !d.includes('.')) return false;
  return EXACT.has(d) || FAMILIES.test(d);
}
