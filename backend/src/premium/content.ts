/**
 * Premium transition copy (Master Build Guide v2 §12, Functional Specification v1 §16.1–§16.7).
 *
 * The consideration experience is not part of the immutable Snapshot, so its copy is versioned here
 * (premium-content-1.0.0) until the Admin Control Center (Phase 10) governs editable content. It
 * describes only the approved Premium operating model, never shows a price, and never frames
 * Premium as unlocking hidden results: the Snapshot already delivered value.
 */

export const PREMIUM_CONTENT_VERSION = "premium-content-1.0.0";
export const PREVIEW_ROOM_URL = "https://www.beeside.you/preview";
export const PREMIUM_TERMS_URL = "https://www.beeside.you/termsandconditions";

export interface PremiumCopy {
  transition: { eyebrow: string; headline: string; body: string; continue_cta: string; explore_cta: string; explore_helper: string; new_tab: string };
  consideration: {
    eyebrow: string;
    title: string;
    intro: string;
    pillars: Array<{ key: string; title: string; body: string }>;
    outcomes_title: string;
    outcomes: string[];
    candidate_line: string;
    next_cta: string;
    back: string;
  };
  activation: {
    title: string;
    points: string[];
    terms_prefix: string;
    terms_label: string;
    terms_required: string;
    activate_cta: string;
    reactivate_cta: string;
    back: string;
    error: string;
  };
  result: { pending_title: string; pending_body: string; active_title: string; active_body: string };
  status: {
    active_title: string;
    active_body: string;
    scheduled_body: string;
    lapsed_title: string;
    lapsed_body: string;
    pending_title: string;
    pending_body: string;
  };
}

export const PREMIUM_COPY: Record<"en" | "es", PremiumCopy> = {
  en: {
    transition: {
      eyebrow: "What comes next",
      headline: "You have the picture. Now let’s add precision.",
      body: "Continue with beeside Premium to validate what matters most, define your requirements and turn this first picture into clear next steps.",
      continue_cta: "Continue with Premium",
      explore_cta: "Explore Premium",
      explore_helper: "Not ready yet? See examples of the strategic products, analyses and deliverables beeside prepares.",
      new_tab: "(opens in a new tab)",
    },
    consideration: {
      eyebrow: "beeside Premium",
      title: "What changes when you continue with beeside",
      intro: "Your Snapshot shows where your project stands today. Premium builds on it — you don’t start over. These parts work as one connected process.",
      pillars: [
        {
          key: "precision",
          title: "AI-assisted Precision RFI",
          body: "Your First Assessment is the starting point. Precision clarifies requirements, validates assumptions, completes missing information, resolves important questions and prepares the activation of the right capabilities.",
        },
        {
          key: "sherpa",
          title: "Your Sherpa",
          body: "A human Sherpa works as an extension of your team — keeping continuity, coordinating next steps and dependencies, bringing in the right specialists and reducing your management burden.",
        },
        {
          key: "advisory",
          title: "Specialized strategic advisory",
          body: "Expansion expertise across landing, market entry, growth, risk and compliance, and ecosystem development, focused on what is practical for your project.",
        },
        {
          key: "operation_hub",
          title: "Operation Hub",
          body: "One environment to follow your expansion: project board, tasks, schedule, alerts, progress, documents and deliverables, and provider follow-up.",
        },
        {
          key: "ecosystem",
          title: "Trusted local ecosystem",
          body: "A curated network of local providers reviewed through beeside’s check-up process. If a capability you need isn’t there yet, beeside can search for and verify an appropriate provider before proposing it.",
        },
      ],
      outcomes_title: "What the connected ecosystem lets you do",
      outcomes: [
        "Protect management time",
        "Keep your focus on the core business",
        "Avoid building local expansion capability from zero",
        "Shorten the local learning curve",
        "Make better-informed decisions",
        "Reduce fragmentation across advisors and providers",
        "Keep visibility over the project",
        "Understand responsibilities and next steps",
        "Access specialized expertise and trusted local capabilities in one place",
      ],
      candidate_line: "Expand your business. Not your workload.",
      next_cta: "See how activation works",
      back: "Back to my Snapshot",
    },
    activation: {
      title: "Before you activate Premium",
      points: [
        "Your First Assessment becomes part of your active project.",
        "You don’t restart discovery: Precision begins from the information you already shared.",
        "A Sherpa becomes part of the process.",
        "Operation Hub becomes your project environment where it applies.",
        "Strategic advisory and local capabilities are activated according to what your project needs.",
      ],
      terms_prefix: "I accept the",
      terms_label: "Terms & Conditions",
      terms_required: "Please accept the Terms & Conditions to continue.",
      activate_cta: "Activate Premium",
      reactivate_cta: "Reactivate Premium",
      back: "Back",
      error: "We couldn’t register your request. Please try again.",
    },
    result: {
      pending_title: "Your Premium request is registered",
      pending_body: "beeside will confirm your activation with you before anything starts. Your Snapshot stays available in the meantime.",
      active_title: "Premium is active for this project",
      active_body: "Precision begins from the information you already shared. Your First Assessment and Snapshot stay exactly as they are.",
    },
    status: {
      active_title: "Your Premium project is active",
      active_body: "Your project continues in Premium with beeside. Your First Assessment and Snapshot stay exactly as they are.",
      scheduled_body: "Premium stays active until {{until}}.",
      lapsed_title: "Your Premium access has ended",
      lapsed_body: "Your project, Snapshot and history are preserved. You can reactivate Premium for this same project.",
      pending_title: "Your Premium request is registered",
      pending_body: "beeside will confirm your activation with you before anything starts.",
    },
  },
  es: {
    transition: {
      eyebrow: "Lo que sigue",
      headline: "Ya tienes la visión general. Ahora sumemos precisión.",
      body: "Continúa con beeside Premium para validar lo más importante, definir tus requerimientos y convertir esta primera visión en próximos pasos claros.",
      continue_cta: "Continuar con Premium",
      explore_cta: "Explorar Premium",
      explore_helper: "¿Todavía no estás listo? Conoce ejemplos de los productos estratégicos, análisis y entregables que prepara beeside.",
      new_tab: "(se abre en una pestaña nueva)",
    },
    consideration: {
      eyebrow: "beeside Premium",
      title: "Qué cambia cuando continúas con beeside",
      intro: "Tu Snapshot muestra dónde está hoy tu proyecto. Premium parte de ahí: no empiezas de nuevo. Estas piezas funcionan como un solo proceso conectado.",
      pillars: [
        {
          key: "precision",
          title: "Precision RFI asistido por IA",
          body: "Tu First Assessment es el punto de partida. Precision aclara requerimientos, valida supuestos, completa la información faltante, resuelve preguntas importantes y prepara la activación de las capacidades adecuadas.",
        },
        {
          key: "sherpa",
          title: "Tu Sherpa",
          body: "Un Sherpa trabaja como extensión de tu equipo: mantiene la continuidad, coordina próximos pasos y dependencias, suma a los especialistas adecuados y reduce tu carga de gestión.",
        },
        {
          key: "advisory",
          title: "Asesoría estratégica especializada",
          body: "Experiencia en expansión —aterrizaje, entrada al mercado, crecimiento, riesgo y cumplimiento, y desarrollo de ecosistema— enfocada en lo que es práctico para tu proyecto.",
        },
        {
          key: "operation_hub",
          title: "Operation Hub",
          body: "Un solo entorno para dar seguimiento a tu expansión: tablero del proyecto, tareas, calendario, alertas, avance, documentos y entregables, y seguimiento de proveedores.",
        },
        {
          key: "ecosystem",
          title: "Ecosistema local de confianza",
          body: "Una red curada de proveedores locales revisados con el proceso de verificación de beeside. Si una capacidad que necesitas todavía no está, beeside puede buscar y verificar un proveedor adecuado antes de proponerlo.",
        },
      ],
      outcomes_title: "Lo que te permite el ecosistema conectado",
      outcomes: [
        "Proteger el tiempo de la dirección",
        "Mantener el enfoque en el negocio principal",
        "Evitar construir desde cero la capacidad de expansión local",
        "Acortar la curva de aprendizaje local",
        "Tomar decisiones mejor informadas",
        "Reducir la fragmentación entre asesores y proveedores",
        "Mantener visibilidad sobre el proyecto",
        "Entender responsabilidades y próximos pasos",
        "Acceder a experiencia especializada y capacidades locales de confianza en un solo lugar",
      ],
      candidate_line: "Expande tu negocio. No tu carga de trabajo.",
      next_cta: "Ver cómo funciona la activación",
      back: "Volver a mi Snapshot",
    },
    activation: {
      title: "Antes de activar Premium",
      points: [
        "Tu First Assessment pasa a formar parte de tu proyecto activo.",
        "No reinicias el descubrimiento: Precision parte de la información que ya compartiste.",
        "Un Sherpa se integra al proceso.",
        "Operation Hub se convierte en el entorno de tu proyecto cuando aplique.",
        "La asesoría estratégica y las capacidades locales se activan según lo que necesite tu proyecto.",
      ],
      terms_prefix: "Acepto los",
      terms_label: "Términos y Condiciones",
      terms_required: "Acepta los Términos y Condiciones para continuar.",
      activate_cta: "Activar Premium",
      reactivate_cta: "Reactivar Premium",
      back: "Atrás",
      error: "No pudimos registrar tu solicitud. Inténtalo de nuevo.",
    },
    result: {
      pending_title: "Tu solicitud de Premium quedó registrada",
      pending_body: "beeside confirmará contigo la activación antes de que empiece cualquier trabajo. Mientras tanto, tu Snapshot sigue disponible.",
      active_title: "Premium está activo para este proyecto",
      active_body: "Precision parte de la información que ya compartiste. Tu First Assessment y tu Snapshot se mantienen exactamente como están.",
    },
    status: {
      active_title: "Tu proyecto Premium está activo",
      active_body: "Tu proyecto continúa en Premium con beeside. Tu First Assessment y tu Snapshot se mantienen exactamente como están.",
      scheduled_body: "Premium sigue activo hasta el {{until}}.",
      lapsed_title: "Tu acceso a Premium terminó",
      lapsed_body: "Tu proyecto, tu Snapshot y tu historial se conservan. Puedes reactivar Premium para este mismo proyecto.",
      pending_title: "Tu solicitud de Premium quedó registrada",
      pending_body: "beeside confirmará contigo la activación antes de que empiece cualquier trabajo.",
    },
  },
};
