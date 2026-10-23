import React from "react";
import ReactDOM from "react-dom/client";

// Experiences that share one build but not one stylesheet or bundle entry:
//  - /discovery (alias /fa4) -> Discovery / FA Public v1.0 (isolated module; its own CSS, never mixed with the legacy styles),
//  - /admin                  -> the LEGACY internal Control Center (not part of Discovery),
//  - /ops-control            -> RESERVED for the Discovery administration surface: never the legacy console, never the public app,
//  - /precision              -> Precision Center V2.0 (isolated module; its own CSS and tokens; NOT part of a Discovery-only build),
//  - the rest                -> the legacy First Assessment.
// A DISCOVERY-ONLY build (production under beeside.you/discovery, VITE_DISCOVERY_ONLY=true) contains nothing but Discovery: every other path is
// "not available", so neither the legacy First Assessment nor the legacy Control Center can ever render under the Discovery identity.
const path = window.location.pathname;
const discoveryOnly = import.meta.env.VITE_DISCOVERY_ONLY === "true";
const isFa4 = /^\/(fa4|discovery)(\/|$)/.test(path) || (discoveryOnly && !/^\/ops-control(\/|$)/.test(path));   // a dedicated-host build owns "/"
const isReserved = /^\/ops-control(\/|$)/.test(path);
const isControlCenter = path === "/admin" || path.startsWith("/admin/");
const isPrecision = path === "/precision" || path.startsWith("/precision/");
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

async function boot() {
  if (isFa4) {
    await import("./fa4/fa4.css");
    const { Fa4App } = await import("./fa4/Fa4App");
    root.render(<React.StrictMode><Fa4App /></React.StrictMode>);
    return;
  }
  if (discoveryOnly || isReserved) {
    root.render(<main style={{ fontFamily: "system-ui, sans-serif", padding: "48px 24px", color: "#17181B" }}><p>Not available.</p></main>);
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
