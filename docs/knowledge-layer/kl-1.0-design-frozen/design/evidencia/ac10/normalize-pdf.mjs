// Prototipo de Design: normaliza los campos volátiles de un PDF de Chromium SIN cambiar longitudes de bytes,
// de modo que la tabla xref sigue siendo válida. Uso: node normalize-pdf.mjs <in.pdf> <out.pdf> <YYYYMMDDHHmmSS> <hex32>
import { readFileSync, writeFileSync } from "node:fs";

const [inp, out, stamp, idHex] = process.argv.slice(2);
let s = readFileSync(inp).toString("latin1");
const report = { creationDate: 0, modDate: 0, id: 0 };

// /CreationDate (D:20261016123456+00'00') → misma longitud con la fecha de la edición
const fixDate = (key) => {
  s = s.replace(new RegExp(`/${key} \\(D:(\\d{14})([^)]*)\\)`, "g"), (m, d, tz) => {
    report[key === "CreationDate" ? "creationDate" : "modDate"]++;
    return `/${key} (D:${stamp}${tz.replace(/[0-9]/g, "0")})`;
  });
};
fixDate("CreationDate");
fixDate("ModDate");

// /ID [<hex><hex>] → mismos largos, derivados de la huella del manifiesto
s = s.replace(/\/ID \[<([0-9A-Fa-f]+)> ?<([0-9A-Fa-f]+)>\]/g, (m, a, b) => {
  report.id++;
  const fill = (n) => idHex.repeat(Math.ceil(n / idHex.length)).slice(0, n).toUpperCase();
  return m.replace(a, fill(a.length)).replace(b, fill(b.length));
});

const buf = Buffer.from(s, "latin1");
if (buf.length !== readFileSync(inp).length) throw new Error("la normalización cambió la longitud");
writeFileSync(out, buf);
console.log(JSON.stringify({ out, ...report }));
