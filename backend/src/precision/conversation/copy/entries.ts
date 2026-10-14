/**
 * Fixed customer-facing copy with stable `copy_key`s (Voice Pack F2 inventory, Voice Guide v1.1, Build Readiness
 * closure of 9 Oct). Rules applied here:
 *
 *  - Keys superseded by decision D-9 (Build Readiness §N-2) are NOT built; see SUPERSEDED_COPY_KEYS.
 *  - Canonical names only (My Service Map, Precision Understanding, ...); the first mention of the Category
 *    Requirement Pack is produced by the `{crp}` token (full name + "(CRP)" once, "CRP" afterwards).
 *  - No Sherpa, no quality judgments, no "listo/lista", no exclamation marks, no emoji, no placeholders in output.
 *  - `status`: "approved" = exact PO-approved wording; "draft" = wording from the Voice Pack or authored here,
 *    pending the page-by-page copy approval (content dependency C in Build Readiness §O-2).
 *
 * Parameters use `{name}`; every parameter must be supplied (the accessor throws otherwise).
 */

export interface CopyEntry {
  key: string;
  es: string;
  en: string;
  status: "approved" | "draft";
  source: string;
}

const VP = "Voice Pack F2 §3";
const NEW = "Authored for F5 (Build Readiness §L/§M)";

export const COPY_ENTRIES: readonly CopyEntry[] = [
  // ---- AI disclosure and openings
  {
    key: "ai_disclosure_once",
    es: "Precision usa inteligencia artificial para ayudarte a estructurar tu proyecto. Si algo de lo que entiende no es correcto, puedes corregirlo en cualquier momento.",
    en: "Precision uses artificial intelligence to help structure your project. If anything it understands is not correct, you can correct it at any time.",
    status: "approved",
    source: "Decision D-11 (Build Readiness §M-1)",
  },
  {
    key: "understanding_welcome",
    es: "Empecemos con Precision Understanding: una conversación para entender tu proyecto completo. Tú decides cuándo seguir y cuándo pausar.",
    en: "Let's start with Precision Understanding: a conversation to understand your whole project. You decide when to continue and when to pause.",
    status: "draft",
    source: `${VP} intro_once (split) + ${NEW}`,
  },
  {
    key: "category_intro",
    es: "Vamos con {category}. Te haré una pregunta a la vez, y si algo aún no lo sabes, lo dejamos como pendiente.",
    en: "Let's work on {category}. I will ask one question at a time, and if you do not know something yet, we leave it as pending.",
    status: "draft",
    source: NEW,
  },
  {
    key: "fa_prefill_confirm",
    es: "Con lo que me contaste en Discovery, entiendo esto: {value}. ¿Sigue siendo así?",
    en: "From what you told me in Discovery, I understand this: {value}. Is that still the case?",
    status: "draft",
    source: `${VP} fa_prefill_confirm`,
  },
  {
    key: "confirm_candidate",
    es: "Entendí lo siguiente: {value}. ¿Es correcto?",
    en: "I understood the following: {value}. Is that correct?",
    status: "draft",
    source: NEW,
  },
  {
    key: "ask_correction",
    es: "De acuerdo. ¿Cuál es el dato correcto?",
    en: "Thanks for flagging it. What is the correct value?",
    status: "draft",
    source: NEW,
  },
  // ---- review / completion statements (no questions)
  {
    key: "understanding_review_ready",
    es: "Ya tengo lo necesario para armar tu My Service Map. Revísalo y, cuando estés de acuerdo, confírmalo.",
    en: "I have what I need to put together your My Service Map. Review it and, when you agree, confirm it.",
    status: "draft",
    source: `${VP} psm_confirm_intro (adapted)`,
  },
  {
    key: "category_review_ready",
    es: "Ya tengo los datos esenciales para preparar el resumen de esta categoría: tu {crp}. Puedes revisarlo, pedir cambios o confirmarlo. Confirmarlo no lo envía a Operation Hub.",
    en: "I have the essential details to prepare the summary of this category: your {crp}. You can review it, request changes or confirm it. Confirming it does not send it to Operation Hub.",
    status: "draft",
    source: `${NEW}; replaces superseded crp_completed (D-9)`,
  },
  {
    key: "category_critical_pending",
    es: "Aún hay puntos críticos sin responder, así que todavía no puedo preparar el resumen de esta categoría. Cuando tengas esa información, cuéntamela y la retomamos.",
    en: "Some critical points are still unanswered, so I cannot prepare the summary of this category yet. When you have that information, tell me and we pick it up again.",
    status: "draft",
    source: NEW,
  },
  {
    key: "understanding_critical_pending",
    es: "Aún hay puntos importantes sin responder, así que todavía no puedo armar tu My Service Map. Cuando tengas esa información, cuéntamela y seguimos.",
    en: "Some important points are still unanswered, so I cannot put together your My Service Map yet. When you have that information, tell me and we continue.",
    status: "draft",
    source: NEW,
  },
  {
    key: "fallback_question_generic",
    es: "¿Qué más puedes contarme sobre esto?",
    en: "What else can you tell me about this?",
    status: "draft",
    source: "Track A contract §4 (last-resort neutral question)",
  },
  // ---- pending information
  {
    key: "pending_accept",
    es: "Está bien, lo dejamos como pendiente; no necesitas inventar una respuesta.",
    en: "That is fine, we leave it as pending; you do not need to make up an answer.",
    status: "draft",
    source: `${VP} pending_accept`,
  },
  {
    key: "pending_accept_withheld",
    es: "De acuerdo, no necesitas compartirlo ahora. Lo dejo anotado como pendiente.",
    en: "That is fine, you do not need to share it now. I am noting it as pending.",
    status: "draft",
    source: NEW,
  },
  {
    key: "pending_accept_estimate",
    es: "Lo anoto como estimación, para que quede claro que es un dato aproximado.",
    en: "I am noting it as an estimate, so it is clear that the figure is approximate.",
    status: "draft",
    source: NEW,
  },
  // ---- process questions
  {
    key: "process_unknown",
    es: "No puedo confirmar ese detalle por ahora y prefiero no suponerlo. Puedes preguntarlo a beeside desde Contactar a beeside.",
    en: "I can't confirm that detail right now, and I would rather not guess. You can ask beeside through Contact beeside.",
    status: "draft",
    source: "Track A contract §0 (honest copy) + Build Readiness §L-3",
  },
  {
    key: "process_resume_lead",
    es: "Retomamos donde nos quedamos.",
    en: "Back to where we left off.",
    status: "draft",
    source: "Build Readiness §L-4",
  },
  {
    key: "process_resume_none",
    es: "Cuando quieras, seguimos con el siguiente paso.",
    en: "Whenever you like, we continue with the next step.",
    status: "draft",
    source: "Build Readiness §L-4",
  },
  {
    key: "r10_cannot_confirm",
    es: "Todavía no puedo confirmar ese requisito para ese país, así que lo dejo anotado como pendiente.",
    en: "I can't confirm that requirement for that country yet, so I am noting it as pending.",
    status: "draft",
    source: "Build Readiness §M-2 (R10)",
  },
  // ---- failures
  {
    key: "ai_unavailable_retry",
    es: "No pude responder ahora, pero tu mensaje quedó guardado. Puedes intentarlo de nuevo.",
    en: "I could not reply just now, but your message is saved. You can try again.",
    status: "draft",
    source: `${VP} err_generic (adapted) + Build Readiness §M-5`,
  },
  {
    key: "guard_block",
    es: "No puedo procesar ese mensaje tal como está. ¿Puedes decirlo con otras palabras?",
    en: "I cannot process that message as it is. Could you say it in other words?",
    status: "draft",
    source: `${VP} guard_block`,
  },
  {
    key: "fallback_question_wrapper",
    es: "¿Qué puedes indicarme sobre este punto: {label}?",
    en: "What can you tell me about this point: {label}?",
    status: "draft",
    source: "Track A contract §4 (fixed-copy fallback question from the manifest label)",
  },
  // ---- confirm cards / quick replies / client echoes
  { key: "confirm_yes", es: "Sí, es correcto", en: "Yes, that is correct", status: "draft", source: NEW },
  { key: "confirm_correct", es: "Quiero corregirlo", en: "I want to correct it", status: "draft", source: NEW },
  { key: "card_title_inherited", es: "Esto es lo que ya tenemos", en: "This is what we already have", status: "draft", source: NEW },
  { key: "card_title_candidate", es: "Confirma lo que entendí", en: "Confirm what I understood", status: "draft", source: NEW },
  { key: "card_title_need", es: "Tu necesidad", en: "Your need", status: "draft", source: NEW },
  { key: "client_echo_confirm", es: "Sí, es correcto.", en: "Yes, that is correct.", status: "draft", source: NEW },
  { key: "client_echo_correct", es: "Quiero corregirlo.", en: "I want to correct it.", status: "draft", source: NEW },
  { key: "qr_yes", es: "Sí", en: "Yes", status: "draft", source: NEW },
  { key: "qr_no", es: "No", en: "No", status: "draft", source: NEW },
  { key: "qr_unknown", es: "Todavía no lo sé", en: "Not sure yet", status: "draft", source: NEW },
  // ---- Add a Service
  { key: "add_service_intro", es: "Cuéntame qué necesitas.", en: "Tell me what you need.", status: "draft", source: `${VP} add_service_intro` },
  {
    key: "add_service_confirm_need",
    es: "Entiendo que necesitas: {need}. ¿Lo agrego a tu proyecto?",
    en: "I understand that you need: {need}. Shall I add it to your project?",
    status: "draft",
    source: `${VP} add_service_confirm_need`,
  },
  { key: "add_service_rephrase", es: "De acuerdo. Cuéntame con otras palabras qué necesitas.", en: "Tell me in other words what you need.", status: "draft", source: NEW },
  {
    key: "add_service_confirmed_ack",
    es: "Entendido. Lo agrego a tu proyecto y actualizo tu My Service Map.",
    en: "Understood. I am adding it to your project and updating your My Service Map.",
    status: "draft",
    source: `${NEW}; replaces superseded add_service_new_version (D-9)`,
  },
  {
    key: "add_service_not_available_yet",
    es: "Lo incluyo ahora mismo en tu My Service Map; cuando lo confirmes podrás agregar más servicios en cualquier momento.",
    en: "I am including it in your My Service Map right now; once you confirm it you can add more services at any time.",
    status: "draft",
    source: `${VP} add_service_not_available_yet`,
  },
  {
    key: "add_service_not_supported_now",
    es: "Por ahora no puedo agregar esto a tu My Service Map. Puedes consultarlo con beeside desde Contactar a beeside, o contarme otra necesidad de tu proyecto.",
    en: "I cannot add this to your My Service Map right now. You can ask beeside about it through Contact beeside, or tell me about another need in your project.",
    status: "draft",
    source: "Authored for F5 (replaces the reuse of add_service_not_available_yet as an out-of-scope notice; see docs/f5/qa/copy-issues.md)",
  },
  {
    key: "oos_mobility",
    es: "Esto lo entiendo y lo anoto. beeside no puede realizar trámites migratorios, visas ni gestiones personales o ante autoridades, y en muchos casos requerirían representar legalmente a tu empresa. Por eso no ofrecemos este servicio. Puedo seguir con el resto de tu proyecto.",
    en: "I understand this and I am noting it. beeside cannot carry out immigration procedures, visas or personal matters or procedures before authorities, and in many cases they would require legally representing your company. That is why we do not offer this service. I can continue with the rest of your project.",
    status: "draft",
    source: `${VP} oos_mobility (PO approval required)`,
  },
  // ---- service map / category labels and notes
  { key: "crp_pending_section_title", es: "Información pendiente", en: "Pending Information", status: "draft", source: `${VP} crp_pending_section_title` },
  { key: "crp_item_state_pending", es: "Pendiente", en: "Pending", status: "draft", source: `${VP} crp_item_state_labels` },
  // ---- Company context (CCIR) — PO-approved wording where the Voice Pack says so.
  // NON-SHIPPING in this release candidate: the Company Context step is not built yet (docs/f5/precision-ccir-company-context-delta). Kept on purpose, not dead.
  { key: "ccir_intro", es: "Ahora que entiendo tu proyecto de expansión, me gustaría completar algunos datos de tu empresa. Nos ayudarán a preparar los siguientes pasos y a no pedirte lo mismo más adelante.", en: "Now that I understand your expansion project, I'd like to complete a few company details that will help us prepare the next steps and avoid asking for the same information again later.", status: "approved", source: `${VP} §3.1 ccir_intro` },
  { key: "ccir_why_title", es: "¿Por qué te pedimos esta información?", en: "Why we ask for this information", status: "approved", source: `${VP} §3.1` },
  { key: "ccir_why_scale", es: "Nos ayuda a entender la escala real de tu empresa y dimensionar mejor los servicios que puede requerir tu expansión.", en: "It helps us understand the real scale of your company and better size the services your expansion may require.", status: "approved", source: `${VP} §3.1` },
  { key: "ccir_why_no_documents", es: "En esta etapa solo necesitamos los datos; no pedimos comprobantes, estados financieros ni documentación soporte.", en: "At this stage, we only need the information — no supporting documents or financial statements are required.", status: "approved", source: `${VP} §3.1 (QA-m1 fixed)` },
  { key: "ccir_why_later_evidence", es: "Si más adelante algún servicio necesita evidencia o documentación adicional, beeside o el proveedor te lo indicará.", en: "If a specific service later requires evidence or additional documentation, beeside or the provider will let you know.", status: "approved", source: `${VP} §3.1` },
  { key: "ccir_prefill_confirm", es: "Esto es lo que ya tenemos de tu empresa. ¿Sigue siendo así?", en: "This is what we already have for your company. Is it still accurate?", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_state_verified", es: "Datos validados", en: "Details verified", status: "approved", source: `${VP} §3.1 (exact R7 exception)` },
  { key: "ccir_state_mismatch", es: "Favor de validar", en: "Please review", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_state_not_found", es: "No encontrado", en: "Not found", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_state_help_verified", es: "Coincide con una fuente externa.", en: "It matches an external source.", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_state_help_mismatch", es: "Encontramos una referencia externa distinta a lo que indicaste.", en: "We found an external reference that differs from what you entered.", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_state_help_not_found", es: "No pudimos localizarlo en las fuentes disponibles. Eso no significa que esté mal; puedes continuar.", en: "We could not locate it in the available sources. That does not mean it is wrong; you can continue.", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_mismatch_prompt_address", es: "Encontramos un domicilio registrado distinto. ¿Quieres actualizar tu información o conservar la dirección que indicaste?", en: "We found a different registered address. Would you like to update your information or keep the address you provided?", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_mismatch_prompt_generic", es: "Encontramos un dato distinto en una fuente externa. ¿Quieres actualizar tu información o conservar la que indicaste?", en: "We found a different value in an external source. Would you like to update your information or keep the one you provided?", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_resolution_update", es: "Actualizar mi información", en: "Update my information", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_resolution_keep", es: "Conservar lo que indiqué", en: "Keep what I entered", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_resolution_not_sure", es: "No lo tengo claro", en: "I'm not sure", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_resolution_pending", es: "Dejarlo pendiente", en: "Leave it pending", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_verification_scope_note", es: "Comparamos algunos datos con fuentes externas cuando hay una disponible. Ningún resultado afecta tu proyecto.", en: "We compare some details with external sources when one is available. No result affects your project.", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_field_pending_ack", es: "Lo dejo como pendiente. No tienes que resolverlo ahora.", en: "I will leave it as pending. You do not need to resolve it now.", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_employee_refine_prompt", es: "Indicaste que tu empresa tiene entre {min} y {max} empleados. ¿Cuántos tiene aproximadamente hoy?", en: "You previously indicated that your company has between {min} and {max} employees. Approximately how many employees do you currently have?", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_employee_ask", es: "¿Cuántos empleados tiene tu empresa aproximadamente hoy?", en: "Approximately how many employees does your company have today?", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_name_classify_prompt", es: "Tenemos registrado el nombre {name}. ¿Es el nombre comercial, la razón social o ambos?", en: "We have the name {name} recorded. Is it your commercial name, your legal entity name, or both?", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_name_option_trade", es: "Nombre comercial", en: "Commercial name", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_name_option_legal", es: "Razón social", en: "Legal entity name", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_name_option_both", es: "Ambos", en: "Both", status: "draft", source: `${VP} §3.1` },
  { key: "ccir_name_option_neither", es: "Ninguno de los dos", en: "Neither", status: "draft", source: `${VP} §3.1` },
];

/**
 * Voice Pack keys that must NOT be built (decision D-9, Build Readiness §N-2, Δ10). Kept as a list so a test
 * proves they are absent from COPY_ENTRIES.
 */
export const SUPERSEDED_COPY_KEYS: readonly string[] = [
  "pu_progress_help", // percentage in Understanding (QA-M1)
  "pbyc_completed", // "Completada" (QA-M7)
  "crp_completed", // skips Ready for review / Confirm CRP / Preview before Send (QA-M6)
  "send_to_oh_first", // promise of work start (QA-M4)
  "send_to_oh_first_sa", // idem
  "oh_active", // channel with the Sherpa inside Precision (QA-C4)
  "running_service_note", // QA-C1
  "running_service_note_sherpa", // QA-C1
  "sa_intake_close", // "tu asesor" (QA-M5)
  "sa_crp_completed", // QA-M6
  "ed_crp_completed", // QA-M6
  "add_service_new_version", // visible version number (QA-M3)
  "psm_version_label", // visible version number (QA-M3)
  "send_update_note", // QA-C2
  "pending_review_intro", // QA-C3
  "pending_complete_now", // QA-C3
  "pending_continue", // QA-C3
  "precision_readonly_notice", // QA-M9 (download) pending Design Proof v3.3
];
