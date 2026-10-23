/**
 * Deterministic identity of a manifest document: a canonical (key-sorted) JSON serialisation hashed with SHA-256.
 * The published version string is `${manifest_version_label}.${first 8 hex chars}`, so the same content always has the
 * same version and a changed manifest can never silently reuse an old one.
 */
import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

export function manifestContentHash(doc: unknown): string {
  return createHash("sha256").update(canonicalJson(doc)).digest("hex");
}

/** `${manifest_version_label}.${hash8}`; the label is sanitised so the result is always a plain token. */
export function manifestVersionOf(doc: { manifest_version_label?: unknown }): string {
  const label = typeof doc.manifest_version_label === "string" && doc.manifest_version_label.trim() ? doc.manifest_version_label.trim() : "0";
  return `${label.replace(/[^A-Za-z0-9._-]+/g, "-")}.${manifestContentHash(doc).slice(0, 8)}`;
}
