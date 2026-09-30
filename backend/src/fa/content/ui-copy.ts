import { QuestionBankBundle, StageDef } from "../engine/bundle-types";

// Interface and email copy. English follows the Master Build Guide v2 (§6.1, §6.2, §6.5, Appendix B1)
// and Handoff v1 (§4 microcopy, §18 day-10 and recovery wording) where literal copy exists; the rest
// is minimal operational copy under the editorial principles (confident, calm, never overclaiming).
// Access (15 days, extendable to day 45) is never described as retention.

export const STAGES: StageDef[] = [
  { id: "project", copy: { en: { label: "Project" }, es: { label: "Proyecto" } } },
  { id: "business", copy: { en: { label: "Business" }, es: { label: "Negocio" } } },
  { id: "operation", copy: { en: { label: "Operation" }, es: { label: "Operación" } } },
  { id: "priorities", copy: { en: { label: "Priorities" }, es: { label: "Prioridades" } } },
  { id: "snapshot", copy: { en: { label: "Snapshot" }, es: { label: "Snapshot" } } },
];

export const UI_COPY: QuestionBankBundle["ui"] = {
  common: {
    copy: {
      en: {
        continue: "Continue",
        back: "Back",
        optional: "Optional",
        saved: "Saved",
        save_error: "Having trouble saving — trying again",
        save_failed: "We couldn’t save your last answer. Please check your connection.",
        finish_later: "Finish later",
        language: "Language",
        progress_label: "Assessment progress",
        required_error: "Please answer to continue.",
        generic_error: "Something went wrong. Please try again.",
        loading: "Loading…",
        timing_date: "Exact date",
        timing_month: "Target month",
        timing_quarter: "Approximate quarter",
        timing_not_sure: "Not sure yet",
        quarter_label: "Quarter",
        year_label: "Year",
        quantity_amount: "Amount",
        quantity_unit: "Unit",
        quantity_not_sure: "Not sure",
        country_remove: "Remove",
        country_no_results: "No matching country",
      },
      es: {
        continue: "Continuar",
        back: "Atrás",
        optional: "Opcional",
        saved: "Guardado",
        save_error: "Tenemos problemas para guardar; lo seguimos intentando",
        save_failed: "No pudimos guardar tu última respuesta. Revisa tu conexión.",
        finish_later: "Terminar después",
        language: "Idioma",
        progress_label: "Avance de la evaluación",
        required_error: "Responde para continuar.",
        generic_error: "Algo salió mal. Inténtalo de nuevo.",
        loading: "Cargando…",
        timing_date: "Fecha exacta",
        timing_month: "Mes objetivo",
        timing_quarter: "Trimestre aproximado",
        timing_not_sure: "Todavía no estoy seguro",
        quarter_label: "Trimestre",
        year_label: "Año",
        quantity_amount: "Cantidad",
        quantity_unit: "Unidad",
        quantity_not_sure: "No estoy seguro",
        country_remove: "Quitar",
        country_no_results: "No encontramos ese país",
      },
    },
  },
  // Hero/Home (owner-approved copy, verbatim in English; ES is a faithful translation of the same
  // approved text — no separate brand-statement line, per the approved spec).
  welcome: {
    copy: {
      en: {
        eyebrow: "beeside First Assessment",
        headline: "Expand your business with clarity.",
        body: "Tell us about your project. We’ll help you identify what’s already defined, what needs attention, and what comes next.",
        cta: "Start your assessment",
        support: "Around 10–15 minutes · Save and continue later",
      },
      es: {
        eyebrow: "beeside First Assessment",
        headline: "Expande tu negocio con claridad.",
        body: "Cuéntanos sobre tu proyecto. Te ayudaremos a identificar qué ya está definido, qué necesita atención y qué sigue.",
        cta: "Inicia tu evaluación",
        support: "Alrededor de 10–15 minutos · Guarda y continúa después",
      },
    },
  },
  identity: {
    copy: {
      en: {
        title: "Let’s start with you",
        intro: "We’ll use these details to save your progress and prepare your Expansion Snapshot.",
        first_name: "First name",
        last_name: "Last name",
        company: "Company",
        website: "Company website",
        email: "Work email",
        email_helper: "If you don’t have one, you can use your personal email.",
        email_usage: "We’ll use it to save your progress, send your private resume link and deliver your Expansion Snapshot.",
        personal_email_note: "This looks like a personal email. A work email helps keep your project connected to your company, but you can continue with this one.",
        personal_email_ack: "Continue with this email",
        legal_prefix: "I accept the",
        privacy_policy: "Privacy Policy",
        legal_and: "and the",
        terms: "Terms & Conditions",
        legal_opens_new_tab: "(opens in a new tab)",
        email_invalid: "Please enter a valid email address.",
        website_invalid: "Please enter a valid website, or leave it empty.",
        legal_required: "Please accept the Privacy Policy and Terms & Conditions to continue.",
      },
      es: {
        title: "Empecemos contigo",
        intro: "Usaremos estos datos para guardar tu avance y preparar tu Expansion Snapshot.",
        first_name: "Nombre",
        last_name: "Apellido",
        company: "Empresa",
        website: "Sitio web de la empresa",
        email: "Correo de trabajo",
        email_helper: "Si no tienes uno, puedes usar tu correo personal.",
        email_usage: "Lo usaremos para guardar tu avance, enviarte tu enlace privado para continuar y entregarte tu Expansion Snapshot.",
        personal_email_note: "Parece un correo personal. Un correo de trabajo ayuda a mantener tu proyecto vinculado a tu empresa, pero puedes continuar con este.",
        personal_email_ack: "Continuar con este correo",
        legal_prefix: "Acepto el",
        privacy_policy: "Aviso de Privacidad",
        legal_and: "y los",
        terms: "Términos y Condiciones",
        legal_opens_new_tab: "(se abre en una pestaña nueva)",
        email_invalid: "Escribe un correo electrónico válido.",
        website_invalid: "Escribe un sitio web válido o deja el campo vacío.",
        legal_required: "Acepta el Aviso de Privacidad y los Términos y Condiciones para continuar.",
      },
    },
  },
  existing_email: {
    copy: {
      en: {
        title: "You already have a saved assessment",
        body: "To protect your information, we’ll send a private link to this email. From there you can continue where you left off or start a new project.",
        send: "Send me a private link",
        sent: "If there is a saved assessment for this email, a private link is on its way.",
        use_other_email: "Use a different email",
      },
      es: {
        title: "Ya tienes una evaluación guardada",
        body: "Para proteger tu información, enviaremos un enlace privado a este correo. Desde ahí podrás continuar donde te quedaste o iniciar un nuevo proyecto.",
        send: "Enviarme un enlace privado",
        sent: "Si hay una evaluación guardada para este correo, tu enlace privado va en camino.",
        use_other_email: "Usar otro correo",
      },
    },
  },
  finish_later: {
    copy: {
      en: {
        title: "Your progress is saved.",
        body: "We’ll send you a private link so you can continue exactly where you left off.",
        keep_going: "Keep going now",
      },
      es: {
        title: "Tu avance está guardado.",
        body: "Te enviaremos un enlace privado para que puedas continuar exactamente donde te quedaste.",
        keep_going: "Seguir ahora",
      },
    },
  },
  resume: {
    copy: {
      en: {
        opening: "Opening your assessment…",
        choose_title: "Welcome back",
        continue_saved: "Continue my assessment",
        start_new_same_company: "Start a new project for {{company_name}}",
        start_new_other_company: "Start a new project for another company",
        invalid_title: "This link is no longer available",
        invalid_body: "For your privacy, links expire or are replaced when a new one is sent. We can send a new private link to the email you used.",
        email_label: "Email",
        request_link: "Send me a new link",
        sent: "If there is a saved assessment for this email, a new private link is on its way.",
      },
      es: {
        opening: "Abriendo tu evaluación…",
        choose_title: "Qué gusto verte de nuevo",
        continue_saved: "Continuar mi evaluación",
        start_new_same_company: "Iniciar un nuevo proyecto para {{company_name}}",
        start_new_other_company: "Iniciar un nuevo proyecto para otra empresa",
        invalid_title: "Este enlace ya no está disponible",
        invalid_body: "Por tu privacidad, los enlaces vencen o se reemplazan cuando enviamos uno nuevo. Podemos enviarte un nuevo enlace privado al correo que usaste.",
        email_label: "Correo electrónico",
        request_link: "Enviarme un nuevo enlace",
        sent: "Si hay una evaluación guardada para este correo, tu nuevo enlace privado va en camino.",
      },
    },
  },
  access: {
    copy: {
      en: {
        expired_title: "Your First Assessment is no longer active",
        expired_body: "We don’t want you to lose the work you already started. We can still restore your progress.",
        recover_cta: "Recover my assessment",
        extend_title: "How much more time would help?",
        extend_15: "15 more days",
        extend_30: "30 more days",
        reason_title: "What would help you finish?",
        reason_missing_information: "I’m missing some information",
        reason_project_not_structured: "My expansion project isn’t structured enough yet",
        reason_unsure_market_timing: "I’m unsure about the market or timing",
        reason_something_else: "Something else",
        extend_submit: "Keep my assessment available",
        extended: "Your First Assessment is available until {{access_until}}.",
        continue_cta: "Continue my assessment",
        closed_title: "This First Assessment can no longer be restored",
        closed_body: "You’re welcome to start a new First Assessment whenever you’re ready.",
        start_new: "Start a new assessment",
      },
      es: {
        expired_title: "Tu First Assessment ya no está activo",
        expired_body: "No queremos que pierdas el trabajo que ya empezaste. Todavía podemos restaurar tu avance.",
        recover_cta: "Recuperar mi evaluación",
        extend_title: "¿Cuánto tiempo más te ayudaría?",
        extend_15: "15 días más",
        extend_30: "30 días más",
        reason_title: "¿Qué te ayudaría a terminar?",
        reason_missing_information: "Me falta información",
        reason_project_not_structured: "Mi proyecto de expansión todavía no está suficientemente estructurado",
        reason_unsure_market_timing: "Tengo dudas sobre el mercado o los tiempos",
        reason_something_else: "Otra razón",
        extend_submit: "Mantener mi evaluación disponible",
        extended: "Tu First Assessment está disponible hasta el {{access_until}}.",
        continue_cta: "Continuar mi evaluación",
        closed_title: "Este First Assessment ya no se puede restaurar",
        closed_body: "Puedes iniciar un nuevo First Assessment cuando quieras.",
        start_new: "Iniciar una nueva evaluación",
      },
    },
  },
  completion: {
    copy: {
      en: {
        title: "Thank you. Your First Assessment is complete.",
        body: "We’re preparing your Expansion Snapshot from what you shared.",
        another_title: "You mentioned another project",
        another_body: "When you’re ready, you can start it for the same company.",
        another_cta: "Start another project",
      },
      es: {
        title: "Gracias. Tu First Assessment está completo.",
        body: "Estamos preparando tu Expansion Snapshot con lo que compartiste.",
        another_title: "Mencionaste otro proyecto",
        another_body: "Cuando quieras, puedes iniciarlo para la misma empresa.",
        another_cta: "Iniciar otro proyecto",
      },
    },
  },
  // Level 2 MVP — the Assemble transition (Design Specification "AssembleTransition" component,
  // build-order item 9): the non-spinner motion sequence shown while the locked assessment's
  // Snapshot is being generated. Additive only, same as `level2` below.
  assemble: {
    copy: {
      en: { headline: "Putting the pieces together.", body: "We’re assembling your Expansion Snapshot from what you shared." },
      es: { headline: "Armando las piezas.", body: "Estamos preparando tu Expansion Snapshot con lo que compartiste." },
    },
  },
  // Level 2 MVP — Virtual Snapshot narrative beats (RadarProfile first; PathwayDiagram and
  // CapabilityLandscapeGrid follow the same reusable-component, additive-copy pattern as they are
  // built). Additive only, same as `assemble`/`level2`.
  virtual_snapshot: {
    copy: {
      en: {
        big_picture_title: "The big picture",
        big_picture_intro: "Six dimensions of your project, and how clearly each one is defined today.",
        radar_accessible_summary: "Definition by dimension",
        stand_out_title: "What stands out",
        stand_out_intro: "From the big picture, here is where you have a solid foundation and where to focus first.",
        opening_project_label: "Your project",
        opening_objectives_label: "Your objectives",
        opening_requirements_label: "Your requirements",
        opening_requirements_empty: "You haven’t flagged any fixed constraints or commitments yet.",
        // Precision Transition — frozen v8.1 "What's next" 3-icon grid (PrecisionTransition.tsx).
        precision_next_heading: "What's next",
        precision_next_item_1:
          "With Precision Assessment, your identified needs become clear, service ready requirements.",
        precision_next_item_2:
          "You'll also gain access to the Operation Hub, where your project, progress and next actions are coordinated in one place.",
        precision_next_item_3:
          "Your Sherpa and selected specialists from The Hive will then bring tailored proposals to your table, ready for review and activation.",
        precision_next_cta: "See what Premium unlocks",
        // beeside Value / "Why continue with beeside" — frozen v8.1 `#beeside-value` section
        // (SnapshotValueCase.tsx). Static institutional copy, identical for every project.
        value_case_kicker: "Why continue with beeside",
        value_case_title: "The value of one coordinated expansion.",
        value_case_intro:
          "As the operating model becomes more fragmented, more time, cost and coordination shift back to your team. beeside Premium brings the capabilities together in one coordinated system.",
        value_case_pillars_kicker: "What beeside gives you",
        value_case_pillar_sherpa_head: "Your Sherpa",
        value_case_pillar_sherpa_body: "One person, working as an extension of your team.",
        value_case_pillar_oh_head: "Operation Hub",
        value_case_pillar_oh_body: "One platform for tasks, schedule, documents, follow-up.",
        value_case_pillar_hive_head: "The Hive",
        value_case_pillar_hive_body: "Trusted local ecosystem — vetted specialists, coordinated for you.",
        value_case_pillar_advisory_head: "Strategic advisory",
        value_case_pillar_advisory_body: "Support for the bigger decisions, not bundled consulting.",
        value_case_gain_1: "One person and one platform looking after your interests",
        value_case_gain_2: "Activate exactly the services you need, when you need them",
        value_case_gain_3: "Specialist access the moment a decision gets unclear",
        value_case_gain_4: "Continuity and visibility from day one through execution",
        value_case_compare_caption: "Comparison of estimated times, cost and effort for managing landing services.",
        value_case_tier_a_name: "beeside Premium",
        value_case_tier_a_sub: "Coordinated system",
        value_case_tier_b_name: "Hire one local person",
        value_case_tier_b_sub: "One skillset, one point of view",
        value_case_tier_c_name: "Office + one person",
        value_case_tier_c_sub: "Fixed overhead added",
        value_case_tier_d_name: "Office + person + travels",
        value_case_tier_d_sub: "Highest cost, still fragmented",
        value_case_chip_multi_service: "Multi-service activation",
        value_case_chip_specialist_access: "Specialist access",
        value_case_chip_project_visibility: "Project visibility",
        value_case_chip_coordination: "Coordination",
        value_case_chip_curated_ecosystem: "Curated ecosystem",
        value_case_chip_continuity: "Continuity",
        value_case_chip_digital_platform: "24/7 digital platform access",
        value_case_chip_centralized_docs: "Centralized documentation",
        value_case_chip_local_presence: "Local presence",
        value_case_chip_direct_oversight: "Direct oversight",
        value_case_banner_title: "Expand your business. Not your workload.",
        value_case_banner_body:
          "Every option above still runs through you. beeside is the only one that gives you a coordinated system — so the work of expanding doesn't become a second job.",
        value_case_banner_chip_specialist: "Curated specialist access",
        value_case_banner_chip_visibility: "Centralized project visibility",
        value_case_banner_chip_continuity: "Sherpa continuity",
        value_case_pdf_title: "Your Executive PDF",
        value_case_pdf_body:
          "The same project story — summary, warnings, radar, capabilities, activation waves, and this comparison — as a standalone document for management, partners or board circulation. Not a printout of this page.",
        value_case_pdf_tag: "We'll also send this PDF to your email.",
        value_case_cta_title: "Ready to make it happen?",
        value_case_cta_button: "Continue with Premium",
        value_case_cta_disclosure:
          "This Snapshot reflects the information you provided and is not a guarantee of outcomes. Comparison above is illustrative and does not represent guaranteed pricing.",
        // Final visual polish pass — one Pathway stage can legitimately have nothing in it; a bare
        // "—" read as an unexplained gap rather than a fact worth stating plainly.
        pathway_stage_empty: "Nothing is placed at this stage yet.",
        // Dual Expansion Profile (Macroblock 7) — chrome-only strings for the dumbbell track view and
        // the dual-series radar view, both rendered together over the same six dimensions. Per-project
        // title/intro/series-legend text is on RenderedSnapshot.dualProfile, not here.
        dual_profile_accessible_summary: "Definition & Evidence and Execution Demand by dimension",
        dual_profile_not_evaluable: "Not yet evaluable",
        dual_profile_scale_less: "Less defined",
        dual_profile_scale_more: "More defined",
        dual_profile_radar_eyebrow: "Radar view — the same six dimensions, plotted as one shape per series",
        // Narrative Interpretation Library (Macroblock 7 — Final Gap Closure) section titles. These
        // are structural labels only (verbatim the frozen artifact's own section kickers), never the
        // interpretive sentence itself — that text is on RenderedSnapshot.keyReading/
        // marketEvidenceNarrative/executionPressureNarrative, Product-Owner-approved verbatim.
        key_reading_title: "Key Reading",
        market_evidence_title: "Market Evidence",
        execution_pressure_title: "Execution Pressure",
        // Night Shift dark-mode toggle (frozen v8.1 `.night-toggle` — NightShiftToggle.tsx).
        // Label is action-oriented, matching the frozen file's own toggleNightShift(): it names
        // what the toggle currently represents, not a command to click it.
        night_toggle_night: "Night Shift",
        night_toggle_day: "Day mode",
      },
      es: {
        big_picture_title: "El panorama general",
        big_picture_intro: "Seis dimensiones de tu proyecto, y qué tan definida está cada una hoy.",
        radar_accessible_summary: "Nivel de definición por dimensión",
        stand_out_title: "Lo que más destaca",
        stand_out_intro: "Del panorama general, aquí tienes una base sólida y aquí conviene enfocarte primero.",
        opening_project_label: "Tu proyecto",
        opening_objectives_label: "Tus objetivos",
        opening_requirements_label: "Tus requisitos",
        opening_requirements_empty: "Todavía no has señalado restricciones o compromisos fijos.",
        // Precision Transition — cuadrícula de 3 íconos "Qué sigue" del v8.1 congelado.
        precision_next_heading: "Qué sigue",
        precision_next_item_1:
          "Con Precision Assessment, tus necesidades identificadas se convierten en requisitos claros y listos para el servicio.",
        precision_next_item_2:
          "También tendrás acceso al Operation Hub, donde tu proyecto, tu avance y tus próximas acciones se coordinan en un solo lugar.",
        precision_next_item_3:
          "Tu Sherpa y los especialistas seleccionados de The Hive llevarán propuestas a la medida a tu mesa, listas para revisión y activación.",
        precision_next_cta: "Descubre lo que desbloquea Premium",
        // beeside Value / "Por qué continuar con beeside" — sección `#beeside-value` del v8.1
        // congelado. Copy institucional estático, idéntico para cada proyecto.
        value_case_kicker: "Por qué continuar con beeside",
        value_case_title: "El valor de una expansión coordinada.",
        value_case_intro:
          "A medida que el modelo operativo se fragmenta, más tiempo, costo y coordinación regresan a tu equipo. beeside Premium reúne las capacidades en un solo sistema coordinado.",
        value_case_pillars_kicker: "Lo que beeside te da",
        value_case_pillar_sherpa_head: "Tu Sherpa",
        value_case_pillar_sherpa_body: "Una persona, como extensión de tu equipo.",
        value_case_pillar_oh_head: "Operation Hub",
        value_case_pillar_oh_body: "Una plataforma para tareas, calendario, documentos y seguimiento.",
        value_case_pillar_hive_head: "The Hive",
        value_case_pillar_hive_body: "Ecosistema local de confianza — especialistas validados, coordinados para ti.",
        value_case_pillar_advisory_head: "Asesoría estratégica",
        value_case_pillar_advisory_body: "Apoyo para las decisiones grandes, no consultoría empaquetada.",
        value_case_gain_1: "Una persona y una plataforma cuidando tus intereses",
        value_case_gain_2: "Activa exactamente los servicios que necesitas, cuando los necesitas",
        value_case_gain_3: "Acceso a especialistas en el momento en que una decisión se vuelve incierta",
        value_case_gain_4: "Continuidad y visibilidad desde el día uno hasta la ejecución",
        value_case_compare_caption:
          "Comparación de tiempos, costo y esfuerzo estimados para gestionar los servicios de aterrizaje.",
        value_case_tier_a_name: "beeside Premium",
        value_case_tier_a_sub: "Sistema coordinado",
        value_case_tier_b_name: "Contratar a una persona local",
        value_case_tier_b_sub: "Un perfil, un punto de vista",
        value_case_tier_c_name: "Oficina + una persona",
        value_case_tier_c_sub: "Gasto fijo adicional",
        value_case_tier_d_name: "Oficina + persona + viajes",
        value_case_tier_d_sub: "El costo más alto, sigue fragmentado",
        value_case_chip_multi_service: "Activación multiservicio",
        value_case_chip_specialist_access: "Acceso a especialistas",
        value_case_chip_project_visibility: "Visibilidad del proyecto",
        value_case_chip_coordination: "Coordinación",
        value_case_chip_curated_ecosystem: "Ecosistema curado",
        value_case_chip_continuity: "Continuidad",
        value_case_chip_digital_platform: "Acceso a la plataforma digital 24/7",
        value_case_chip_centralized_docs: "Documentación centralizada",
        value_case_chip_local_presence: "Presencia local",
        value_case_chip_direct_oversight: "Supervisión directa",
        value_case_banner_title: "Expande tu negocio. No tu carga de trabajo.",
        value_case_banner_body:
          "Cada opción anterior sigue dependiendo de ti. beeside es la única que te da un sistema coordinado — para que expandirte no se convierta en un segundo trabajo.",
        value_case_banner_chip_specialist: "Acceso curado a especialistas",
        value_case_banner_chip_visibility: "Visibilidad centralizada del proyecto",
        value_case_banner_chip_continuity: "Continuidad de tu Sherpa",
        value_case_pdf_title: "Tu PDF Ejecutivo",
        value_case_pdf_body:
          "La misma historia del proyecto — resumen, alertas, radar, capacidades, olas de activación y esta comparación — como documento independiente para gerencia, socios o el consejo. No es una impresión de esta página.",
        value_case_pdf_tag: "También enviaremos este PDF a tu correo.",
        value_case_cta_title: "¿Listo para hacerlo realidad?",
        value_case_cta_button: "Continuar con Premium",
        value_case_cta_disclosure:
          "Este Snapshot refleja la información que proporcionaste y no es garantía de resultados. La comparación anterior es ilustrativa y no representa precios garantizados.",
        pathway_stage_empty: "Todavía no hay nada ubicado en esta etapa.",
        dual_profile_accessible_summary: "Definición y Evidencia, y Demanda de Ejecución, por dimensión",
        dual_profile_not_evaluable: "Todavía no evaluable",
        dual_profile_scale_less: "Menos definido",
        dual_profile_scale_more: "Más definido",
        dual_profile_radar_eyebrow: "Vista de radar — las mismas seis dimensiones, graficadas como una forma por serie",
        key_reading_title: "Lectura Clave",
        market_evidence_title: "Evidencia de Mercado",
        execution_pressure_title: "Presión de Ejecución",
        night_toggle_night: "Night Shift",
        night_toggle_day: "Modo día",
      },
    },
  },
  // Level 2 MVP — grouped compositions, Needs Explorer, StructuredEcho and Review. Additive only:
  // fa-qb-1.1.0 never reads this key, so nothing here can affect a project still on that bundle.
  level2: {
    copy: {
      en: {
        needs_explorer_intro: "Select what applies. You can change your mind later — nothing here is final.",
        needs_status_label: "Where does this stand?",
        needs_status_covered_internally: "We already handle this ourselves",
        needs_status_covered_by_provider: "Someone already handles this for us",
        needs_status_in_progress: "We're working on it",
        needs_status_needs_resolution: "This needs to be resolved",
        needs_status_needs_confirmation: "Not sure — needs confirmation",
        needs_add: "Add",
        needs_remove: "Remove",
        needs_selected_count: "{{count}} selected",
        needs_limit_reached: "You can select up to {{max}} — remove one to add another.",
        priority_rank_title: "Rank your top priorities",
        priority_rank_intro: "From what you selected, drag or use the buttons to order what matters most. Position 1 is your immediate priority.",
        priority_rank_empty: "Select at least one item above before ranking it.",
        priority_move_up: "Move up",
        priority_move_down: "Move down",
        priority_remove_from_rank: "Remove from ranking",
        priority_add_to_rank: "Add to ranking",
        blockers_title: "Are any of these blocking you?",
        blockers_helper: "Mark anything you can't move forward without.",
        dependencies_title: "Does one depend on another?",
        dependencies_helper: "Optional — only if one of these can't start until another is resolved.",
        dependency_depends_on: "Depends on",
        dependency_none: "Doesn't depend on anything else",
        dependency_owner: "Who owns this internally?",
        dependency_owner_placeholder: "Name or role (optional)",
        dependency_approval_required: "Does this need approval from someone else?",
        dependency_approval_from: "From whom?",
        needs_context_note: "Client priority and dependency order are shown separately — we never reorder one to match the other.",
        tag_add_placeholder: "Type a name and press Enter",
        tag_add_button: "Add",
        tag_remove: "Remove {{tag}}",
        tag_limit_reached: "You can add up to {{max}}.",
        counterparty_name_placeholder: "Company or group name",
        counterparty_restriction_label: "What kind of restriction?",
        counterparty_restriction_cannot_contract: "Cannot contract",
        counterparty_restriction_do_not_share_information: "Cannot share information with",
        counterparty_restriction_both: "Both",
        counterparty_add_button: "Add",
        counterparty_remove: "Remove {{name}}",
        counterparty_limit_reached: "You can add up to {{max}}.",
        counterparty_confidential_note: "Kept confidential and scoped to this project — never shared with providers.",
        structured_echo_question: "Does this match what you meant?",
        structured_echo_yes: "Yes, that's right",
        structured_echo_edit: "Not quite — let me choose",
        review_title_default: "Review how we understood your project",
        review_edit: "Edit",
        review_confirm: "Confirm and continue",
        review_empty: "Not answered",
        note_tab_empty: "\ud83d\udcdd Leave a note",
        note_tab_filled: "\ud83d\udcdd Note added",
        note_placeholder: "Anything else about this we should know? Optional.",
        note_close: "Close",
        review_note_prefix: "Note on file:",
      },
      es: {
        needs_explorer_intro: "Selecciona lo que aplique. Puedes cambiar de opinión después: nada aquí es definitivo.",
        needs_status_label: "¿En qué estado está esto?",
        needs_status_covered_internally: "Ya lo manejamos nosotros mismos",
        needs_status_covered_by_provider: "Alguien ya lo maneja por nosotros",
        needs_status_in_progress: "Estamos trabajando en ello",
        needs_status_needs_resolution: "Esto necesita resolverse",
        needs_status_needs_confirmation: "No estoy seguro; necesita confirmarse",
        needs_add: "Agregar",
        needs_remove: "Quitar",
        needs_selected_count: "{{count}} seleccionadas",
        needs_limit_reached: "Puedes seleccionar hasta {{max}}; quita una para agregar otra.",
        priority_rank_title: "Ordena tus prioridades principales",
        priority_rank_intro: "De lo que seleccionaste, arrastra o usa los botones para ordenar lo que más importa. La posición 1 es tu prioridad inmediata.",
        priority_rank_empty: "Selecciona al menos un elemento arriba antes de ordenarlo.",
        priority_move_up: "Subir",
        priority_move_down: "Bajar",
        priority_remove_from_rank: "Quitar del orden",
        priority_add_to_rank: "Agregar al orden",
        blockers_title: "¿Alguna de estas te está bloqueando?",
        blockers_helper: "Marca aquello sin lo cual no puedes avanzar.",
        dependencies_title: "¿Alguna depende de otra?",
        dependencies_helper: "Opcional; solo si alguna no puede empezar hasta que otra se resuelva.",
        dependency_depends_on: "Depende de",
        dependency_none: "No depende de nada más",
        dependency_owner: "¿Quién es responsable internamente?",
        dependency_owner_placeholder: "Nombre o rol (opcional)",
        dependency_approval_required: "¿Esto necesita aprobación de alguien más?",
        dependency_approval_from: "¿De quién?",
        needs_context_note: "La prioridad declarada y el orden por dependencias se muestran por separado; nunca reordenamos una para que coincida con la otra.",
        tag_add_placeholder: "Escribe un nombre y presiona Enter",
        tag_add_button: "Agregar",
        tag_remove: "Quitar {{tag}}",
        tag_limit_reached: "Puedes agregar hasta {{max}}.",
        counterparty_name_placeholder: "Nombre de la empresa o grupo",
        counterparty_restriction_label: "¿Qué tipo de restricción?",
        counterparty_restriction_cannot_contract: "No podemos contratarlos",
        counterparty_restriction_do_not_share_information: "No podemos compartirles información",
        counterparty_restriction_both: "Ambas",
        counterparty_add_button: "Agregar",
        counterparty_remove: "Quitar {{name}}",
        counterparty_limit_reached: "Puedes agregar hasta {{max}}.",
        counterparty_confidential_note: "Se mantiene confidencial y limitado a este proyecto — nunca se comparte con proveedores.",
        structured_echo_question: "¿Esto coincide con lo que quisiste decir?",
        structured_echo_yes: "Sí, así es",
        structured_echo_edit: "No exactamente; déjame elegir",
        review_title_default: "Revisa cómo entendimos tu proyecto",
        review_edit: "Editar",
        review_confirm: "Confirmar y continuar",
        review_empty: "Sin responder",
        note_tab_empty: "\ud83d\udcdd Dejar una nota",
        note_tab_filled: "\ud83d\udcdd Nota agregada",
        note_placeholder: "\u00bfAlgo m\u00e1s sobre esto que debamos saber? Opcional.",
        note_close: "Cerrar",
        review_note_prefix: "Nota registrada:",
      },
    },
  },
};

export const EMAIL_COPY: QuestionBankBundle["emails"] = {
  // Owner-approved verbatim (subject, core sentence, CTA); the access-until clause is the only
  // addition, needed for the functional "how long is this saved" fact this email exists to give.
  resume_link: {
    copy: {
      en: {
        subject: "Your beeside assessment is saved",
        body: "Hi {{preferred_name}}, your First Assessment is saved. You can continue exactly where you left off — it’s available until {{access_until}}.",
        cta: "Continue my assessment",
      },
      es: {
        subject: "Tu evaluación de beeside está guardada",
        body: "Hola {{preferred_name}}, tu First Assessment está guardado. Puedes continuar exactamente donde te quedaste — está disponible hasta el {{access_until}}.",
        cta: "Continuar mi evaluación",
      },
    },
  },
  existing_assessment_link: {
    copy: {
      en: {
        subject: "Your private beeside link",
        body: "Hi {{preferred_name}}, use this private link to continue your saved First Assessment or start a new project.",
        cta: "Open my assessment",
      },
      es: {
        subject: "Tu enlace privado de beeside",
        body: "Hola {{preferred_name}}, usa este enlace privado para continuar tu First Assessment guardado o iniciar un nuevo proyecto.",
        cta: "Abrir mi evaluación",
      },
    },
  },
  // Lifecycle emails (Handoff v1 §18–§19). Each shows the exact date instead of asking the person to
  // count days; the contextual follow-up is help, never a sales push, and its primary action is
  // always to continue the First Assessment (Precision needs the First Assessment baseline).
  access_reminder_day10: {
    copy: {
      en: {
        subject: "Your First Assessment is saved for {{days_left}} more days",
        body: "Hi {{preferred_name}}, your First Assessment is saved for {{days_left}} more days — it is available until {{access_until}}. Need more time? You can continue now or keep it available for longer.",
        cta: "Continue my assessment",
      },
      es: {
        subject: "Tu First Assessment estará guardado {{days_left}} días más",
        body: "Hola {{preferred_name}}, tu First Assessment estará guardado {{days_left}} días más — está disponible hasta el {{access_until}}. ¿Necesitas más tiempo? Puedes continuar ahora o mantenerlo disponible por más tiempo.",
        cta: "Continuar mi evaluación",
      },
    },
  },
  access_recovery_day21: {
    copy: {
      en: {
        subject: "We can still restore your First Assessment",
        body: "Hi {{preferred_name}}, we don’t want you to lose the work you already started. Your First Assessment is no longer active, but we can still restore your progress until {{recoverable_until}}.",
        cta: "Recover my assessment",
      },
      es: {
        subject: "Todavía podemos restaurar tu First Assessment",
        body: "Hola {{preferred_name}}, no queremos que pierdas el trabajo que ya empezaste. Tu First Assessment ya no está activo, pero todavía podemos restaurar tu avance hasta el {{recoverable_until}}.",
        cta: "Recuperar mi evaluación",
      },
    },
  },
  access_followup_missing_information: {
    copy: {
      en: {
        subject: "It’s fine to answer with what you know today",
        body: "Hi {{preferred_name}}, your First Assessment is available until {{access_until}}. You don’t need every detail to finish it — answer with what you know today and mark anything you’re unsure about. Once your First Assessment is complete, beeside Precision can help validate, clarify and complete the missing information.",
        cta: "Continue First Assessment",
        secondary_cta: "How Precision works",
      },
      es: {
        subject: "Está bien responder con lo que sabes hoy",
        body: "Hola {{preferred_name}}, tu First Assessment está disponible hasta el {{access_until}}. No necesitas cada detalle para terminarlo: responde con lo que sabes hoy y marca lo que todavía no tengas claro. Cuando completes tu First Assessment, beeside Precision puede ayudarte a validar, aclarar y completar la información que falte.",
        cta: "Continuar First Assessment",
        secondary_cta: "Cómo funciona Precision",
      },
    },
  },
  access_followup_project_not_structured: {
    copy: {
      en: {
        subject: "A structured plan isn’t required to finish",
        body: "Hi {{preferred_name}}, your First Assessment is available until {{access_until}}. You don’t need a fully structured project to complete it — your Snapshot will show what already looks defined and what needs attention. If you later want support shaping the project, beeside’s growth and strategic advisory can help.",
        cta: "Continue First Assessment",
        secondary_cta: "About strategic advisory",
      },
      es: {
        subject: "No necesitas un plan estructurado para terminar",
        body: "Hola {{preferred_name}}, tu First Assessment está disponible hasta el {{access_until}}. No necesitas un proyecto totalmente estructurado para completarlo: tu Snapshot mostrará qué ya se ve definido y qué necesita atención. Si más adelante quieres apoyo para darle forma al proyecto, la asesoría estratégica y de crecimiento de beeside puede ayudarte.",
        cta: "Continuar First Assessment",
        secondary_cta: "Sobre la asesoría estratégica",
      },
    },
  },
  access_followup_unsure_market_timing: {
    copy: {
      en: {
        subject: "Market and timing questions are normal at this stage",
        body: "Hi {{preferred_name}}, your First Assessment is available until {{access_until}}. You can answer with your current view — “Not sure” is a valid answer. Once you have your Snapshot, beeside’s market entry expertise can help clarify market and timing questions.",
        cta: "Continue First Assessment",
        secondary_cta: "About market entry support",
      },
      es: {
        subject: "Las dudas de mercado y tiempos son normales en esta etapa",
        body: "Hola {{preferred_name}}, tu First Assessment está disponible hasta el {{access_until}}. Puedes responder con tu visión actual: “No estoy seguro” es una respuesta válida. Cuando tengas tu Snapshot, la experiencia de beeside en entrada a mercados puede ayudarte a aclarar las dudas de mercado y tiempos.",
        cta: "Continuar First Assessment",
        secondary_cta: "Sobre el apoyo de entrada a mercados",
      },
    },
  },
  access_followup_something_else: {
    copy: {
      en: {
        subject: "Your First Assessment is still here for you",
        body: "Hi {{preferred_name}}, your First Assessment is available until {{access_until}}. Your progress is saved, so you can continue whenever it suits you.",
        cta: "Continue First Assessment",
      },
      es: {
        subject: "Tu First Assessment sigue aquí para ti",
        body: "Hola {{preferred_name}}, tu First Assessment está disponible hasta el {{access_until}}. Tu avance está guardado, así que puedes continuar cuando te convenga.",
        cta: "Continuar First Assessment",
      },
    },
  },
  // COPY REVIEW — restrained provisional copy (Level 2 MVP §7, Communications). Confirms an
  // immediate +15/+30 extension the moment it is granted; the day-after contextual follow-up
  // (access_followup_*, above) still applies separately.
  access_extension_confirmed: {
    copy: {
      en: {
        subject: "Your First Assessment access has been extended",
        body: "Hi {{preferred_name}}, we’ve extended your First Assessment. It’s now available until {{access_until}} — take the time you need.",
        cta: "Continue my assessment",
      },
      es: {
        subject: "Ampliamos el acceso a tu First Assessment",
        body: "Hola {{preferred_name}}, ampliamos tu First Assessment. Ahora está disponible hasta el {{access_until}} — tómate el tiempo que necesites.",
        cta: "Continuar mi evaluación",
      },
    },
  },
  // COPY REVIEW — restrained provisional copy. First of two warnings before a free (never-Premium)
  // First Assessment's temporary retention elapses and its client data is purged (Handoff v1 §18's
  // retention lifecycle). See retention_reminder_final for the closer warning.
  retention_reminder: {
    copy: {
      en: {
        subject: "Your First Assessment data will be removed soon",
        body: "Hi {{preferred_name}}, we keep First Assessment information for a limited time when a project hasn’t continued into Premium. Your information will be removed on {{retention_until}}. Sign in any time before then to review your options.",
        cta: "Review my First Assessment",
      },
      es: {
        subject: "La información de tu First Assessment se eliminará pronto",
        body: "Hola {{preferred_name}}, conservamos la información de tu First Assessment por un tiempo limitado cuando el proyecto no continúa a Premium. Tu información se eliminará el {{retention_until}}. Ingresa antes de esa fecha para revisar tus opciones.",
        cta: "Revisar mi First Assessment",
      },
    },
  },
  // COPY REVIEW — restrained provisional copy. The closer, final warning before the same purge
  // (see retention_reminder above) — the last point at which activating Premium or continuing the
  // First Assessment still keeps the data from being removed.
  retention_reminder_final: {
    copy: {
      en: {
        subject: "Last chance: your First Assessment data will be removed on {{retention_until}}",
        body: "Hi {{preferred_name}}, this is a final reminder: your First Assessment information will be removed on {{retention_until}}. Sign in before then if you’d like to review your options.",
        cta: "Review my First Assessment",
      },
      es: {
        subject: "Última oportunidad: tu información se eliminará el {{retention_until}}",
        body: "Hola {{preferred_name}}, este es un último recordatorio: la información de tu First Assessment se eliminará el {{retention_until}}. Ingresa antes de esa fecha si quieres revisar tus opciones.",
        cta: "Revisar mi First Assessment",
      },
    },
  },
};
