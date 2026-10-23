import { ReactNode, useEffect, useState } from "react";
import { AdminApiError } from "./api";

/** Shared Control Center building blocks (tables, key/values, loading state). */
export type Json = Record<string, unknown>;

export const text = (value: unknown): string => (value === null || value === undefined || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value));

export function formatWhen(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return "—";
  return `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value))} UTC`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.code === "FORBIDDEN") return "Your role does not allow this action.";
    return error.detail ? `${error.code}: ${error.detail}` : error.code;
  }
  return "Something went wrong.";
}

export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null);
    load()
      .then((result) => active && setData(result))
      .catch((e: unknown) => active && setError(errorMessage(e)));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  return { data, error, reload: () => setVersion((v) => v + 1) };
}

export function Status({ data, error }: { data: unknown; error: string | null }) {
  if (error) return <p className="admin-error" role="alert">{error}</p>;
  if (!data) return <p role="status">Loading…</p>;
  return null;
}

export function Table({ columns, rows, empty = "Nothing to show." }: { columns: Array<{ label: string; render: (row: Json) => ReactNode }>; rows: Json[]; empty?: string }) {
  if (rows.length === 0) return <p className="helper">{empty}</p>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>{columns.map((c) => <th key={c.label} scope="col">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>{columns.map((c) => <td key={c.label}>{c.render(row)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KeyValues({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="admin-kv">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

