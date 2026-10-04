# FA Public v1.0 — copy proposals for PO approval

Status after the VERIFY fix pass. **Nothing here is applied**: A is already applied from canon; B is one grouped proposal; C is 11 grouped decisions; D stays blocked.

| Bucket | Before | Now |
|---|---|---|
| A — canonical source exists | 67 | **0 remaining** (all 67 applied; 9 wording updates from canon: acts.source, acts.invest_only, permOpts.open, causes.hire, values.no_network, sellsToOpts.mixed, ownBrand, regulated, extraLead; plus 5 new strings that are literal in the frozen render: colTopic, colStatus, colSupport, readyBefore, r1EyebrowNamed) |
| B — safe system copy | 20 | 20 + 9 new inline-captured system strings (below) |
| C — needs PO | 11 groups / 96 ids | 11 groups (C11 "unsafe unmatched need" resolved by instruction; replaced by new C11 "inline result sentences") |
| D — legal / brand blocked | 6 | 6 (exitBody is now neutral, but stays listed until LEGAL-1 closes) |

Total NEEDS_CANONICAL_COPY entries in `COPY_INVENTORY.md`: **141** (was 189). The inventory now also captures every previously inline customer-facing string (language ternaries and JSX text are forbidden by `copyGate.test.ts`).

## Resolved by instruction (not a decision)
- Unmatched / UNMAPPED need: Premium or Sherpa continuation → «Lo revisaremos con tu Sherpa.»; otherwise → «Lo identificamos como un tema a considerar.» (EN: “We'll review it with your Sherpa.” / “We identified this as a topic to consider.”). Uses the existing canonical state messages.
- Exit message: «First Assessment está pensado para empresas o negocios que ya operan y quieren expandirse.» (no anonymity/retention claim).

## B — one grouped approval (system copy)

| id | ES | EN |
|---|---|---|
| `coverLang` | Elige tu idioma | Choose your language |
| `datePh` | Ej. 2028-Q1 o 2026-12 | e.g. 2028-Q1 or 2026-12 |
| `email.result.body` | Aquí está el resultado de tu proyecto. | Here is the result for your project. |
| `email.result.cta` | Ver mi resultado | See my result |
| `email.result.subject` | Tu Your Expansion View | Your Expansion View |
| `email.resume.body` | Usa este enlace para continuar donde lo dejaste. | Use this link to continue where you left off. |
| `email.resume.cta` | Continuar | Continue |
| `email.resume.subject` | Retoma tu First Assessment | Pick up your First Assessment |
| `emailed` | Te lo enviamos al correo que nos diste. | We sent it to the email you gave us. |
| `emailInvalid` | Revisa el correo | Check the email address |
| `generating` | Preparando tu resultado… | Preparing your result… |
| `none` | Sin resultados | No results |
| `openInNewTab` | (se abre en una pestaña nueva) | (opens in a new tab) |
| `resultError` | No pudimos preparar el resultado. Inténtalo de nuevo. | We couldn't prepare your result. Please try again. |
| `saved` | Te enviamos un enlace para retomar a | We sent a link to pick this up again to |
| `saveError` | No pudimos guardar ahora. Tu avance sigue en este dispositivo. | We couldn't save right now. Your progress is still on this device. |
| `sectorPh` | Ej. desarrollo de software | e.g. software development |
| `seeResult` | Ver mi resultado | See my result |
| `start` | Empezar | Start |
| `valuesLead` | Elige lo que más te importa. Puedes saltarlo. | Pick what matters most. You can skip this. |
| `catalogErrorTitle` (new, was inline) | No pudimos cargar First Assessment | We couldn't load First Assessment |
| `catalogErrorBody` (new, was inline) | Revisa tu conexión e inténtalo de nuevo. No se perdió nada. | Check your connection and try again. Nothing was lost. |
| `retry` (new, was inline) | Reintentar | Try again |
| `progress` (new, was inline) | Progreso | Progress |
| `remove` (new, was inline) | Quitar | Remove |
| `marked` (new, was inline) | Marcados | Marked |
| `because` (new, was inline) | Porque | Because |
| `countryYouChoose` (new, was inline) | el país que elijas | the country you choose |
| `dependsOnLabel` (new, was inline) | Depende de | Depends on |

## C — 11 grouped decisions (context · proposed ES · proposed EN · why it matters)

Proposed text = the current build text unless PO edits; it is a proposal, not canon.

### C1 Cover promise (what you get, how long, 'not an exam')
**Current context:** Cover (first screen). Promises what the user gets, how long it takes and that it is not an exam.
**Why it matters:** If it over-promises (time, outcome) it sets the wrong expectation; it is the only place that says 'no account / not an exam'.

| id | proposed ES | proposed EN |
|---|---|---|
| `coverTitle` | Entiende tu expansión en pocos minutos | Understand your expansion in a few minutes |
| `coverLead` | Cuéntanos tu proyecto y recibe Your Expansion View: lo que entendemos de tu proyecto y dónde beeside puede aportar valor. | Tell us about your project and get Your Expansion View: what we understand about your project and where beeside adds value. |
| `coverMeta` | Unos 5–10 minutos · Sin crear cuenta · No es un examen ni una calificación. | About 5–10 minutes · No account needed · Not an exam or a rating. |

### C2 Eligibility gate wording
**Current context:** Eligibility gate (is the business already running?) and the early exit screen title.
**Why it matters:** Wording that sounds like rejection loses a lead; the exit body is now a neutral one-sentence statement (no anonymity/retention claim).

| id | proposed ES | proposed EN |
|---|---|---|
| `hasBiz` | ¿Tu empresa o negocio ya está en marcha? | Is your company or business already up and running? |
| `exitTitle` | Por ahora, FA es para negocios en marcha | For now, FA is for businesses already running |

### C3 Identity + company field labels and ranges
**Current context:** Identity step and company step: field labels, answer options and size ranges.
**Why it matters:** Labels drive form completion; size ranges feed the 'Tu empresa … tiene …' sentence in the reflection and result.

| id | proposed ES | proposed EN |
|---|---|---|
| `name` | Nombre | Name |
| `company` | Empresa | Company |
| `email` | Correo de trabajo | Work email |
| `role` | Tu rol en el proyecto | Your role in the project |
| `decider` | ¿Quién decide sobre este proyecto? | Who decides on this project? |
| `deciderOpts.me` | Yo | I do |
| `deciderOpts.other` | Otra persona | Someone else |
| `deciderOpts.shared` | Decidimos entre varios | We decide together |
| `sector` | ¿Qué hace tu empresa? | What does your company do? |
| `operatesIn` | ¿Dónde opera hoy? | Where does it operate today? |
| `size` | ¿De qué tamaño es la empresa? | How big is the company? |
| `sizes.1-10` | 1–10 personas | 1–10 people |
| `sizes.11-50` | 11–50 | 11–50 |
| `sizes.51-250` | 51–250 | 51–250 |
| `sizes.251-1000` | Más de 250 | More than 250 |
| `sizes.1000+` | Más de 1.000 | More than 1,000 |
| `region` | Región o estado (opcional) | Region or state (optional) |

### C4 Project-structure option vocabularies
**Current context:** Project-structure step vocabularies (with what, how present, what exists today, permanence).
**Why it matters:** These words are echoed back in the reflection (R1) and Your Expansion View; inconsistency would make FA look like it misunderstood.

| id | proposed ES | proposed EN |
|---|---|---|
| `withs.goods` | Bienes físicos | Physical goods |
| `withs.services` | Servicios | Services |
| `withs.digital` | Productos o servicios digitales | Digital products or services |
| `pres.remote` | Desde fuera, de forma remota | From abroad, remotely |
| `pres.third_parties` | A través de terceros | Through third parties |
| `pres.own_physical` | Con presencia propia: oficina, planta o local | With your own presence: office, plant or premises |
| `pres.own_onsite` | Con equipo propio ejecutando en sitio, sin espacio propio | With your own team executing on site, without premises of your own |
| `pres.acquisition` | Comprando o adquiriendo una empresa | Buying or acquiring a company |
| `pres.open` | Aún no está definido | Not defined yet |
| `exist.nothing` | Nada todavía | Nothing yet |
| `exist.via_third` | Presencia a través de terceros: distribuidor, clientes… | Presence through third parties: distributor, customers… |
| `exist.own` | Presencia propia | A presence of your own |
| `existNote` | ¿Con quién o cómo? (opcional) | With whom or how? (optional) |
| `perm` | ¿Será permanente o temporal? | Will it be permanent or temporary? |
| `months` | ¿Cuántos meses, aproximadamente? | About how many months? |
| `sellsTo` | ¿A quién vendes? | Who do you sell to? |

### C5 Motive taxonomy (input options + how the result words them)
**Current context:** Motive options (input) and how the result words each motive.
**Why it matters:** Motives are quoted back to the customer in 'Por qué ahora'; input wording and result wording must read as the same idea.

| id | proposed ES | proposed EN |
|---|---|---|
| `reasons.client_request` | Un cliente me lo pidió | A customer asked for it |
| `reasons.contract` | Ejecutar un contrato ganado | Execute a contract I won |
| `reasons.cost` | Costos o eficiencia | Cost or efficiency |
| `reasons.diversify` | Depender menos de un mercado | Depend less on one market |
| `reasons.follow_clients` | Acompañar a clientes actuales | Follow current customers |
| `reasons.growth` | Una oportunidad de crecimiento | A growth opportunity |
| `reasons.other` | Otro motivo | Something else |
| `reasons.partner` | Una plataforma para crecer con otros clientes | A platform to grow with other customers |
| `reasons.resilience` | Una cadena de suministro más resiliente | A more resilient supply chain |
| `reasons.talent` | Acceso a talento | Access to talent |
| `yev.reason.client_request` | Un cliente te lo pidió | A customer asked for it |
| `yev.reason.contract` | Ejecutar un contrato ganado | Executing a contract you won |
| `yev.reason.cost` | Costos y eficiencia | Cost and efficiency |
| `yev.reason.diversify` | Diversificar mercados o riesgos | Diversifying markets or risks |
| `yev.reason.follow_clients` | Acompañar a clientes actuales | Following current customers |
| `yev.reason.growth` | Oportunidad de crecimiento | Growth opportunity |
| `yev.reason.other` | Otro motivo | Another reason |
| `yev.reason.partner` | Una plataforma para crecer con otros clientes | A platform to grow with other customers |
| `yev.reason.resilience` | Resiliencia de la cadena de suministro | Supply chain resilience |
| `yev.reason.talent` | Acceso a talento | Access to talent |
| `reasonMirror` | Lo que nos cuentas | What you're telling us |

### C6 Project-size questions + 'why we ask'
**Current context:** Project-size questions per proxy (investment, people, products, purchase, duration) and the 'why we ask' note.
**Why it matters:** Sensitive question: the note carries the privacy promise (not used to evaluate).

| id | proposed ES | proposed EN |
|---|---|---|
| `scaleQ.duration` | ¿Cuánto durará el proyecto en | How long will the project last in |
| `scaleQ.investment` | ¿Qué inversión estimas en | What investment do you expect in |
| `scaleQ.people` | ¿Cuántas personas contratarías en | How many people would you hire in |
| `scaleQ.products` | ¿Cuántos productos o líneas llevarías a | How many products or lines would you take to |
| `scaleQ.purchase` | ¿Qué volumen de compra prevés en | What purchase volume do you expect in |
| `scaleWhy` | ¿Por qué preguntamos? Sólo para dimensionar el proyecto; no lo usamos para evaluarte. | Why do we ask? Only to size the project; we don't use it to assess you. |

### C7 'Because…' explanations not present in any frozen render
**Current context:** 'Porque …' explanations under each topic in the topics step.
**Why it matters:** They explain why a topic applies; they must never imply a judgement or a promise.

| id | proposed ES | proposed EN |
|---|---|---|
| `because.declared` | lo mencionaste | you mentioned it |
| `because.invest_only` | inviertes sin operar | you invest without operating |
| `because.own_brand` | vendes con marca propia | you sell under your own brand |
| `because.regulated` | tu actividad está regulada | your activity is regulated |
| `because.sell` | vas a vender | you will sell |
| `because.sells_government` | vendes a gobierno | you sell to government |
| `because.third_parties` | estarás presente a través de terceros | you will be present through third parties |

### C8 Result sentence fragments (presence tails, phrases, size, start, open items, critical-date fallback)
**Current context:** Result sentence fragments (presence tails, phrases, size, start, open items, critical-date fallback).
**Why it matters:** They compose the 'Tu proyecto' paragraph the customer reads and corrects (R1).

| id | proposed ES | proposed EN |
|---|---|---|
| `yev.open.where` | Dónde estará el proyecto en ${d.name.es} | Where the project will be in ${d.name.en} |
| `yev.phrase.invest` | Inversión | Investment |
| `yev.phrase.operation` | Operación | Operation |
| `yev.size.declined` | En ${dn.es}: prefieres no decirlo. | In ${dn.en}: you prefer not to say. |
| `yev.size.generic` | En ${dn.es}: ${s.text}. | In ${dn.en}: ${s.text}. |
| `yev.start.unknown` | Momento de inicio aún por definir | Start date still to be defined |
| `yev.tail.acq` | mediante una adquisición | through an acquisition |
| `yev.tail.onsite` | ejecutando en sitio | executing on site |
| `yev.tail.remote` | de forma remota | remotely |
| `yev.tail.own` | con presencia propia | with your own presence |
| `yev.tail.third` | a través de terceros | through third parties |
| `yev.tail.temporary` | durante ${dur?.es ?? 'un periodo definido'}, con fin previsto | for ${dur?.en ?? 'a defined period'}, with a planned end |
| `yev.tail.open` | aún sin definir cómo | with the form still to be defined |
| `criticalTitle` | ¿Qué debe estar listo según tu calendario? | What needs to be ready according to your schedule? |

### C9 No-Premium closing (conversion / D-050)
**Current context:** Closing shown when no Premium continuation has real value (D-050).
**Why it matters:** Honest no-sell message; a wrong tone either oversells or reads as a dead end.

| id | proposed ES | proposed EN |
|---|---|---|
| `noPremiumTitle` | Esto es lo que entendemos de tu proyecto | This is what we understand about your project |
| `noPremiumBody` | Por ahora no tenemos un siguiente paso con valor real que ofrecerte para este proyecto; el entendimiento que ves aquí es lo que te entregamos. | For now we don't have a next step with real value to offer for this project; the understanding you see here is what we deliver. |

### C10 Optional free-text prompts + personal-need checkbox
**Current context:** Optional free-text prompts and the personal-need checkbox.
**Why it matters:** Optional context; tone must keep it clearly optional.

| id | proposed ES | proposed EN |
|---|---|---|
| `descPh` | Cuéntalo con tus palabras (opcional) | Say it in your own words (optional) |
| `descr` | Descríbelo con tus palabras | Describe it in your own words |
| `constraints` | Restricciones que ya conoces | Constraints you already know |
| `experience` | Experiencia o intentos anteriores | Previous experience or attempts |
| `unknowns` | Lo que todavía no sabes | What you don't know yet |
| `valueWords` | En tus palabras (opcional) | In your own words (optional) |
| `personal` | Hay una necesidad personal ligada al proyecto (sólo queremos saber que existe, sin detalles) | There is a personal need tied to the project (we only need to know it exists, no details) |

### C11 Result headline and summary sentences (previously inline, now captured)
**Current context:** "Lo que toca" headline (e.g. «Tres temas aplican hoy. Uno más depende de una decisión.»), the "De un vistazo" footer for Journey A and the "no indicado" notes.
**Why it matters:** first sentence of the result; plural/singular and the «El detalle, abajo» pointer must read naturally in both languages. `{n}`/`{applies}` are filled by the engine.

| id | proposed ES | proposed EN |
|---|---|---|
| `headAppliesShortcut` | {applies} temas aplican. Marcaste {marked}. | {applies} topics apply. You marked {marked}. |
| `headApplies1` | {applies} tema aplica | {applies} topic applies |
| `headAppliesN` | {applies} temas aplican | {applies} topics apply |
| `headToday` |  hoy |  today |
| `headIn` |  en {n} países |  across {n} countries |
| `headDepends1` |  Uno más depende de una decisión. |  One more depends on a decision. |
| `headDependsN` |  {n} más dependen de una decisión. |  {n} more depend on a decision. |
| `noStatusNote` | A los {n} temas que no marcaste no les asignamos estado. | We don't assign a status to the {n} topics you didn't mark. |
| `notIndicatedNote` | «No indicado» no significa resuelto: aplica a tu proyecto, pero no lo marcaste. | “Not indicated” doesn't mean resolved: it applies to your project, but you didn't mark it. |
| `glanceOthers` | Otros {n} temas no aplican a tu proyecto. El detalle, abajo. | {n} other topics do not apply to your project. Details below. |
| `glanceOther1` | Otro tema no aplica a tu proyecto. El detalle, abajo. | 1 other topic does not apply to your project. Details below. |

## D — blocked (legal / brand)

- `continued` — Listo: tu solicitud quedó registrada. Seguiremos contigo en el mismo correo. (LEGAL-1)
- `emailHelp` — Preferimos un correo de la empresa, pero puedes usar otro. Lo usaremos para guardar tu avance, enviarte el resultado y continuar contigo; no te lo volveremos a pedir. (LEGAL-1)
- `exitBody` — First Assessment está pensado para empresas o negocios que ya operan y quieren expandirse. Guardamos tu interés de forma anónima para entender qué necesitan quienes están empezando. Gracias por contarnos. (LEGAL-1)
- `logoAlt` — Logo de beeside (BRAND-1)
- `privacy` — Reconozco la Política de Privacidad (CHK-1)
- `terms` — Acepto los Términos y Condiciones (CHK-1)
