import React from "react";
import ReactDOM from "react-dom/client";

// Three experiences share one build but not one stylesheet or bundle entry:
//  - /admin (alias /ops-control) -> internal Control Center,
//  - /fa4 (alias /discovery)    -> Discovery / FA Public v1.0 (isolated module; its own CSS, never mixed with the legacy styles),
//  - /precision -> Precision Center V2.0 (isolated module; its own CSS and tokens),
//  - the rest -> the existing First Assessment.
const path = window.location.pathname;
// Canonical public/internal routes: /discovery (public Discovery = the /fa4 module) and /ops-control (internal administration = the /admin module).
// The technical paths keep working. /ops-control is never linked from Discovery.
const isControlCenter = /^\/(admin|ops-control)(\/|$)/.test(path);
const isFa4 = /^\/(fa4|discovery)(\/|$)/.test(path);
const isPrecision = path === "/precision" || path.startsWith("/precision/");
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

async function boot() {
  if (isFa4) {
    await import("./fa4/fa4.css");
    const { Fa4App } = await import("./fa4/Fa4App");
    root.render(<React.StrictMode><Fa4App /></React.StrictMode>);
    return;
  }
  if (isPrecision) {
    const { PrecisionApp } = await import("./precision/PrecisionApp");
    root.render(<React.StrictMode><PrecisionApp /></React.StrictMode>);
    return;
  }
  await import("./styles.css");
  if (isControlCenter) {
    const { AdminApp } = await import("./admin/AdminApp");
    root.render(<React.StrictMode><AdminApp /></React.StrictMode>);
  } else {
    const { App } = await import("./App");
    root.render(<React.StrictMode><App /></React.StrictMode>);
  }
}
void boot();
