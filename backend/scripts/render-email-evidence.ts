/* eslint-disable no-console */
// Renders the full email matrix with the REAL renderer (the code path that sends) into docs/fa4/email-evidence/html|txt.
//   npx ts-node scripts/render-email-evidence.ts   (then: node ../frontend/e2e/email-shots.mjs)
import fs from "node:fs";
import path from "node:path";
import { renderFa4Email } from "../src/fa4/email-render";

const root = path.join(__dirname, "..", "..", "docs", "fa4", "email-evidence");
for (const d of ["html", "txt"]) fs.mkdirSync(path.join(root, d), { recursive: true });
const write = (name: string, r: { html: string; text: string; subject: string }) => {
  fs.writeFileSync(path.join(root, "html", `${name}.html`), r.html); fs.writeFileSync(path.join(root, "txt", `${name}.txt`), `Subject: ${r.subject}\n\n${r.text}`);
};
const URL = "https://fa4-staging.example/fa4#r=EXAMPLETOKEN";
const longName = "María de los Ángeles Fernández-Villanueva y Rodríguez de la Torre";
const longCompany = "Corporación Internacional de Soluciones Industriales y Logísticas Avanzadas de Latinoamérica S.A. de C.V.";
const longDest = "México, Estados Unidos, Canadá, Brasil, Colombia, Chile, Argentina, España, Portugal";
const longObj = "Queremos abrir una planta propia en el Bajío para atender a nuestros clientes actuales con entregas más rápidas, contratar un equipo local de ingeniería y logística, y evaluar una segunda ubicación en el norte del país durante el próximo año fiscal sin interrumpir la operación.";
for (const l of ["es", "en"] as const) {
  write(`resume-${l}`, renderFa4Email("resume", l, { first_name: "Lucía", resume_url: URL }, { has_first_name: true }));
  write(`resume-${l}-noname`, renderFa4Email("resume", l, { first_name: "", resume_url: URL }, { has_first_name: false }));
  const dest = l === "es" ? "México, India" : "Mexico, India"; const obj = l === "es" ? "Un buen equipo sin una operación compleja." : "A good team without a complex operation.";
  for (const premium of [true, false]) for (const [k, d, o] of [["full", dest, obj], ["dest-only", dest, ""], ["obj-only", "", obj], ["none", "", ""]] as const)
    write(`yev-${l}-premium-${premium ? "on" : "off"}-${k}`, renderFa4Email("yev", l, { first_name: "Lucía", yev_url: `${URL}&view=result`, talk_to_beeside_url: `${URL}&view=result&contact=open&origin=yev_email`, premium_url: "https://example.com/premium", destination: d, declared_objective: o },
      { has_first_name: true, has_destination: !!d, has_objective: !!o, show_focus_block: !!d || !!o, premium_enabled: premium }));
  write(`yev-${l}-long`, renderFa4Email("yev", l, { first_name: longName, yev_url: `${URL}&view=result`, talk_to_beeside_url: `${URL}&view=result&contact=open`, premium_url: "https://example.com/premium", destination: longDest, declared_objective: longObj },
    { has_first_name: true, has_destination: true, has_objective: true, show_focus_block: true, premium_enabled: true }));
  for (const [k, dests, pid] of [["full", longDest.slice(0, 30), "0b6e7a3c-3d7e-4d49-9a43-0f0a3b9a2d11"], ["minimal", "", ""]] as const)
    write(`talk-${l}-${k}`, renderFa4Email("talk", l, { topic: l === "es" ? "Hablar con beeside" : "Talk to beeside", message: "Hola,\nquisiera hablar con alguien de beeside sobre la logística.\n\nGracias.", name: k === "full" ? longName : "Lucía", company: k === "full" ? longCompany : "", email: "lucia@nortica.example", stage: k === "full" ? "YEV" : "First Assessment", fa_language: l === "es" ? "Español" : "English", destinations: dests, project_id: pid },
      { has_destinations: !!dests, has_project_id: !!pid }));
}
console.log("rendered", fs.readdirSync(path.join(root, "html")).length, "emails");
