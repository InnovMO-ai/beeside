import { Api, ctl, seed, type Seeded } from "./qa";

let n = 0;
export const newKey = (p = "q") => `${p}${++n}-${Math.random().toString(36).slice(2, 10)}`;

export const SA_ANSWERS = [
  "Decide whether to commit to a local presence",
  "Does the plan make commercial sense at our expected volumes?",
  "Market",
  "Retail and food-service distribution for packaged dry goods",
  "Mexico",
  "A clear recommendation we can take to our board",
  "Whether to set up a local company this year",
  "Feasibility report",
];

/** A project at `logistics_ready` (answers recorded by the seed) whose Logistics CRP is already confirmed through the API. */
export async function logisticsConfirmed(locale: "en" | "es" = "en"): Promise<{ project: Seeded; api: Api; catId: string }> {
  const project = await seed("logistics_ready");
  const api = await Api.open(project.projectId, locale);
  const catId = await api.categoryId();
  const r = await api.post(`/categories/${catId}/crp/confirm`, { requestKey: newKey("c") });
  if (r.status !== 200) throw new Error(`confirm failed ${r.status}`);
  return { project, api, catId };
}

export async function sendViaApi(api: Api, catId: string): Promise<void> {
  const pv = await api.get(`/categories/${catId}/preview`);
  const s = await api.post(`/categories/${catId}/send`, { previewChecksum: pv.body.previewChecksum });
  if (s.body.state !== "sent") throw new Error(`send ${JSON.stringify(s.body)}`);
}

export async function turn(api: Api, catId: string, text: string): Promise<any> {
  const r = await api.post(`/categories/${catId}/turns`, { turnKey: newKey("t"), text });
  if (r.status !== 200) throw new Error(`turn ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

/** Strategic Advisory through to a confirmed CRP (Logistics is sent first so the first-send rule is already satisfied). */
export async function advisoryConfirmed(api: Api, logisticsId: string): Promise<string> {
  await sendViaApi(api, logisticsId);
  const sa = await api.categoryId(/advisory|asesor/i);
  for (const a of SA_ANSWERS) await turn(api, sa, a);
  const c = await api.post(`/categories/${sa}/crp/confirm`, { requestKey: newKey("c") });
  if (c.status !== 200) throw new Error(`confirm SA ${c.status}`);
  return sa;
}
export { ctl };
