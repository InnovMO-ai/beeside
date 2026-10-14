/**
 * Generic extraction: any approved format -> ordered sections of text with a human-checkable location.
 * PDF uses `pdftotext` (page-aware), DOCX unzips word/document.xml, HTML strips markup, CSV keeps rows, TXT/MD keep headings.
 * No format is specific to any publication.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type DocFormat = "pdf" | "docx" | "html" | "csv" | "md" | "txt";
export interface Section { location: string; text: string; row?: Record<string, string> }

export function detectFormat(name: string): DocFormat {
  const e = name.toLowerCase().split(".").pop() ?? "";
  if (e === "pdf") return "pdf";
  if (e === "docx") return "docx";
  if (e === "html" || e === "htm") return "html";
  if (e === "csv") return "csv";
  if (e === "md" || e === "markdown") return "md";
  return "txt";
}

const decode = (s: string): string => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

function withTemp<T>(name: string, data: Buffer, fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "kn-"));
  try { const p = join(dir, name); writeFileSync(p, data); return fn(p); } finally { rmSync(dir, { recursive: true, force: true }); }
}

export function extractPdf(data: Buffer): Section[] {
  const out = withTemp("in.pdf", data, (p) => execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", p, "-"], { maxBuffer: 256 * 1024 * 1024 }).toString("utf8"));
  return out.split("\f").map((t, i) => ({ location: `p. ${i + 1}`, text: t.replace(/[ \t]+\n/g, "\n").trim() })).filter((s) => s.text.length > 0);
}

export function extractDocx(data: Buffer): Section[] {
  const xml = withTemp("in.docx", data, (p) => execFileSync("unzip", ["-p", p, "word/document.xml"], { maxBuffer: 256 * 1024 * 1024 }).toString("utf8"));
  const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => {
    const block = m[0];
    const style = /<w:pStyle w:val="([^"]+)"/.exec(block)?.[1] ?? "";
    const text = [...block.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((x) => decode(x[1] ?? "")).join("");
    return { style, text: text.trim() };
  }).filter((p) => p.text);
  return groupByHeading(paras.map((p) => ({ heading: /^(Heading|Ttulo|Título|Title)/i.test(p.style), text: p.text })));
}

function groupByHeading(lines: { heading: boolean; text: string }[]): Section[] {
  const out: Section[] = [];
  let head = "Inicio"; let buf: string[] = [];
  const flush = (): void => { if (buf.length) out.push({ location: `§ ${head}`, text: buf.join("\n") }); buf = []; };
  for (const l of lines) { if (l.heading) { flush(); head = l.text.slice(0, 80); } else buf.push(l.text); }
  flush();
  return out;
}

export function extractHtml(src: string): Section[] {
  const cleaned = src.replace(/<(script|style|nav|footer|header)[\s\S]*?<\/\1>/gi, " ");
  const lines: { heading: boolean; text: string }[] = [];
  for (const m of cleaned.matchAll(/<(h[1-6]|p|li|td|th|div)[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = decode((m[2] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (text) lines.push({ heading: /^h[1-6]$/i.test(m[1] ?? ""), text });
  }
  if (!lines.length) { const t = decode(cleaned.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); if (t) lines.push({ heading: false, text: t }); }
  return groupByHeading(lines);
}

export function parseCsv(src: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ""; let q = false;
  const s = src.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === "," || c === ";") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cur); if (row.some((x) => x.trim())) rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export function extractCsv(src: string): Section[] {
  const rows = parseCsv(src);
  const head = (rows[0] ?? []).map((h) => h.trim());
  return rows.slice(1).map((r, i) => {
    const rec: Record<string, string> = {};
    head.forEach((h, j) => { rec[h] = (r[j] ?? "").trim(); });
    return { location: `fila ${i + 2}`, text: head.map((h) => `${h}: ${rec[h] ?? ""}`).join("; "), row: rec };
  });
}

export function extractText(src: string, format: "md" | "txt"): Section[] {
  const lines = src.split(/\r?\n/);
  if (format === "md") return groupByHeading(lines.filter((l) => l.trim()).map((l) => (/^#{1,6}\s/.test(l) ? { heading: true, text: l.replace(/^#{1,6}\s+/, "") } : { heading: false, text: l.trim() })));
  const paras = src.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  return paras.map((p, i) => ({ location: `párrafo ${i + 1}`, text: p }));
}

export function extractSections(name: string, data: Buffer): Section[] {
  switch (detectFormat(name)) {
    case "pdf": return extractPdf(data);
    case "docx": return extractDocx(data);
    case "html": return extractHtml(data.toString("utf8"));
    case "csv": return extractCsv(data.toString("utf8"));
    case "md": return extractText(data.toString("utf8"), "md");
    default: return extractText(data.toString("utf8"), "txt");
  }
}
