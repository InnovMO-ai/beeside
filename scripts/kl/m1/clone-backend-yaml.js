// Genera el YAML del servicio TEMPORAL a partir del export del backend. Uso: node clone-backend-yaml.js <js-yaml-dir> <entrada> <nombre> <origen> <salida>
// Reglas de seguridad (hallazgo B1 de la auditoría del 22-oct-2026): el servicio clonado debe ser PRIVADO. El backend real tiene la anotación
// `run.googleapis.com/invoker-iam-disabled: 'true'` (público); se ELIMINA aquí y el script que despliega comprueba que no volvió.
const [,, yamlDir, input, name, origin, output] = process.argv;
const y = require(yamlDir + "/node_modules/js-yaml"); const fs = require("fs");
const d = y.load(fs.readFileSync(input, "utf8"));
d.metadata.name = name;
for (const k of Object.keys(d.metadata.annotations || {})) if (/ingress-status|creator|lastModifier|operation-id|urls|invoker-iam-disabled/.test(k)) delete d.metadata.annotations[k];
if ((d.metadata.annotations || {})["run.googleapis.com/invoker-iam-disabled"] !== undefined) throw new Error("la anotación invoker-iam-disabled sigue presente");
const t = d.spec.template; delete t.metadata.name;
t.metadata.annotations["autoscaling.knative.dev/maxScale"] = "1"; t.metadata.annotations["autoscaling.knative.dev/minScale"] = "0";
const c = t.spec.containers[0]; c.command = ["sh"];
// Reescribe la base de KL en las dos URLs y FALLA (el contenedor no arranca) si la reescritura no tuvo efecto: nunca debe usar la base real por descuido.
c.args = ["-c", 'for v in KL_DB_URL_APP KL_DB_URL_READER; do old="$(printenv $v)"; new="$(printf %s "$old" | sed "s#/beeside_kl?#/beeside_kl_e2e?#")"; [ "$new" != "$old" ] || { echo "reescritura de $v sin efecto: no se arranca" >&2; exit 1; }; export "$v=$new"; done; exec node dist/index.js'];
const set = (n, v) => { const e = c.env.find((x) => x.name === n); if (e) { delete e.valueFrom; e.value = v; } else c.env.push({ name: n, value: v }); };
set("ADMIN_OIDC_REDIRECT_URI", origin + "/api/admin/auth/callback"); set("ADMIN_APP_ORIGIN", origin); set("APP_BASE_URL", origin); set("ALLOWED_ORIGINS", origin);
delete d.status; fs.writeFileSync(output, y.dump(d));
