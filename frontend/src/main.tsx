import React from "react";
import ReactDOM from "react-dom/client";

// Three experiences share one build but not one stylesheet or bundle entry:
//  - /admin  -> internal Control Center,
//  - /fa4    -> FA Public v1.0 (isolated module; its own CSS, never mixed with the legacy styles),
//  - the rest -> the existing First Assessment.
const path = window.location.pathname;
const isControlCenter = path === "/admin" || path.startsWith("/admin/");
const isFa4 = path === "/fa4" || path.startsWith("/fa4/");
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

async function boot() {
  if (isFa4) {
    await import("./fa4/fa4.css");
    const { Fa4App } = await import("./fa4/Fa4App");
    root.render(<React.StrictMode><Fa4App /></React.StrictMode>);
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
