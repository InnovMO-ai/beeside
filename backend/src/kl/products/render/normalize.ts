/**
 * Normalización AC-10: fija los campos volátiles de un PDF de Chromium SIN cambiar longitudes de bytes (la tabla xref sigue válida).
 * `/CreationDate` y `/ModDate` pasan a la fecha de la edición y `/ID` (si existe) se deriva de la huella del manifiesto.
 */
export interface NormalizeReport {
  creationDate: number;
  modDate: number;
  id: number;
}

export function normalizePdf(pdf: Buffer, stamp: string, idHex: string): { pdf: Buffer; report: NormalizeReport } {
  if (!/^\d{14}$/.test(stamp) || !/^[0-9a-f]{32,}$/.test(idHex)) throw new Error("sello o identificador de normalización no válidos");
  let s = pdf.toString("latin1");
  const report: NormalizeReport = { creationDate: 0, modDate: 0, id: 0 };
  const fixDate = (key: "CreationDate" | "ModDate") => {
    s = s.replace(new RegExp(`/${key} \\(D:(\\d{14})([^)]*)\\)`, "g"), (_m, _d: string, tz: string) => {
      report[key === "CreationDate" ? "creationDate" : "modDate"]++;
      return `/${key} (D:${stamp}${tz.replace(/[0-9]/g, "0")})`;
    });
  };
  fixDate("CreationDate");
  fixDate("ModDate");
  s = s.replace(/\/ID \[<([0-9A-Fa-f]+)> ?<([0-9A-Fa-f]+)>\]/g, (m, a: string, b: string) => {
    report.id++;
    const fill = (n: number) => idHex.repeat(Math.ceil(n / idHex.length)).slice(0, n).toUpperCase();
    return m.replace(a, fill(a.length)).replace(b, fill(b.length));
  });
  const out = Buffer.from(s, "latin1");
  if (out.length !== pdf.length) throw new Error("la normalización cambió la longitud");
  return { pdf: out, report };
}

/** Sello `YYYYMMDDHHmmSS` de la fecha de la edición (corte de datos), a medianoche UTC. */
export const editionStamp = (isoDate: string): string => `${isoDate.slice(0, 4)}${isoDate.slice(5, 7)}${isoDate.slice(8, 10)}000000`;
