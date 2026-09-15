import type { Locale } from "../fa/engine/bundle-types";

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
  emails: Record<string, { copy: Record<Locale, { subject: string; body: string; cta: string }> }>;
}

export const FA_SNAPSHOT_TEMPLATE_VERSION = "st-1.0.0";

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
    emails: {
      snapshot_ready: {
        copy: {
          en: {
            subject: "Your beeside Expansion Snapshot is ready",
            body: "Hi {{preferred_name}}, your Expansion Snapshot is ready. You now have a first view of what looks defined, what needs attention and which areas may need to be resolved early.",
            cta: "View my Expansion Snapshot",
          },
          es: {
            subject: "Tu Expansion Snapshot de beeside está listo",
            body: "Hola {{preferred_name}}, tu Expansion Snapshot está listo. Ya tienes una primera visión de qué parece definido, qué necesita atención y qué áreas conviene resolver desde ahora.",
            cta: "Ver mi Expansion Snapshot",
          },
        },
      },
    },
  };
}
