# Precision Center V2.0 · Demo route (A–J) · EN / ES

**Purpose.** A deterministic, repeatable walk through the client journey, with the exact things to type, what to expect back, and what to say. **Internal use only: presenter, QA and design review.** It is never shown to a client.

**This document is a script and a fixture. It is not product behaviour.** The route works because (1) the client is a made-up company, (2) the scripted model reads a known set of sentences, and (3) every external system is simulated. The product contains no demo branch; it follows the same rules for any project.

| What is real | What is simulated for this route |
|---|---|
| Database, migrations, append-only guards, readiness rules, manifests, conversation engine (guard, verifiers, turn idempotency), CRP confirmation, Preview, payload builder, delivery ledger, retries, events | Operation Hub (a simulator that accepts, stores and reads back the handoff), Premium entitlement (a fixture that answers "active"), First Assessment context (synthetic), the model (scripted provider, no network, no key) |

Because Operation Hub is a simulator, "Sent" here proves the Precision side only (acceptance, read-back, checksum, ledger). It says nothing about the real platform. Nothing here is a statement about any country's legal, customs or tax rules (R10); the client's sentences are only what a fictional company says about itself.

**Verified by a test.** `route-rehearsal.int.test.ts` plays every utterance below, in English and in Spanish, through the real engine, then Confirm, Preview and Send over HTTP. If a manifest, the scripted provider or the readiness rules change and a line here stops working, that test fails. Command in section M.

---

## 0. Before you start (presenter checklist)

1. Database migrated (migrations 0001–0026) and `DATABASE_URL` set.
2. Providers (these are the defaults): `PRECISION_OH_PROVIDER=simulator`, `PRECISION_ENTITLEMENT_PROVIDER=fixture`, `PRECISION_FA_CONTEXT_PROVIDER=fixture`, `PRECISION_MODEL_PROVIDER=scripted`.
3. Seed a fresh client and note the one-time access code printed in the terminal (it is shown once, never logged):
   ```
   cd backend
   DATABASE_URL=... CONFIG_BOOTSTRAP_ENV=development npm run precision:seed-demo -- --stage=start --reset
   ```
   Stages: `start` (company and project only, for the whole route A–J), `map_confirmed` (Understanding done and My Service Map confirmed, start at C), `logistics_ready` (Logistics answered, start at H). Without `--reset` the command is idempotent and reuses the existing Northwind project; `--reset` creates a new one. `--no-link` skips the access code.
4. Restart the app after every `--reset`: the fixtures (First Assessment context and Premium state) are loaded for the newest Northwind project at start-up through `loadDemoFixtures`.
5. The lane step needs no extra setting: the scripted provider now tells the origin country from the destination country by itself (section N, gap G-1). `DEMO_SCRIPT_FIXTURE` is optional.
6. Open the one-time access path the seed prints (`/precision?code=...`, on the host of the app) in a clean browser profile. The code is exchanged once for a session and is never logged. Choose the language on the first screen; the route is identical in both.

**Time:** about 12 minutes at presenting pace.

---

## A. Company and project

| | |
|---|---|
| Company | **Northwind Foods Ltd** (fictional). Packaged dry food products, 11–50 people. |
| Based in | Chile (operating country). |
| Project | Sell its packaged food in **Mexico** through local distributors, starting around **April 2027**. |
| Premium | Active (fixture). Access mode FULL. |
| First Assessment | Synthetic, client-safe: objective, destination, timeframe, five needs (third-party logistics, international freight, import and customs support, local company set-up, a feasibility review). |

**Say (EN).** "This is Northwind Foods, a made-up exporter of packaged food. They already did the First Assessment and have Premium. Everything you will see is synthetic."
**Di (ES).** "Esta es Northwind Foods, una exportadora de alimentos empacados inventada. Ya hizo el First Assessment y tiene Premium. Todo lo que verán es sintético."

## B. Destination

Mexico (`MX`). It reaches the thread as a value to **confirm**, not as a silent assumption.

## C. Category path

Understanding, then My Service Map confirmation, then the services:

```
Cover → Understanding (5 turns) → My Service Map (confirm) → Center
  → Logistics: conversation → CRP → Confirm → Preview → Send
  → (optional) Strategic Advisory → CRP → Confirm → Preview → Send
Corporate, Legal and Administrative and International Trade and Customs stay "Not started": they are on the map, not walked in this route.
```

---

## D. What to type, turn by turn

Type the text exactly (or click the matching button). Text in the **Expect** column is the assistant reply. The questions are fixed, reviewed wording in both languages ("copy bank"); the real model will phrase some turns differently. The facts, states and order do not change. Short acknowledgements ("Noted", "Thanks, I have that") rotate, so the first words of a reply can differ from this table.

### D1. Understanding (English)

| # | Type | Expect |
|---|---|---|
| 0 | (opening) | One-time notice that Precision uses artificial intelligence. Then: "From what you told me in your First Assessment, I understand this: *Start selling our packaged food products in Mexico through local distributors*. Is that still the case?" with the buttons **Yes, that is correct** / **I want to correct it**. |
| 1 | `Yes` (or click the button) | "From what you told me in your First Assessment, I understand this: *Mexico*. Is that still the case?" |
| 2 | `Yes` | "Confirmed. What product or service do you want to bring to this market? It tells us what the services have to support." (quick reply: Not sure yet) |
| 3 | `We make dry packaged food products with a long shelf life, mainly snacks and cereals` | "Noted. Which company or entity will operate in the destination? A company name or a short description is enough; you can leave it pending." |
| 4 | `We plan to set up a local company in Mexico` | "Understood. When would you like to start? A month and year are enough." |
| 5 | `April 2027` | "I have what I need to put together your My Service Map. Review it and, when you agree, confirm it." Understanding is now **ready to confirm**. |

No percentage is ever shown during Understanding. The time window is asked (not offered) because the synthetic timeframe ("within the next nine months") is not a date.

### D1. Comprensión (Español)

| # | Escribe | Esperado |
|---|---|---|
| 0 | (apertura) | Aviso único de uso de inteligencia artificial. Después: "Con lo que me contaste en tu First Assessment, entiendo esto: *Start selling our packaged food products in Mexico through local distributors*. ¿Sigue siendo así?" con **Sí, es correcto** / **Quiero corregirlo**. |
| 1 | `Sí` | "Con lo que me contaste en tu First Assessment, entiendo esto: *México*. ¿Sigue siendo así?" |
| 2 | `Sí` | "Confirmado. ¿Qué producto o servicio quieres llevar a este mercado? Nos indica qué deben respaldar los servicios." |
| 3 | `Fabricamos alimentos secos empacados de larga vida útil, sobre todo botanas y cereales` | "Anotado. ¿Qué empresa o entidad operará en el destino? Basta con el nombre de la empresa o una descripción breve; puedes dejarlo pendiente." |
| 4 | `Vamos a constituir una empresa local en México` | "Entendido. ¿Cuándo te gustaría empezar? Basta con un mes y un año." |
| 5 | `Abril de 2027` | El My Service Map queda **por confirmar**: "Ya tengo lo necesario para armar tu My Service Map. Revísalo y, cuando estés de acuerdo, confírmalo." |

(The objective text appears in English in the Spanish run because the synthetic First Assessment is in English. It is data, not a translation gap.)

### D2. Confirm My Service Map (DOMAIN-A)

Click **Confirm** on My Service Map. Expected: an immutable dated snapshot is stored; the project's four service groups become cards in the Center, all **Not started**.

### D3. Logistics, process question first (F), then answers

Open the **Logistics** card. Expect: "Let's work on Logistics. I will ask one question at a time, and if you do not know something yet, we leave it as pending. Who will take care of the day-to-day logistics operation?" with four quick replies.

**Process questions (F), asked before answering.** They are answered from the Process Knowledge pack, write **nothing**, and the pending question is repeated.

| Id | Type (EN / ES) | Expect |
|---|---|---|
| P-01 | `What is a CRP and what happens with this?` / `¿Qué es un CRP y qué va a pasar con esto?` | Introduces "Category Requirement Pack (CRP)", says it is the category summary of what was captured and what is pending, with no documents, not a quote and not a promise of a provider; says pending items always stay visible; then "Back to where we left off. Who will take care of the day-to-day logistics operation?" (ES: "Retomamos donde nos quedamos.") |
| P-02 | `What role does the Sherpa play and when does it appear?` / `¿Qué papel juega el Sherpa y cuándo aparece?` | Explains the role in Operation Hub, says it begins after the first send and that nothing is assigned yet. Never "your Sherpa". Then the same question again. |

**Answers (English).** Run these after P-01 and P-02.

| # | Type | Expect (next question) |
|---|---|---|
| 1 | `Third-party logistics provider` | Do any of your shipments include hazardous or regulated materials? |
| 2 | `No` | Which logistics services do you need for this project? |
| 3 | `Third-party logistics and Freight transportation` | What main type of product will you be moving? |
| 4 | `General cargo` | Which country do the products leave from? (**origin**) |
| 5 | `Chile` | Which country do they arrive in? (**destination**) |
| 6 | `Mexico` | What product moves in this flow? |
| 7 | `Packaged dry food products` | What volume do you move in this flow? |
| 8 | `20 pallets` | How often is this shipment made? |
| 9 | `Monthly` | Which mode of transport will you use in this flow? |
| 10 | `Ocean` | Do you need dedicated warehousing for this project? |
| 11 | `No` | What is the status of your import or export licenses? |
| 12 | `Not sure yet` (button) | "That is fine, we leave it as pending; you do not need to make up an answer. I have the essential details to prepare the summary of this category: your CRP. You can review it, request changes or confirm it. Confirming it does not send it to Operation Hub." |

**Respuestas (Español).**

| # | Escribe | Esperado (siguiente pregunta) |
|---|---|---|
| 1 | `Proveedor logístico externo` | ¿Alguno de tus envíos incluye materiales peligrosos o regulados? |
| 2 | `No` | ¿Qué servicios de logística necesitas para este proyecto? |
| 3 | `Logística con terceros y Transporte de carga` | ¿Qué tipo de producto vas a mover principalmente? |
| 4 | `Carga general` | ¿Desde qué país salen los productos? (**origen**) |
| 5 | `Chile` | ¿A qué país llegan? (**destino**) |
| 6 | `México` | ¿Qué producto se mueve en este flujo? |
| 7 | `Alimentos secos empacados` | ¿Qué volumen mueves en este flujo? |
| 8 | `20 pallets` | ¿Con qué frecuencia se hace este envío? (se registra "20 pallets") |
| 9 | `Mensual` | ¿Qué modo de transporte usarás en este flujo? |
| 10 | `Marítimo` | ¿Necesitas almacenamiento dedicado para este proyecto? |
| 11 | `No` | ¿Cuál es el estado de tus licencias de importación o exportación? |
| 12 | `Todavía no lo sé` (botón) | "Está bien, lo dejamos como pendiente ... Ya tengo los datos esenciales para preparar el resumen de esta categoría: tu CRP ..." |

### E. State transitions across the route

| After | Category state | Notes |
|---|---|---|
| Map confirmed | Not started | Snapshot stored once. |
| First answer (D3 #1) | In progress | Facts are written append-only; progress is capture progress, not quality. |
| D3 #12 | Ready for review | The only pending item is the licensing status. The thread says it can be reviewed, changed or confirmed, and that confirming does **not** send. |
| Confirm CRP | Confirmed | One transaction: immutable pack, confirmation record, lifecycle change. Repeating Confirm returns the same pack. Nothing is sent. |
| Send | Sent | Only after acceptance **and** read-back. |

### F. Process-question examples

See D3 (P-01, P-02). Both are answered with zero model calls and never write a fact. Ask P-02 again after Section J: the answer changes because a first send has happened.

---

## G. My Service Map (final outline)

Shown as the confirmed, dated snapshot (also the "My Service Map" block of the Preview).

**Summary.** Objective: *Start selling our packaged food products in Mexico through local distributors*. Destination: Mexico. Time window: April 2027. Product or service: *Dry packaged food products with a long shelf life*.

| Group | Items (priority) |
|---|---|
| Corporate, Legal and Administrative | Set up a local company (medium) |
| Logistics | International freight (high) · Third-party logistics for shipments to Mexico (high) |
| International Trade and Customs | Support with import and customs procedures (high) |
| Strategic Advisory | Review whether the plan makes commercial sense (medium) |

All items are shown with their client-language reason. The seeded map (`--stage=map_confirmed`) is the guaranteed baseline. A map confirmed live in D2 is built by DOMAIN-A from the Understanding answers and the First Assessment needs; it should show the same four groups (verify on the integrated build).

## H. CRP (final outline) · Logistics

Title: **Logistics — Category Requirement Pack (CRP)**. State **Ready for review**, then **Confirmed** (read-only).

- **Context.** Destination: Mexico · Objective · Product or service · Time window.
- **Part 1 (confirmed, read-only text).** Services in scope: Third-party logistics and Freight transportation · Who will run day-to-day logistics: Third-party logistics provider · Primary product type: General cargo · Logistics flows: Origin country: Chile · Destination country: Mexico · Packaged dry food products · 20 pallets · Monthly · Ocean · Dedicated warehousing: No · Hazardous or regulated materials: No.
- **Part 2 / Pending Information (always visible, never inside prose).** Import/export licensing status (pending).
- **Information required later.** Empty.
- No documents, attachments or upload area (by design).

Buttons while "For your review": **Confirm** and **Request changes**. After Confirm: read-only, and **Start a new version** is offered (it is refused until the first send has succeeded; see N).

**Request changes** (optional, show once, only while the CRP is not yet confirmed): the category stays "For your review" (the content is complete and stays editable), a short notice is added to the thread and the conversation continues so answers can be corrected. After Confirm, a change is made with **Start a new version**: the category goes back to In progress and the confirmed pack stays the current one (and the one that was sent) until a new pack is confirmed.

## I. Preview

Open **Preview** from the Confirmed CRP. Four blocks, in this order:

1. **Your project:** Company, Objective, Destination, Time window, Product or service, Operating entity.
2. **My Service Map:** the confirmed snapshot (Section G).
3. **Logistics — Category Requirement Pack (CRP):** exactly the confirmed text (Section H).
4. **Context for execution:** empty in this route.

**What is not sent:** your conversation with Precision · names and contact details of people · documents or attachments · payment information · anything that does not appear in the blocks above.

The Preview is built by the same code as the handoff payload, so what is shown is what travels (identical checksum). It is the first send, so the first-send explanation is visible. If anything changes after opening the Preview, **Send** is refused with a "review the updated preview" message and the new Preview is shown.

**Say (EN).** "This is exactly what leaves Precision. Notice what is not sent."
**Di (ES).** "Esto es exactamente lo que sale de Precision. Fíjense en lo que no se envía."

## J. Send and what you see afterwards

Click **Send**. Expected:

- State **Sent**, no error. The Operation Hub area shows that access is **being prepared** (the simulator's default: provisioned, client not yet able to enter, no Sherpa assigned). No link, no Sherpa name, no "your Sherpa".
- Preview: **Send** is no longer available; the category shows **Sent**.
- Clicking Send twice quickly produces one delivery. If the answer is lost and the client retries, the same result comes back.
- Ask P-02 again (F): it now explains the role as starting after the first send, still without any assignment.

**Show a failure (optional, operator only).** With the simulator set to fail once, Send shows a short friendly message ("Your information is saved. Try again in a moment.") and **Try again** works; the second CRP stays blocked until the first send has succeeded. Never show raw errors.

**Show access arriving (optional, operator only).** Restart the simulator with `accessAfterFirstSend: "accessible_without_sherpa"` (link appears, no Sherpa) or `"accessible_with_sherpa"` (link and contact appear; the Sherpa is named only now).

## K. Optional second category · Strategic Advisory (English)

After J the first-send rule is satisfied, so a second send needs no special step. Open **Strategic Advisory**. Type, in order:

| # | Type |
|---|---|
| 1 | `Decide whether to commit to a local presence` |
| 2 | `Does the plan make commercial sense at our expected volumes?` |
| 3 | `Market` |
| 4 | `Retail and food-service distribution for packaged dry goods` |
| 5 | `Mexico` |
| 6 | `A clear recommendation we can take to our board` |
| 7 | `Whether to set up a local company this year` |
| 8 | `Feasibility report` |

Expect the same "summary of this category: your CRP" message. Confirm, then Preview (this time **not** the first send) and Send. One more delivery, one more event, no extra gate.

---

## L. Simulation boundary (read this before presenting)

1. **Operation Hub is a simulator.** It accepts and reads back the payload and can be told to fail, time out or return an access mode. It is not ClickUp and says nothing about the real platform's behaviour. Real activation needs the verification listed in the F5 plan.
2. **Entitlement is a fixture.** It answers "Premium active, FULL". The same rules apply to the real answer; read-only and revoked access are exercised by tests, not by this route.
3. **The model is scripted.** The same sentence always produces the same reading. This proves the pipeline (guard, verifiers, fact writes, readiness, idempotency), not the quality of a real model. The model gate (zero-data-retention or equivalent in writing) applies before any real client text reaches a provider; it does not apply to this synthetic route.
4. **The First Assessment context is synthetic** and client-safe by construction.
5. **No document upload exists** in Precision; the CRP never carries files.
6. **Internal use only.** Do not show this document, the seed command, the simulator controls or the word "simulated" to a client.

## M. Commands

| What | Command (from `backend/`) |
|---|---|
| Seed | `DATABASE_URL=... CONFIG_BOOTSTRAP_ENV=development npm run precision:seed-demo -- --stage=start --reset` |
| Rehearse the route (this document) | `TEST_DATABASE_URL=... npx jest -c jest.integration.config.js --runInBand route-rehearsal` |
| Seed tests | `TEST_DATABASE_URL=... npx jest -c jest.integration.config.js --runInBand seed.int` |
| CRP, Preview, Send tests | `TEST_DATABASE_URL=... npx jest -c jest.integration.config.js --runInBand crp-lifecycle crp-send` |
| SQL guards | `psql "$DATABASE_URL" -X -f db/tests/precision/run_precision_tests.sql` |

## N. Known gaps and how the route copes

| Id | Gap | Effect | Route handling |
|---|---|---|---|
| G-1 | Resolved. The scripted provider told the origin country from the destination country badly: the country named on the origin question was also written to the destination. | None now. | The provider reads lane cues ("from", "to", "leave from", "arrive in") and the field being asked, and fills only the matching end. `route-rehearsal.int.test.ts` plays the route in EN and ES without the demo script and checks "Origin country: Chile · Destination country: Mexico". `DEMO_SCRIPT_FIXTURE` is optional. |
| G-2 | Resolved for the route. The questions come from a reviewed bilingual copy bank (`conversation/copy/field-questions.ts`). Fields outside the bank use a neutral wrapper ("What can you tell me about this point: ...?"). | A manifest field added later reads more generic until it has a bank entry. | Add a bank entry (EN and ES) when a field is added. |
| G-3 | The Spanish run shows the English synthetic objective and product text. | Mixed-language lines in two CRP context rows. | Fixture data language, not a defect. |
| G-4 | Resolved. The time window reads "April 2027" (EN) and "abril de 2027" (ES) in the CRP and Preview. | None. | The first screen in the Spanish run may show the English synthetic objective (G-3). |
| G-5 | `Start a new version` is refused until the first send has succeeded. | Avoids a deadlock with the first-send rule. | Do not demo it before J. |
| G-6 | After `--reset` the app must restart to register the new project's fixtures. | A fresh project would show no First Assessment context. | Step 0.4. |
| G-7 | The licensing-status question is the single pending item by design. | It is what makes Pending Information visible. | None. |
