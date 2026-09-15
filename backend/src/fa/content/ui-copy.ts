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
  welcome: {
    copy: {
      en: {
        eyebrow: "beeside First Assessment",
        headline: "Your expansion starts with a clearer picture.",
        body: "Tell us about your project. We’ll help you see what’s already defined, what needs attention and what may be worth addressing early.",
        cta: "Start my assessment",
        support: "About 10–15 minutes · Save and continue later",
        brand_statement: "Expand your business with clarity.",
      },
      es: {
        eyebrow: "beeside First Assessment",
        headline: "Tu expansión empieza con una visión más clara.",
        body: "Cuéntanos sobre tu proyecto. Te ayudaremos a ver qué ya está definido, qué necesita atención y qué conviene revisar desde ahora.",
        cta: "Iniciar mi evaluación",
        support: "Alrededor de 10–15 minutos · Guarda y continúa después",
        brand_statement: "Expande tu negocio con claridad.",
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
};

export const EMAIL_COPY: QuestionBankBundle["emails"] = {
  resume_link: {
    copy: {
      en: {
        subject: "Your beeside assessment is saved",
        body: "Hi {{preferred_name}}, your progress is saved. When you’re ready, you can continue exactly where you left off — there’s no need to start again. Your First Assessment is available until {{access_until}}.",
        cta: "Continue my assessment",
      },
      es: {
        subject: "Tu evaluación de beeside está guardada",
        body: "Hola {{preferred_name}}, tu avance está guardado. Cuando estés listo, podrás continuar exactamente donde te quedaste — no necesitas empezar de nuevo. Tu First Assessment está disponible hasta el {{access_until}}.",
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
};
