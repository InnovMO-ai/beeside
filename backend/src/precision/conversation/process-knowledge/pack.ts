/**
 * Process Knowledge pack (Build Readiness §L): versioned, structured product knowledge used to answer process
 * questions without sending the client to the Help Center and without inventing behaviour.
 *
 *  - Each topic keeps atomic `facts` (with a `source_ref` to a frozen document/decision) and the brief answer
 *    (≤ 3 sentences, ≤ ~60 words, no question inside) derived from them.
 *  - `state_variants` pick the sentences that apply to the project state (CRP state, first send done, delivery
 *    state, Sherpa assigned, map confirmed, surface).
 *  - `{crp}` expands to "Category Requirement Pack (CRP)" the first time and to "CRP" afterwards.
 *  - `{reason}` is the manifest's own help text for the field being asked (approved content); the sentence is
 *    dropped when none exists.
 *  - Facts are derived only from frozen rules; PO approval of the facts is a content dependency (status "draft"
 *    is served; "blocked" is never served and answered with the honest "can't confirm" copy).
 */
import type { Locale, StateFlags, Surface } from "../types";

export const PACK_VERSION = "pk-2026-10-12.1";

export type TopicStatus = "approved" | "draft" | "blocked";
export type ProcessFlags = StateFlags & { surface: Surface };

export interface PackFact { factId: string; text: string; sourceRef: string }
export interface LocalizedSentences { en: string[]; es: string[] }
export interface PackVariant { when: Partial<ProcessFlags>; sentences: LocalizedSentences; factIds: string[] }

export interface PackTopic {
  topicKey: string;
  status: TopicStatus;
  blockedBy?: string;
  facts: PackFact[];
  sentences: LocalizedSentences;
  factIds: string[];
  variants: PackVariant[];
  /** Regexes (source strings, case-insensitive) the final answer must never match. */
  mustNotSay: string[];
  /** Term ids used by the topic (term registry). */
  terms: string[];
  resumeHint: string;
}

const NO_PROMISE = "garantiz|guarantee|en \\d+ (horas|dias|días)|within \\d+ (hours|days)";
const NO_PROVIDER = "proveedor (asignado|seleccionado)|assigned provider|selected provider";

const F = (factId: string, text: string, sourceRef: string): PackFact => ({ factId, text, sourceRef });

export const PROCESS_TOPICS: readonly PackTopic[] = [
  {
    topicKey: "precision_center",
    status: "approved",
    facts: [
      F("pc-1", "Precision Center is the client space where what was told in Discovery becomes a map of services and the requirements for each.", "Voice Pack §2 glossary; intro_once"),
      F("pc-2", "The client decides when to continue and when to pause; there is no paused state.", "Voice Pack intro_once; pause_note"),
    ],
    sentences: {
      es: ["Precision Center es tu espacio para convertir lo que ya nos contaste en tu My Service Map y en los requisitos de cada servicio.", "Avanzas a tu ritmo y puedes pausar cuando quieras."],
      en: ["Precision Center is your space to turn what you already told us into your My Service Map and the requirements for each service.", "You move at your own pace and can pause whenever you like."],
    },
    factIds: ["pc-1", "pc-2"],
    variants: [],
    mustNotSay: [NO_PROMISE],
    terms: ["precision_center"],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "precision_understanding",
    status: "approved",
    facts: [
      F("pu-1", "Precision Understanding is a conversation to understand the whole project.", "Voice Pack intro_once; Build Readiness A-3"),
      F("pu-2", "Precision Understanding shows no percentage; the client decides when to continue or pause.", "Build Readiness A-3 (V2.0 rule); UND-06"),
      F("pu-3", "What the client says there is what builds My Service Map.", "Build Readiness A-4"),
    ],
    sentences: {
      es: ["Precision Understanding es una conversación para entender tu proyecto completo.", "No muestra porcentajes, y tú decides cuándo seguir y cuándo pausar.", "Lo que me cuentes es lo que arma tu My Service Map."],
      en: ["Precision Understanding is a conversation to understand your whole project.", "It shows no percentages, and you decide when to continue and when to pause.", "What you tell me is what builds your My Service Map."],
    },
    factIds: ["pu-1", "pu-2", "pu-3"],
    variants: [],
    mustNotSay: [NO_PROMISE],
    terms: ["precision_understanding", "my_service_map"],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "my_service_map",
    status: "approved",
    facts: [
      F("msm-1", "My Service Map is an executive summary of the services the project needs.", "Voice Pack §2 glossary; Build Readiness A-4"),
      F("msm-2", "While it is being prepared it follows what the client says; once confirmed a dated version is kept and not edited; version numbers are not shown.", "Build Readiness A-4/A-5"),
    ],
    sentences: {
      es: ["My Service Map es un resumen de los servicios que necesita tu proyecto.", "Mientras lo preparas se actualiza con lo que cuentas; al confirmarlo queda una versión fechada que ya no se edita."],
      en: ["My Service Map is a summary of the services your project needs.", "While you prepare it, it updates with what you tell me; once you confirm it, a dated version is kept and no longer edited."],
    },
    factIds: ["msm-1", "msm-2"],
    variants: [],
    mustNotSay: [NO_PROMISE],
    terms: ["my_service_map"],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "my_service_map_confirmation",
    status: "approved",
    facts: [
      F("msc-1", "Confirming My Service Map creates an immutable dated snapshot.", "Build Readiness A-5; MAP-01"),
      F("msc-2", "Confirming My Service Map does not activate or send anything to Operation Hub.", "Build Readiness E-1; Design handoff §4"),
      F("msc-3", "A later important change creates a new version and keeps the previous one.", "Voice Pack psm_immutable_note"),
    ],
    sentences: {
      es: ["Al confirmar tu My Service Map queda guardada una versión fechada que no se modifica.", "Confirmarlo no activa Operation Hub ni envía nada.", "Si después cambia algo importante, se crea una versión nueva y se conserva la anterior."],
      en: ["When you confirm your My Service Map, a dated version is saved and never modified.", "Confirming it does not activate Operation Hub or send anything.", "If something important changes later, a new version is created and the previous one is kept."],
    },
    factIds: ["msc-1", "msc-2", "msc-3"],
    variants: [],
    mustNotSay: [NO_PROMISE],
    terms: ["my_service_map", "operation_hub"],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "precision_by_category",
    status: "approved",
    facts: [
      F("pbc-1", "Precision by Category is the conversation for each category confirmed in My Service Map.", "Voice Pack §2 glossary"),
      F("pbc-2", "Progress measures how much has been captured, never the quality of the project.", "Voice Pack principle 7; Build Readiness C-1"),
    ],
    sentences: {
      es: ["Precision by Category es la conversación de cada categoría que confirmaste en tu My Service Map.", "El avance que ves mide cuánto hemos capturado, no la calidad de tu proyecto."],
      en: ["Precision by Category is the conversation for each category you confirmed in your My Service Map.", "The progress you see measures how much we have captured, not the quality of your project."],
    },
    factIds: ["pbc-1", "pbc-2"],
    variants: [],
    mustNotSay: [NO_PROMISE],
    terms: ["precision_by_category", "my_service_map"],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "category_requirement_pack",
    status: "approved",
    facts: [
      F("crp-1", "A Category Requirement Pack (CRP) is the final summary of a category: what was captured and what is pending.", "Master contract; Build Readiness A-10"),
      F("crp-2", "A CRP includes no documents and is neither a quote nor a promise of a provider.", "Build Readiness D-7; Voice Pack glossary"),
      F("crp-3", "The client reviews the CRP before confirming it.", "Build Readiness E-1"),
    ],
    sentences: {
      es: ["Un {crp} es el resumen final de una categoría: reúne lo que capturamos y lo que queda pendiente.", "No incluye documentos, y no es una cotización ni una promesa de proveedor.", "Tú lo revisas antes de confirmarlo."],
      en: ["A {crp} is the final summary of a category: it gathers what we captured and what is still pending.", "It includes no documents, and it is neither a quote nor a promise of a provider.", "You review it before confirming it."],
    },
    factIds: ["crp-1", "crp-2", "crp-3"],
    variants: [],
    mustNotSay: [NO_PROMISE, NO_PROVIDER],
    terms: ["crp"],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "crp_confirmation",
    status: "approved",
    facts: [
      F("cc-1", "When the essential information is captured (readiness, not a fixed 100 %), the CRP can be reviewed; the client can request changes or confirm.", "Build Readiness A-9/C-4"),
      F("cc-2", "A confirmed CRP is read-only; confirming does not send it to Operation Hub.", "Build Readiness A-10/E-1"),
      F("cc-3", "After confirmation a change is a new version started by the client; the previous one is kept.", "Build Readiness A-10b"),
    ],
    sentences: {
      es: ["Cuando están los datos esenciales, el {crp} queda disponible para que lo revises.", "Puedes pedir cambios o confirmarlo; una vez confirmado queda en solo lectura.", "Confirmarlo no lo envía a Operation Hub."],
      en: ["Once the essential details are captured, the {crp} is available for you to review.", "You can request changes or confirm it; once confirmed it becomes read-only.", "Confirming it does not send it to Operation Hub."],
    },
    factIds: ["cc-1", "cc-2"],
    variants: [
      {
        when: { crpState: "confirmed" },
        sentences: {
          es: ["Tu {crp} ya está confirmado y queda en solo lectura.", "Confirmarlo no lo envía a Operation Hub; el envío es una acción aparte.", "Si necesitas cambiar algo, inicias una versión nueva y se conserva la anterior."],
          en: ["Your {crp} is already confirmed and is read-only.", "Confirming it does not send it to Operation Hub; sending is a separate action.", "If you need to change something, you start a new version and the previous one is kept."],
        },
        factIds: ["cc-2", "cc-3"],
      },
    ],
    mustNotSay: [NO_PROMISE],
    terms: ["crp", "operation_hub"],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "preview_before_send",
    status: "approved",
    facts: [
      F("pbs-1", "Before sending, the client sees exactly what would be sent (same builder as the send).", "Build Readiness A-11/E-4"),
      F("pbs-2", "If something changed between preview and send, a new preview is generated; nothing leaves Precision until the client sends.", "Build Readiness E-4 (PREVIEW_STALE)"),
    ],
    sentences: {
      es: ["Antes de enviar ves exactamente lo que se enviaría a Operation Hub.", "Si algo cambia entre la vista previa y el envío, se prepara una vista previa nueva.", "Nada sale de Precision hasta que tú lo envías."],
      en: ["Before sending, you see exactly what would be sent to Operation Hub.", "If something changes between the preview and the send, a new preview is prepared.", "Nothing leaves Precision until you send it."],
    },
    factIds: ["pbs-1", "pbs-2"],
    variants: [],
    mustNotSay: [NO_PROMISE],
    terms: ["operation_hub"],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "send_to_operation_hub",
    status: "approved",
    facts: [
      F("sto-1", "Only an explicit send delivers anything to Operation Hub: confirmed My Service Map, confirmed CRP and permitted project context.", "Build Readiness E-3/E-5"),
      F("sto-2", "Conversations, documents, e-mail and names of people are never sent.", "Build Readiness E-3 deny list"),
      F("sto-3", "The first send activates Operation Hub; later sends go to the same project.", "Build Readiness E-7"),
    ],
    sentences: {
      es: ["Solo un envío explícito entrega algo a Operation Hub: tu My Service Map confirmado, el {crp} confirmado y el contexto permitido del proyecto.", "No se envían conversaciones, documentos ni nombres de personas.", "El primer envío activa Operation Hub."],
      en: ["Only an explicit send delivers anything to Operation Hub: your confirmed My Service Map, the confirmed {crp} and the permitted project context.", "Conversations, documents and names of people are not sent.", "The first send activates Operation Hub."],
    },
    factIds: ["sto-1", "sto-2", "sto-3"],
    variants: [
      {
        when: { firstSendDone: true },
        sentences: {
          es: ["Solo un envío explícito entrega algo a Operation Hub: tu My Service Map confirmado, el {crp} confirmado y el contexto permitido del proyecto.", "No se envían conversaciones, documentos ni nombres de personas.", "Operation Hub ya está activo para tu proyecto, así que los siguientes envíos van al mismo proyecto."],
          en: ["Only an explicit send delivers anything to Operation Hub: your confirmed My Service Map, the confirmed {crp} and the permitted project context.", "Conversations, documents and names of people are not sent.", "Operation Hub is already active for your project, so later sends go to the same project."],
        },
        factIds: ["sto-1", "sto-2", "sto-3"],
      },
    ],
    mustNotSay: [NO_PROMISE],
    terms: ["operation_hub", "my_service_map", "crp"],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "confirmed_vs_sent",
    status: "approved",
    facts: [
      F("cvs-1", "Confirmed is not sent: confirmed means the client reviewed and accepted the content.", "Build Readiness E-1"),
      F("cvs-2", "Sent is shown only when Operation Hub accepted and the read-back matched.", "Build Readiness E-4"),
    ],
    sentences: {
      es: ["Confirmado y enviado son cosas distintas.", "Confirmado significa que revisaste y aceptaste el contenido; enviado, que Operation Hub lo recibió y lo verificó.", "Hasta ese momento no aparece como enviado."],
      en: ["Confirmed and sent are different things.", "Confirmed means you reviewed and accepted the content; sent means Operation Hub received it and verified it.", "Until then it does not appear as sent."],
    },
    factIds: ["cvs-1", "cvs-2"],
    variants: [
      {
        when: { ohDeliveryState: "sending" },
        sentences: {
          es: ["Confirmado y enviado son cosas distintas.", "El envío está en curso y todavía no aparece como enviado.", "Aparecerá como enviado cuando Operation Hub lo reciba y lo verifique."],
          en: ["Confirmed and sent are different things.", "The send is in progress and does not appear as sent yet.", "It will appear as sent when Operation Hub receives and verifies it."],
        },
        factIds: ["cvs-1", "cvs-2"],
      },
      {
        when: { ohDeliveryState: "failed" },
        sentences: {
          es: ["Confirmado y enviado son cosas distintas.", "El último envío no se completó, así que no aparece como enviado.", "Tu contenido sigue guardado y puedes intentar el envío de nuevo."],
          en: ["Confirmed and sent are different things.", "The last send did not complete, so it does not appear as sent.", "Your content is still saved and you can try sending again."],
        },
        factIds: ["cvs-1", "cvs-2"],
      },
      {
        when: { ohDeliveryState: "sent" },
        sentences: {
          es: ["Confirmado y enviado son cosas distintas.", "Tu envío ya fue recibido y verificado por Operation Hub, por eso aparece como enviado."],
          en: ["Confirmed and sent are different things.", "Your send was received and verified by Operation Hub, which is why it appears as sent."],
        },
        factIds: ["cvs-1", "cvs-2"],
      },
    ],
    mustNotSay: [NO_PROMISE],
    terms: ["operation_hub"],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "add_a_service",
    status: "approved",
    facts: [
      F("aas-1", "Add a Service is available once My Service Map is confirmed; before that, needs are included in the initial map.", "Voice Pack add_service_not_available_yet; Build Readiness A-14"),
      F("aas-2", "It is a conversation: the client confirms the need, not the taxonomy; a need that is not mapped is not out of scope.", "Voice Guide principle 8; add_service_confirm_need"),
    ],
    sentences: {
      es: ["Add a Service está disponible cuando confirmas tu My Service Map.", "Es una conversación en la que me cuentas qué necesitas y tú confirmas esa necesidad; no eliges categorías.", "Si la necesidad no está en tu My Service Map, igual la entiendo y la capturo con el detalle suficiente."],
      en: ["Add a Service is available once you confirm your My Service Map.", "It is a conversation where you tell me what you need and you confirm that need; you do not pick categories.", "If the need is not in your My Service Map, I still understand it and capture it with enough detail."],
    },
    factIds: ["aas-1", "aas-2"],
    variants: [
      {
        when: { serviceMapConfirmed: false },
        sentences: {
          es: ["Todavía no está disponible: se habilita cuando confirmas tu My Service Map.", "Mientras tanto, cuéntame lo que necesitas y lo incluyo en tu My Service Map."],
          en: ["It is not available yet: it is enabled once you confirm your My Service Map.", "In the meantime, tell me what you need and I include it in your My Service Map."],
        },
        factIds: ["aas-1"],
      },
    ],
    mustNotSay: [NO_PROMISE, "fuera de alcance|out of scope"],
    terms: ["add_a_service", "my_service_map"],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "pending_information",
    status: "approved",
    facts: [
      F("pi-1", "If the client does not know something it is left as pending; no one needs to invent an answer.", "Voice Pack pending_accept"),
      F("pi-2", "Pending information is always visible in the summary and never hidden in prose.", "Voice Pack crp_pending_section_title"),
      F("pi-3", "Pending does not block by itself unless the item is critical (blocking); readiness is separate from progress.", "Build Readiness C-4 (closure B2)"),
    ],
    sentences: {
      es: ["Si no sabes un dato, lo dejamos como pendiente; no necesitas inventar una respuesta.", "Los pendientes quedan siempre visibles en el resumen.", "Un pendiente no bloquea por sí mismo, salvo que sea un punto crítico."],
      en: ["If you do not know something, we leave it as pending; you do not need to make up an answer.", "Pending items always stay visible in the summary.", "A pending item does not block by itself, unless it is a critical point."],
    },
    factIds: ["pi-1", "pi-2", "pi-3"],
    variants: [],
    mustNotSay: [NO_PROMISE],
    terms: [],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "pause_and_resume",
    status: "approved",
    facts: [
      F("pr-1", "The client decides when to continue and when to pause; there is no paused state.", "Voice Pack intro_once; pause_note"),
      F("pr-2", "What the client answers is saved as part of the project.", "Build Readiness L-7"),
    ],
    sentences: {
      es: ["Sí, tú decides cuándo seguir y cuándo pausar.", "Lo que ya respondiste queda guardado en tu proyecto, así que puedes retomar después."],
      en: ["Yes, you decide when to continue and when to pause.", "What you have already answered is saved in your project, so you can pick it up again later."],
    },
    factIds: ["pr-1", "pr-2"],
    variants: [],
    mustNotSay: [NO_PROMISE],
    terms: [],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "documents_boundary",
    status: "approved",
    facts: [
      F("db-1", "Precision neither asks for nor stores documents; there is no upload.", "Track A contract §0; Build Readiness E-3"),
      F("db-2", "If a service later needs evidence, beeside or the provider will say so; documents are handled in Operation Hub.", "Voice Pack ccir_why_later_evidence; welcome_oh_body"),
    ],
    sentences: {
      es: ["Precision no pide ni guarda documentos.", "Si un servicio requiere evidencia más adelante, beeside o el proveedor te lo indicará.", "Los documentos se gestionan después en Operation Hub."],
      en: ["Precision neither asks for nor stores documents.", "If a service later requires evidence, beeside or the provider will let you know.", "Documents are handled afterwards in Operation Hub."],
    },
    factIds: ["db-1", "db-2"],
    variants: [],
    mustNotSay: [NO_PROMISE],
    terms: ["operation_hub"],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "operation_hub_boundary",
    status: "approved",
    facts: [
      F("ohb-1", "Operation Hub is where the project is executed and coordinated; it is not part of Precision.", "Voice Pack glossary; OH contract"),
      F("ohb-2", "It is activated by the first send; the link appears per decision D-8, with a pending-access notice while the client cannot enter yet.", "Build Readiness E-7, D-8"),
    ],
    sentences: {
      es: ["Operation Hub es donde se ejecuta y se coordina tu proyecto; no forma parte de Precision.", "Se activa con tu primer envío.", "Cuando tengas acceso, lo verás en tu Precision Center."],
      en: ["Operation Hub is where your project is executed and coordinated; it is not part of Precision.", "It is activated by your first send.", "When you have access, you will see it in your Precision Center."],
    },
    factIds: ["ohb-1", "ohb-2"],
    variants: [
      {
        when: { firstSendDone: true },
        sentences: {
          es: ["Operation Hub es donde se ejecuta y se coordina tu proyecto; no forma parte de Precision.", "Tu primer envío ya lo activó.", "Si tu acceso aún no está disponible, verás un aviso de acceso pendiente."],
          en: ["Operation Hub is where your project is executed and coordinated; it is not part of Precision.", "Your first send already activated it.", "If your access is not available yet, you will see a pending-access notice."],
        },
        factIds: ["ohb-1", "ohb-2"],
      },
    ],
    mustNotSay: [NO_PROMISE],
    terms: ["operation_hub", "precision_center"],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "sherpa_role",
    status: "approved",
    facts: [
      F("sh-1", "A Sherpa is the beeside person who coordinates execution of a project in Operation Hub.", "Voice Guide v1.1 (D-10); Voice Pack glossary"),
      F("sh-2", "The role appears when the project moves to Operation Hub, after the first send; before a real assignment nothing is assigned or implied.", "Build Readiness L-6"),
      F("sh-3", "The Sherpa never edits Precision; clarifications are requested from Operation Hub.", "Build Readiness A-10b (B3)"),
    ],
    sentences: {
      es: ["Un Sherpa es la persona de beeside que coordina la ejecución de un proyecto en Operation Hub.", "Ese rol participa cuando el proyecto pasa a Operation Hub, después del primer envío.", "Por ahora no hay ninguna asignación que pueda confirmarte."],
      en: ["A Sherpa is the beeside person who coordinates the execution of a project in Operation Hub.", "That role takes part once the project moves to Operation Hub, after the first send.", "For now there is no assignment that I can confirm to you."],
    },
    factIds: ["sh-1", "sh-2"],
    variants: [
      {
        when: { sherpaAssigned: true },
        sentences: {
          es: ["Un Sherpa es la persona de beeside que coordina la ejecución de tu proyecto en Operation Hub.", "Tu Sherpa trabaja desde Operation Hub, no dentro de Precision, y no edita lo que confirmaste.", "Si necesita una aclaración, te la pide desde Operation Hub."],
          en: ["A Sherpa is the beeside person who coordinates the execution of your project in Operation Hub.", "Your Sherpa works from Operation Hub, not inside Precision, and does not edit what you confirmed.", "If clarification is needed, it is requested from Operation Hub."],
        },
        factIds: ["sh-1", "sh-3"],
      },
    ],
    mustNotSay: [NO_PROMISE],
    terms: ["sherpa", "operation_hub"],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "general_help",
    status: "approved",
    facts: [
      F("gh-1", "General help is always visible: Help and frequently asked questions, and Contact beeside.", "Voice Pack help_general; Build Readiness E-7"),
      F("gh-2", "Asking for help does not activate Operation Hub or change the project state; no response time is promised.", "Voice Pack help_general, help_request_sent"),
    ],
    sentences: {
      es: ["Siempre tienes a la vista la ayuda general: Ayuda y preguntas frecuentes, y Contactar a beeside.", "Pedir ayuda no activa Operation Hub ni cambia el estado de tu proyecto.", "Si escribes a beeside, no puedo prometerte un plazo de respuesta."],
      en: ["General help is always in view: Help and frequently asked questions, and Contact beeside.", "Asking for help does not activate Operation Hub or change the state of your project.", "If you write to beeside, I cannot promise you a response time."],
    },
    factIds: ["gh-1", "gh-2"],
    variants: [],
    mustNotSay: [NO_PROMISE],
    terms: ["operation_hub"],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "changes_reopen_versioning",
    status: "approved",
    facts: [
      F("crv-1", "Before Confirm the client can request changes freely.", "Build Readiness A-10b (1)"),
      F("crv-2", "After Confirm the version is immutable; a change is a new version started and confirmed by the client; the previous one is kept.", "Build Readiness A-10b (2)(3)"),
      F("crv-3", "The beeside team may ask for clarification from Operation Hub but never edits Precision.", "Build Readiness A-10b (5)"),
    ],
    sentences: {
      es: ["Mientras no confirmes, puedes cambiar tus respuestas cuantas veces quieras.", "Al confirmar, esa versión ya no se edita; si algo cambia, inicias una versión nueva y la anterior se conserva.", "El equipo de beeside puede pedirte aclaraciones, pero no edita nada en Precision."],
      en: ["Until you confirm, you can change your answers as often as you like.", "After you confirm, that version is no longer edited; if something changes, you start a new version and the previous one is kept.", "The beeside team may ask you for clarifications, but it does not edit anything in Precision."],
    },
    factIds: ["crv-1", "crv-2", "crv-3"],
    variants: [],
    mustNotSay: [NO_PROMISE, "reabr|reopen"],
    terms: [],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "ai_use",
    status: "approved",
    facts: [
      F("ai-1", "Precision uses artificial intelligence to help structure the project; the client can correct anything at any time.", "Decision D-11 (approved copy)"),
      F("ai-2", "Progress, readiness and what is confirmed are computed by fixed rules, not by the model.", "Track A contract §4"),
    ],
    sentences: {
      es: ["Precision usa inteligencia artificial para ayudarte a estructurar tu proyecto.", "Si algo de lo que entiende no es correcto, puedes corregirlo en cualquier momento.", "El avance y lo que queda confirmado se calculan con reglas fijas, no con inteligencia artificial."],
      en: ["Precision uses artificial intelligence to help structure your project.", "If anything it understands is not correct, you can correct it at any time.", "Progress and what is confirmed are calculated with fixed rules, not with artificial intelligence."],
    },
    factIds: ["ai-1", "ai-2"],
    variants: [],
    mustNotSay: [NO_PROMISE],
    terms: [],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "requirement_destiny",
    status: "approved",
    facts: [
      F("rd-1", "What the client answers is saved as part of the project and feeds the CRP of the category (or My Service Map in Precision Understanding).", "Build Readiness L-7"),
      F("rd-2", "If it stays pending it is always visible; nothing goes to Operation Hub until the client sends explicitly; confirming does not send.", "Build Readiness L-7, E-1"),
    ],
    sentences: {
      es: ["Lo que respondes se guarda como parte de tu proyecto y alimenta el {crp} de esta categoría.", "Si queda como pendiente, se mantiene siempre visible en el resumen.", "Confirmar el {crp} no lo envía: solo un envío explícito lo lleva a Operation Hub."],
      en: ["What you answer is saved as part of your project and feeds the {crp} of this category.", "If it stays pending, it always stays visible in the summary.", "Confirming the {crp} does not send it: only an explicit send takes it to Operation Hub."],
    },
    factIds: ["rd-1", "rd-2"],
    variants: [
      {
        when: { surface: "understanding" },
        sentences: {
          es: ["Lo que respondes se guarda como parte de tu proyecto y alimenta tu My Service Map.", "Si queda como pendiente, se mantiene siempre visible.", "Nada se envía a Operation Hub hasta que tú lo envías de forma explícita."],
          en: ["What you answer is saved as part of your project and feeds your My Service Map.", "If it stays pending, it always stays visible.", "Nothing is sent to Operation Hub until you send it explicitly."],
        },
        factIds: ["rd-1", "rd-2"],
      },
      {
        when: { surface: "add_service" },
        sentences: {
          es: ["Lo que me cuentas se guarda como una necesidad de tu proyecto, y tú la confirmas antes de que se agregue.", "Al agregarla se actualiza tu My Service Map y se conserva la versión anterior.", "Nada se envía a Operation Hub hasta que tú lo envías de forma explícita."],
          en: ["What you tell me is saved as a need of your project, and you confirm it before it is added.", "When it is added, your My Service Map is updated and the previous version is kept.", "Nothing is sent to Operation Hub until you send it explicitly."],
        },
        factIds: ["rd-1", "rd-2"],
      },
    ],
    mustNotSay: [NO_PROMISE, NO_PROVIDER],
    terms: ["crp", "my_service_map", "operation_hub"],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "why_this_question",
    status: "approved",
    facts: [
      F("wq-1", "Questions exist to define the part of the project being captured; unknowns are accepted as pending.", "Voice Guide principles 2 and 4; pending_accept"),
      F("wq-2", "The reason shown comes from the manifest's help text for the field, when it has one.", "Build Readiness C (manifest help_text)"),
    ],
    sentences: {
      es: ["Te pregunto esto para dejar bien definida esta parte de tu proyecto.", "{reason}", "Si todavía no lo sabes, dímelo y lo dejamos como pendiente."],
      en: ["I am asking this to define this part of your project well.", "{reason}", "If you do not know it yet, tell me and we leave it as pending."],
    },
    factIds: ["wq-1", "wq-2"],
    variants: [],
    mustNotSay: [NO_PROMISE],
    terms: [],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "privacy_confidentiality",
    status: "approved",
    facts: [
      F("pv-1", "Project information is used to structure the client's expansion and is shared only when it is needed to move into execution.", "PO closure decision 12 Oct 2026 (Confidentiality answer)"),
      F("pv-2", "Precision does not send conversation history, email, people's names or documents to Operation Hub.", "PO closure decision 12 Oct 2026; Integration contract §payload exclusions"),
      F("pv-3", "Before sending a Category Requirement Pack (CRP) the client can review exactly what information will be shared.", "PO closure decision 12 Oct 2026; Preview before Send"),
    ],
    sentences: {
      es: [
        "La información de tu proyecto se utiliza para estructurar tu expansión y se comparte únicamente cuando corresponde avanzar la ejecución.",
        "Precision no envía a Operation Hub el historial de conversación, correo, nombres de personas ni documentos; antes de enviar un {crp}, puedes revisar exactamente qué información se compartirá.",
      ],
      en: [
        "Your project information is used to structure your expansion and is only shared when it is needed to move into execution.",
        "Precision does not send conversation history, email, people's names or documents to Operation Hub; before sending a {crp}, you can review exactly what information will be shared.",
      ],
    },
    factIds: ["pv-1", "pv-2", "pv-3"],
    variants: [],
    mustNotSay: [NO_PROMISE, "cifrad|encrypt|iso ?27001|soc ?2|gdpr|lgpd|ley federal|nunca se compart|never shared|100%"],
    terms: ["operation_hub"],
    resumeHint: "Return to the pending question.",
  },
  {
    topicKey: "contact_timing",
    status: "approved",
    facts: [
      F("ct-1", "No response or contact time is promised anywhere in Precision.", "Voice Pack help_request_sent; Track A contract §0"),
      F("ct-2", "After the first send the work with beeside continues in Operation Hub.", "Build Readiness E-7"),
    ],
    sentences: {
      es: ["No puedo darte un plazo de contacto ni de respuesta.", "Lo que sí puedo decirte es que, después de tu primer envío, el trabajo continúa en Operation Hub.", "Mientras tanto, puedes escribir a beeside desde Contactar a beeside."],
      en: ["I cannot give you a contact or response time.", "What I can tell you is that, after your first send, the work continues in Operation Hub.", "In the meantime, you can write to beeside through Contact beeside."],
    },
    factIds: ["ct-1", "ct-2"],
    variants: [],
    mustNotSay: [],
    terms: ["operation_hub"],
    resumeHint: "Return to the pending question.",
  },
];

const BY_KEY: ReadonlyMap<string, PackTopic> = new Map(PROCESS_TOPICS.map((t) => [t.topicKey, t]));

export function getTopic(topicKey: string): PackTopic | undefined {
  return BY_KEY.get(topicKey);
}

export function topicsSummaryForRouting(locale: Locale): { topicKey: string; hint: string }[] {
  return PROCESS_TOPICS.filter((t) => t.status !== "blocked").map((t) => ({ topicKey: t.topicKey, hint: t.sentences[locale][0] ?? t.topicKey }));
}
