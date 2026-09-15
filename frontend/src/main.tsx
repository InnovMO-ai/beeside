import React from "react";
import ReactDOM from "react-dom/client";
import { AdminApp } from "./admin/AdminApp";
import { App } from "./App";
import "./styles.css";

// The Control Center shares the build but not the experience: /admin renders only the internal surface.
const isControlCenter = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isControlCenter ? <AdminApp /> : <App />}</React.StrictMode>
);
