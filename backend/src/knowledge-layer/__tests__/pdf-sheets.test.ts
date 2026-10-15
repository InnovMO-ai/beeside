import { parseIndicatorSheet, parseTsv, type PdfWord } from "../pdf-sheets";

let n = 0;
const w = (text: string, left: number, top: number): PdfWord => ({ page: 1, left, top, width: text.length * 5, height: 8, text: (n++, text) });
const line = (txt: string, left: number, top: number): PdfWord[] => txt.split(" ").map((t, i) => w(t, left + i * 30, top));

/** A synthetic two-table page in the geometry of published indicator sheets (invented entity and numbers). */
function page(): PdfWord[] {
  return [
    ...line("Querétaro", 70, 82), w("Posición:", 387, 82), w("6", 504, 80),
    // left table: group title above the header, wrapped over two lines
    w("Mercado", 97, 165), w("de", 140, 165), w("Posición", 273, 174), w("12", 276, 180), w("trabajo", 97, 182),
    w("Indicador", 69, 210), w("Cifra", 215, 210), w("Posición", 242, 210), w("Desempeño", 271, 210),
    // row 1: name on first line, description wraps, numbers on the second line
    w("Informalidad", 70, 226), w("laboral", 113, 226), w("(Porcentaje", 70, 234), w("ocupada)", 103, 234), w("45%", 213, 232), w("9", 249, 232),
    // row 2: name over two lines, number on the first, description last
    w("Ingreso", 70, 257), w("promedio", 96, 257), w("de", 130, 257), w("11,250", 209, 263), w("18", 249, 263), w("tiempo", 70, 265), w("completo", 94, 265), w("(Pesos", 70, 273), w("por", 90, 273), w("mes)", 101, 273),
    // row 3: a negative percentage
    w("Crecimiento", 70, 296), w("de", 112, 296), w("empleo", 122, 296), w("-4.2%", 211, 300), w("31", 249, 300), w("(Tasa", 70, 304), w("anual)", 87, 304),
    w("El", 70, 330), w("desempeño", 85, 330), w("es", 120, 330), w("relativo", 130, 330),
    // right table whose first INDICATOR NAME begins with the word "Indicador" (not a header)
    w("Sistema", 346, 165), w("Político", 411, 165), w("Posición", 522, 174), w("6", 529, 180),
    w("Indicador", 318, 210), w("Cifra", 461, 210), w("Posición", 491, 210), w("Desempeño", 520, 210),
    w("Indicador", 319, 226), w("subnacional", 352, 226), w("(Índice", 319, 234), w("normalizado)", 345, 234), w("48.4", 461, 230), w("17", 498, 230),
  ];
}

describe("indicator sheets by word position", () => {
  const rows = parseIndicatorSheet(page());

  it("names the entity and the tables, one structured row per indicator", () => {
    expect(rows.map((r) => `${r.group} | ${r.indicator}`)).toEqual([
      "Mercado de trabajo | Informalidad laboral",
      "Mercado de trabajo | Ingreso promedio de tiempo completo",
      "Mercado de trabajo | Crecimiento de empleo",
      "Sistema Político | Indicador subnacional",
    ]);
    expect(rows.every((r) => r.entity === "Querétaro" && r.entityRank === 6)).toBe(true);
  });

  it("keeps value and published position exactly; multi-line names and descriptions are rebuilt", () => {
    expect(rows[0]).toMatchObject({ display: "45%", value: 45, rank: 9, description: "(Porcentaje ocupada)" });
    expect(rows[1]).toMatchObject({ display: "11,250", value: 11250, rank: 18, description: "(Pesos por mes)" });
    expect(rows[2]).toMatchObject({ display: "-4.2%", value: -4.2, rank: 31 });
    expect(rows[3]).toMatchObject({ value: 48.4, rank: 17 });
  });

  it("ignores footnotes and a page without a table header", () => {
    expect(rows.some((r) => /desempeño/i.test(r.indicator))).toBe(false);
    expect(parseIndicatorSheet([w("Texto", 10, 10), w("libre", 50, 10)])).toEqual([]);
  });

  it("does not invent a row when the published cell is empty", () => {
    const empty = page().filter((x) => !["45%", "9"].includes(x.text));
    expect(parseIndicatorSheet(empty).map((r) => r.indicator)).not.toContain("Informalidad laboral");
  });

  it("reads pdftotext -tsv output (word rows only)", () => {
    const tsv = ["level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext", "1\t3\t0\t0\t0\t0\t0\t0\t600\t800\t-1\t###PAGE###", "5\t3\t0\t0\t0\t1\t10.5\t20.5\t30\t8\t100\tHola"].join("\n");
    const m = parseTsv(tsv);
    expect([...m.keys()]).toEqual([3]);
    expect(m.get(3)![0]).toMatchObject({ text: "Hola", left: 10.5, top: 20.5 });
  });
});
