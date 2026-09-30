import type { Locale } from "../fa/engine/bundle-types";
import type { ValueBridgeKey } from "./value-bridges";

/**
 * Expansion Snapshot template — schema_version 1 (Functional Specification v1 §6, Master Build Guide
 * Appendix C, approved Expansion Snapshot reference 2026-09-09). Section order and content are
 * fixed by the composer; this bundle carries only the localized copy, the deterministic summary
 * phrases and the delivery email.
 */
export interface SnapshotTemplateCopy {
  eyebrow: string;
  headline: string;
  generated_on: string;
  summary_goal: string;
  summary_market: string;
  summary_stage: string;
  facts_company: string;
  facts_market: string;
  facts_launch: string;
  facts_priority: string;
  quarter_format: string;
  panel_defined_title: string;
  panel_defined_intro: string;
  panel_needs_title: string;
  panel_needs_intro: string;
  panel_critical_title: string;
  panel_critical_intro: string;
  priority_title: string;
  reconcile_title: string;
  decision_title: string;
  shape_title: string;
  shape_customer_contract: string;
  shape_firm_commitment: string;
  one_thing_title: string;
  capabilities_title: string;
  capabilities_intro: string;
  disclosure_title: string;
  disclosure: string;
  /** "What Matters Now" (Level 2 MVP §3.3): declared priority order, kept separate from `pathway`'s
   *  dependency-derived sequence — neither is ever silently reordered by the other. */
  priorities_title: string;
  priorities_intro: string;
  priorities_immediate_label: string;
  priorities_next_label: string;
  priorities_blocker_label: string;
  /** Plain label, no placeholder — the frontend pairs it with the dependency's own label, the same
   *  way `facts_company` pairs with a `facts[].value` elsewhere in this Snapshot. */
  priorities_depends_on_label: string;
  /** Plain labels, paired the same way with `items[].owner` / `items[].approvalFrom`. */
  priorities_owner_label: string;
  priorities_approval_label: string;
  /** "Your Initial Path" (Level 2 MVP §3.4): the reusable NOW → DEFINE → ENABLE → LAUNCH PathwayDiagram. */
  pathway_title: string;
  pathway_intro: string;
  pathway_stage_now: string;
  pathway_stage_define: string;
  pathway_stage_enable: string;
  pathway_stage_launch: string;
  /** "Capability Landscape" (Level 2 MVP §3.5): every declared need with its coverage status — no
   *  provider names, and selection is never framed as purchase intent. */
  needs_landscape_title: string;
  needs_landscape_intro: string;
  needs_status_covered_internally: string;
  needs_status_covered_by_provider: string;
  needs_status_in_progress: string;
  needs_status_needs_resolution: string;
  needs_status_needs_confirmation: string;
  /** Dual Expansion Profile (Macroblock 7, Snapshot Runtime Convergence): the merged dumbbell/radar
   *  section carrying both series — Definition & Evidence (already-existing tier copy) and its new
   *  Execution Demand series. */
  dual_profile_title: string;
  dual_profile_intro: string;
  definition_series_label: string;
  demand_series_label: string;
  /** One line of client-facing context per NOT_EVALUABLE reason (execution-demand.ts's
   *  `NotEvaluableReason`) — shown next to a dimension's Execution Demand exactly when it has no
   *  value, the same axis-note pattern the frozen artifact uses for Activation Planning. */
  demand_note_no_defensible_signal: string;
  demand_note_project_path_not_confirmed: string;
  demand_note_insufficient_evidence: string;
  demand_note_not_applicable: string;
  /** Value Bridges ("beeside can help") shared eyebrow — per-bridge heading/body live in
   *  `valueBridges.copy` below, approved verbatim in `snapshot-etapa2-value-bridges-ronda-final.md`. */
  value_bridge_eyebrow: string;
}

/** Approved Value Bridge copy (`snapshot-etapa2-value-bridges-ronda-final.md`, Product Owner decision
 *  2026-09-24, formally closed) — verbatim, never generated. Keyed by `ValueBridgeKey`
 *  (`./value-bridges.ts`); the approved document itself gives the client-facing bridge text in
 *  English only, so the Spanish translations below are this bundle's own (same convention as every
 *  other `copy.es` string in this file). */
export interface SnapshotValueBridgeCopy {
  heading: string;
  body: string;
}

export interface SnapshotPhrases {
  goal: Record<string, string>;
  stage: Record<string, string>;
  timing: Record<string, string>;
}

export interface SnapshotTemplateBundle {
  schema_version: 1;
  product: "first_assessment_snapshot";
  locales: Locale[];
  variables: string[];
  copy: Record<Locale, SnapshotTemplateCopy>;
  phrases: { copy: Record<Locale, SnapshotPhrases> };
  /** Approved Value Bridge library (Macroblock 7) — see `SnapshotValueBridgeCopy` above. */
  valueBridges: { copy: Record<Locale, Record<ValueBridgeKey, SnapshotValueBridgeCopy>> };
  /** `active` optional, defaults true — see the matching field on QuestionBankBundle["emails"]. */
  emails: Record<string, { active?: boolean; copy: Record<Locale, { subject: string; body: string; cta: string }> }>;
  /** Private Snapshot link validity (days from issuance). Optional: absent → 60 (policy pending). */
  links?: { snapshot_link_days?: number };
}

/** Bumped to st-1.1.0 (Macroblock 7): adds the Dual Expansion Profile / demand-note copy and the
 *  Value Bridge library. Existing stored Snapshots keep whichever version they were generated with
 *  (`ComposeInput.versions.snapshotTemplate`, recorded at generation time) — this bump only affects
 *  Snapshots generated from this point forward. */
export const FA_SNAPSHOT_TEMPLATE_VERSION = "st-1.1.0";

export function buildSnapshotTemplateBundle(): SnapshotTemplateBundle {
  return {
    schema_version: 1,
    product: "first_assessment_snapshot",
    locales: ["en", "es"],
    variables: ["company_name", "goal_phrase", "markets", "stage_phrase", "timing_clause", "launch", "quarter", "year", "date", "preferred_name"],
    copy: {
      en: {
        eyebrow: "Your Expansion Snapshot",
        headline: "Your project, in perspective.",
        generated_on: "Generated on {{date}}",
        summary_goal: "{{company_name}} is looking to {{goal_phrase}}.",
        summary_market: "{{company_name}} is looking to {{goal_phrase}} in {{markets}}.",
        summary_stage: "The project is {{stage_phrase}}{{timing_clause}}.",
        facts_company: "Company",
        facts_market: "Target market",
        facts_launch: "Target launch",
        facts_priority: "Your immediate priority",
        quarter_format: "Q{{quarter}} {{year}}",
        panel_defined_title: "Well defined",
        panel_defined_intro: "You have a solid foundation in these areas.",
        panel_needs_title: "Needs attention",
        panel_needs_intro: "These areas require further definition or validation.",
        panel_critical_title: "Resolve early",
        panel_critical_intro: "Addressing these early helps avoid delays later.",
        priority_title: "Your immediate priority",
        reconcile_title: "Something to reconcile",
        decision_title: "The decision ahead",
        shape_title: "What could shape the plan",
        shape_customer_contract: "An existing customer commitment",
        shape_firm_commitment: "A firm launch commitment",
        one_thing_title: "One thing you don’t want to get wrong",
        capabilities_title: "Relevant capabilities for your expansion",
        capabilities_intro: "Based on what you shared, these capabilities are relevant to your project.",
        disclosure_title: "About this Snapshot",
        disclosure:
          "This initial interpretation is based on the information you shared with us. As we learn more about your project, beeside can provide greater context, precision and value to help you move forward.",
        priorities_title: "What matters now",
        priorities_intro: "Your declared priorities, with the dependencies and approvals they involve.",
        priorities_immediate_label: "Immediate priority",
        priorities_next_label: "Next priorities",
        priorities_blocker_label: "Blocker",
        priorities_depends_on_label: "Depends on",
        priorities_owner_label: "Internal owner",
        priorities_approval_label: "Needs approval from",
        pathway_title: "Your initial path",
        pathway_intro: "A starting sequence based on what you shared — not a rigid methodology or a guarantee.",
        pathway_stage_now: "Now",
        pathway_stage_define: "Define",
        pathway_stage_enable: "Enable",
        pathway_stage_launch: "Launch",
        needs_landscape_title: "Capability landscape",
        needs_landscape_intro: "Where things stand today across what you told us your project needs.",
        needs_status_covered_internally: "Covered internally",
        needs_status_covered_by_provider: "Covered by an existing provider",
        needs_status_in_progress: "In progress",
        needs_status_needs_resolution: "Still needs to be resolved",
        needs_status_needs_confirmation: "Need to confirm whether it applies",
        dual_profile_title: "Definition & Evidence vs. Execution Demand",
        dual_profile_intro: "See where your expansion plan is well defined and where execution will demand more from the business.",
        definition_series_label: "Definition & Evidence",
        demand_series_label: "Execution Demand",
        demand_note_no_defensible_signal:
          "There isn't yet a structured way to measure execution demand for this area — shown as not evaluable rather than assumed.",
        demand_note_project_path_not_confirmed: "Sequencing demand for this axis depends on your declared priority order, which isn't confirmed yet — shown as not evaluable rather than assumed.",
        demand_note_insufficient_evidence: "Not enough of this area has been answered yet to show execution demand — shown as not evaluable rather than assumed.",
        demand_note_not_applicable: "This didn't apply to your project, so execution demand isn't shown for it.",
        value_bridge_eyebrow: "beeside can help",
      },
      es: {
        eyebrow: "Tu Expansion Snapshot",
        headline: "Tu proyecto, en perspectiva.",
        generated_on: "Generado el {{date}}",
        summary_goal: "{{company_name}} busca {{goal_phrase}}.",
        summary_market: "{{company_name}} busca {{goal_phrase}} en {{markets}}.",
        summary_stage: "El proyecto está {{stage_phrase}}{{timing_clause}}.",
        facts_company: "Empresa",
        facts_market: "Mercado objetivo",
        facts_launch: "Inicio objetivo",
        facts_priority: "Tu prioridad inmediata",
        quarter_format: "T{{quarter}} {{year}}",
        panel_defined_title: "Bien definido",
        panel_defined_intro: "Tienes una base sólida en estas áreas.",
        panel_needs_title: "Necesita atención",
        panel_needs_intro: "Estas áreas requieren más definición o validación.",
        panel_critical_title: "Conviene resolver desde ahora",
        panel_critical_intro: "Atenderlas desde ahora ayuda a evitar retrasos más adelante.",
        priority_title: "Tu prioridad inmediata",
        reconcile_title: "Algo por conciliar",
        decision_title: "La decisión que sigue",
        shape_title: "Lo que puede condicionar el plan",
        shape_customer_contract: "Un compromiso existente con un cliente",
        shape_firm_commitment: "Un compromiso firme de fecha de inicio",
        one_thing_title: "Algo que no quieres equivocar",
        capabilities_title: "Capacidades relevantes para tu expansión",
        capabilities_intro: "Con base en lo que compartiste, estas capacidades son relevantes para tu proyecto.",
        disclosure_title: "Sobre este Snapshot",
        disclosure:
          "Esta interpretación inicial se basa en la información que nos compartiste. Conforme conozcamos más sobre tu proyecto, beeside podrá aportar mayor contexto, precisión y valor para ayudarte a avanzar.",
        priorities_title: "Lo que importa ahora",
        priorities_intro: "Tus prioridades declaradas, con las dependencias y aprobaciones que implican.",
        priorities_immediate_label: "Prioridad inmediata",
        priorities_next_label: "Siguientes prioridades",
        priorities_blocker_label: "Bloqueante",
        priorities_depends_on_label: "Depende de",
        priorities_owner_label: "Responsable interno",
        priorities_approval_label: "Necesita aprobación de",
        pathway_title: "Tu ruta inicial",
        pathway_intro: "Una secuencia de partida con base en lo que compartiste — no es una metodología rígida ni una garantía.",
        pathway_stage_now: "Ahora",
        pathway_stage_define: "Definir",
        pathway_stage_enable: "Habilitar",
        pathway_stage_launch: "Lanzar",
        needs_landscape_title: "Panorama de capacidades",
        needs_landscape_intro: "Cómo está hoy cada elemento de lo que nos dijiste que necesita tu proyecto.",
        needs_status_covered_internally: "Cubierto internamente",
        needs_status_covered_by_provider: "Cubierto por un proveedor existente",
        needs_status_in_progress: "En progreso",
        needs_status_needs_resolution: "Todavía necesita resolverse",
        needs_status_needs_confirmation: "Falta confirmar si aplica",
        dual_profile_title: "Definición y Evidencia vs. Demanda de Ejecución",
        dual_profile_intro: "Aquí ves qué tan definido está tu plan de expansión y dónde la ejecución exigirá más del negocio.",
        definition_series_label: "Definición y Evidencia",
        demand_series_label: "Demanda de Ejecución",
        demand_note_no_defensible_signal:
          "Todavía no existe una forma estructurada de medir la demanda de ejecución en esta área — se muestra como no evaluable en lugar de asumirla.",
        demand_note_project_path_not_confirmed: "La demanda de secuenciación de este eje depende de tu orden de prioridades declarado, que aún no está confirmado — se muestra como no evaluable en lugar de asumirla.",
        demand_note_insufficient_evidence: "Todavía no se ha respondido lo suficiente en esta área para mostrar la demanda de ejecución — se muestra como no evaluable en lugar de asumirla.",
        demand_note_not_applicable: "Esto no aplicó a tu proyecto, así que no se muestra demanda de ejecución para este eje.",
        value_bridge_eyebrow: "beeside puede ayudarte",
      },
    },
    phrases: {
      copy: {
        en: {
          goal: {
            enter_first_time: "enter a new market for the first time",
            start_selling_locally: "start selling locally",
            set_up_local_operation: "set up a local operation",
            find_customers_partners: "find customers or commercial partners",
            build_local_supply_chain: "build a local supply chain",
            expand_existing_operation: "expand an existing operation",
            evaluate_entry: "evaluate entering a new market",
            other: "expand into a new market",
          },
          stage: {
            exploring: "at an exploratory stage",
            business_case: "building its business case",
            validating: "validating key assumptions",
            preparing_entry: "preparing for entry",
            already_executing: "already in execution",
            already_operating: "already operating in the market",
          },
          timing: {
            firm_commitment: ", with a firm commitment for {{launch}}",
            target_date: ", targeting {{launch}}",
            approximate_timeframe: ", with an approximate timeframe of {{launch}}",
          },
        },
        es: {
          goal: {
            enter_first_time: "entrar por primera vez a un nuevo mercado",
            start_selling_locally: "empezar a vender localmente",
            set_up_local_operation: "establecer una operación local",
            find_customers_partners: "encontrar clientes o socios comerciales",
            build_local_supply_chain: "construir una cadena de suministro local",
            expand_existing_operation: "ampliar una operación existente",
            evaluate_entry: "evaluar la entrada a un nuevo mercado",
            other: "expandirse a un nuevo mercado",
          },
          stage: {
            exploring: "en una etapa exploratoria",
            business_case: "construyendo su caso de negocio",
            validating: "validando supuestos clave",
            preparing_entry: "preparando su entrada",
            already_executing: "ya en ejecución",
            already_operating: "ya operando en el mercado",
          },
          timing: {
            firm_commitment: ", con un compromiso firme para {{launch}}",
            target_date: ", con {{launch}} como objetivo",
            approximate_timeframe: ", con un plazo aproximado de {{launch}}",
          },
        },
      },
    },
    // Approved verbatim from snapshot-etapa2-value-bridges-ronda-final.md (Product Owner decision
    // 2026-09-24, formally closed) for `en`. The `es` copy is this bundle's own translation — the
    // approved document only gives English client-facing bridge text, matching the convention every
    // other `copy.es` block in this file already follows for its own translations.
    valueBridges: {
      copy: {
        en: {
          sherpa: {
            heading: "Your Sherpa",
            body: "Your Sherpa guides and coordinates the path to service activation — acting as your point of contact with the provider ecosystem, and helping reduce the operational burden and need for local presence during the process.",
          },
          operation_hub_productivity: {
            heading: "Operation Hub",
            body: "Operation Hub brings the work of your expansion into one place — tasks, documents, conversations, goals, calendars and deliverables — so your team can manage the project with greater visibility and continuity.",
          },
          operation_hub_secure: {
            heading: "Operation Hub",
            body: "Operation Hub gives your team a secure, protected environment to share sensitive project information and collaborate with confidence throughout the expansion.",
          },
          the_hive: {
            heading: "The Hive",
            body: "The Hive gives you access to beeside's curated ecosystem of trusted local providers — matched to the capabilities your project requires, so you don't have to source and vet them on your own.",
          },
          beeside_verified: {
            heading: "beeside Verified",
            body: "Already have a provider in mind? beeside Verified can assess its capabilities, credentials, local presence and compliance against the requirements you've defined for this project.",
          },
          strategic_advisory: {
            heading: "Strategic Advisory",
            body: "Some expansion decisions require more than coordination. Strategic Advisory brings in expertise focused on the specific issue — framing the question, weighing the options and supporting a better-informed decision.",
          },
        },
        es: {
          sherpa: {
            heading: "Tu Sherpa",
            body: "Tu Sherpa guía y coordina el camino hacia la activación de servicios — actuando como tu punto de contacto con el ecosistema de proveedores, y ayudando a reducir la carga operativa y la necesidad de presencia local durante el proceso.",
          },
          operation_hub_productivity: {
            heading: "Operation Hub",
            body: "Operation Hub reúne el trabajo de tu expansión en un solo lugar — tareas, documentos, conversaciones, objetivos, calendarios y entregables — para que tu equipo gestione el proyecto con mayor visibilidad y continuidad.",
          },
          operation_hub_secure: {
            heading: "Operation Hub",
            body: "Operation Hub le da a tu equipo un entorno seguro y protegido para compartir información sensible del proyecto y colaborar con confianza durante toda la expansión.",
          },
          the_hive: {
            heading: "The Hive",
            body: "The Hive te da acceso al ecosistema curado de proveedores locales de confianza de beeside — emparejados con las capacidades que tu proyecto requiere, para que no tengas que buscarlos y evaluarlos por tu cuenta.",
          },
          beeside_verified: {
            heading: "beeside Verified",
            body: "¿Ya tienes un proveedor en mente? beeside Verified puede evaluar sus capacidades, credenciales, presencia local y cumplimiento frente a los requisitos que definiste para este proyecto.",
          },
          strategic_advisory: {
            heading: "Strategic Advisory",
            body: "Algunas decisiones de expansión requieren más que coordinación. Strategic Advisory aporta experiencia enfocada en el tema específico — enmarcando la pregunta, evaluando las opciones y apoyando una decisión mejor informada.",
          },
        },
      },
    },
    // Owner-approved verbatim (subject, core sentence, CTA), plus the Precision-continuation
    // sentence the owner asked this email to carry: continuing builds on what was already shared,
    // never a restart from zero.
    emails: {
      snapshot_ready: {
        copy: {
          en: {
            subject: "Your beeside Expansion Snapshot",
            body: "Hi {{preferred_name}}, your First Assessment is complete. Your Expansion Snapshot gives you a first view of what looks defined, what needs attention and which areas may need to be resolved early. If you continue with beeside Precision, we build on what you’ve already shared — there’s no need to start over.",
            cta: "View my Expansion Snapshot",
          },
          es: {
            subject: "Tu Expansion Snapshot de beeside",
            body: "Hola {{preferred_name}}, tu First Assessment está completo. Tu Expansion Snapshot te da una primera visión de qué parece definido, qué necesita atención y qué áreas conviene resolver desde ahora. Si continúas con beeside Precision, partimos de lo que ya compartiste — no es necesario empezar de nuevo.",
            cta: "Ver mi Expansion Snapshot",
          },
        },
      },
      // COPY REVIEW — restrained provisional copy (Level 2 MVP §7, Communications). Sourced from the
      // pinned snapshot_template_version (like snapshot_ready above) since activation only happens
      // after a project already has a Snapshot; repeats the same no-restart-from-zero reassurance.
      premium_activation_confirmed: {
        copy: {
          en: {
            subject: "Your beeside Premium is active",
            body: "Hi {{preferred_name}}, your beeside Premium is now active. We continue from what you already shared in your First Assessment — there’s no need to start over.",
            cta: "Go to my Precision workspace",
          },
          es: {
            subject: "Tu beeside Premium está activo",
            body: "Hola {{preferred_name}}, tu beeside Premium ya está activo. Continuamos a partir de lo que ya compartiste en tu First Assessment — no es necesario empezar de nuevo.",
            cta: "Ir a mi espacio de Precision",
          },
        },
      },
    },
  };
}
