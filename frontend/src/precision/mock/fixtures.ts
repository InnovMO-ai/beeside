/**
 * Fixture content for the in-memory adapter ONLY (fictional "Northwind Foods Ltd", a specialty food exporter expanding to Mexico).
 * This module is imported exclusively by mock/mockTransport.ts, which exists only in builds made with VITE_PRECISION_API_MODE=mock.
 */
import type { CategoryIconKey, QuickReplyIntent } from "../api/dto";

export interface Bi { en: string; es: string }
export const bi = (en: string, es: string): Bi => ({ en, es });

export interface QuickReplyFx { value: string; label: Bi; intent: QuickReplyIntent }
export interface QuestionFx {
  key: string;
  /** Label of the requirement in the CRP. */
  label: Bi;
  ask: Bi;
  qr?: QuickReplyFx[];
  blocking?: boolean;
  executionDependency?: boolean;
  section: string;
  /** Inherited from Discovery: shown for confirmation, never re-asked. */
  prefill?: { title: Bi; value: Bi };
}
export interface SectionFx { id: string; title: Bi }
export interface CategoryFx {
  id: string;
  label: Bi;
  iconKey: CategoryIconKey;
  kind: "category" | "strategic_advisory";
  intro: Bi;
  questions: QuestionFx[];
  sections: SectionFx[];
  contextLines: Bi[];
  requiredLater: Bi[];
}

export const UNKNOWN: QuickReplyFx = { value: "unknown", label: bi("I don't know yet", "Todavía no lo sé"), intent: "unknown" };
const qr = (value: string, en: string, es: string, intent: QuickReplyIntent = "answer"): QuickReplyFx => ({ value, label: bi(en, es), intent });

export const COMPANY = "Northwind Foods Ltd";

export const DISCLOSURE = bi(
  "Precision uses artificial intelligence to help structure your project. If anything it understands is not correct, you can correct it at any time.",
  "Precision usa inteligencia artificial para ayudarte a estructurar tu proyecto. Si algo de lo que entiende no es correcto, puedes corregirlo en cualquier momento.",
);

export const UNDERSTANDING_QUESTIONS: QuestionFx[] = [
  {
    key: "pa_destination_countries", section: "project", label: bi("Destination", "Destino"),
    ask: bi("With what you told us in Discovery, I understand your destination is Mexico. Is that still right?", "Con lo que nos contaste en Discovery, entiendo que tu destino es México. ¿Sigue siendo así?"),
    prefill: { title: bi("Destination", "Destino"), value: bi("Mexico", "México") },
  },
  {
    key: "pa_project_objective", section: "project", label: bi("Objective", "Objetivo"),
    ask: bi("What do you want to achieve in Mexico during the first year? I ask because it decides which services matter most.", "¿Qué quieres lograr en México durante el primer año? Te lo pregunto porque define qué servicios pesan más."),
    qr: [
      qr("retail", "Start selling to retail chains", "Empezar a vender a cadenas de retail"),
      qr("distributor", "Find a local distributor", "Encontrar un distribuidor local"),
      qr("test", "Test the market with a first shipment", "Probar el mercado con un primer envío"),
      UNKNOWN,
    ],
  },
  {
    key: "pa_expansion_product_or_service", section: "project", label: bi("Product or service", "Producto o servicio"),
    ask: bi(`${COMPANY} exports specialty food products, such as olive oil and preserves. Is that what you want to bring to Mexico?`, `${COMPANY} exporta alimentos especializados, como aceite de oliva y conservas. ¿Es eso lo que quieres llevar a México?`),
    prefill: { title: bi("Product", "Producto"), value: bi("Specialty food products (olive oil and preserves)", "Alimentos especializados (aceite de oliva y conservas)") },
  },
  {
    key: "pa_operating_entity", section: "project", label: bi("Operating entity", "Entidad de operación"),
    ask: bi("Do you already have an entity in Mexico, or will you operate through a distributor?", "¿Ya cuentas con una entidad en México o vas a operar a través de un distribuidor?"),
    qr: [
      qr("entity", "We already have an entity", "Ya tenemos una entidad"),
      qr("distributor", "We will use a distributor", "Vamos a usar un distribuidor"),
      UNKNOWN,
    ],
  },
  {
    key: "pa_time_window", section: "project", label: bi("Time window", "Ventana de tiempo"),
    ask: bi("You mentioned a first shipment in the second quarter of next year. Is that still the plan?", "Mencionaste un primer envío en el segundo trimestre del próximo año. ¿Sigue siendo el plan?"),
    prefill: { title: bi("Time window", "Ventana de tiempo"), value: bi("First shipment in the second quarter of next year", "Primer envío en el segundo trimestre del próximo año") },
  },
  {
    key: "pa_critical_decisions", section: "project", label: bi("Open decisions", "Decisiones abiertas"),
    ask: bi("Is there a decision still open that could change the plan, for example who will act as importer?", "¿Hay alguna decisión abierta que podría cambiar el plan, por ejemplo quién actuará como importador?"),
    qr: [
      qr("importer", "Yes, who will act as importer", "Sí, quién actuará como importador"),
      qr("none", "No open decisions", "No hay decisiones abiertas"),
      UNKNOWN,
    ],
  },
];

export const CATEGORY_ORDER = ["logistics", "international_trade_customs", "corporate_legal_admin", "strategic_advisory"];

export const CATEGORIES: Record<string, CategoryFx> = {
  logistics: {
    id: "logistics", iconKey: "logistics", kind: "category",
    label: bi("Logistics", "Logística"),
    intro: bi("Let's define your logistics for Mexico. I will ask one thing at a time.", "Vamos a definir tu logística hacia México. Te preguntaré una cosa a la vez."),
    sections: [
      { id: "flows", title: bi("Flows and transport", "Flujos y transporte") },
      { id: "handling", title: bi("Handling and storage", "Manejo y almacenaje") },
    ],
    contextLines: [bi("Destination: Mexico", "Destino: México"), bi("Scope: international freight for finished food products", "Alcance: transporte internacional de productos alimenticios terminados")],
    requiredLater: [bi("Shelf life of each product, needed when planning transport times.", "Vida útil de cada producto, necesaria al planear los tiempos de transporte.")],
    questions: [
      { key: "logistics_flows", section: "flows", blocking: true, label: bi("Flows to move", "Flujos que mover"),
        ask: bi("Which flows do you need to move between the United Kingdom and Mexico? I start here because everything else depends on it.", "¿Qué flujos necesitas mover entre el Reino Unido y México? Empiezo por aquí porque todo lo demás depende de esto."),
        qr: [qr("goods", "Finished goods to Mexico", "Producto terminado hacia México"), qr("goods_returns", "Finished goods and returns", "Producto terminado y devoluciones"), UNKNOWN] },
      { key: "logistics_mode", section: "flows", label: bi("Transport modes considered", "Modos de transporte considerados"),
        ask: bi("Which transport modes have you considered?", "¿Qué modos de transporte has considerado?"),
        qr: [qr("sea", "Sea freight", "Transporte marítimo"), qr("air", "Air freight", "Transporte aéreo"), qr("both", "Sea and air", "Marítimo y aéreo"), UNKNOWN] },
      { key: "logistics_temperature", section: "handling", executionDependency: true, label: bi("Temperature control", "Control de temperatura"),
        ask: bi("Do your products need temperature control during transport?", "¿Tus productos necesitan control de temperatura durante el transporte?"),
        qr: [qr("ambient", "Ambient only", "Solo temperatura ambiente"), qr("chilled", "Some need chilled transport", "Algunos necesitan transporte refrigerado"), UNKNOWN] },
      { key: "logistics_volume", section: "flows", executionDependency: true, label: bi("Shipments per month in the first year", "Envíos al mes durante el primer año"),
        ask: bi("How many shipments do you expect to make per month during the first year?", "¿Cuántos envíos esperas hacer al mes durante el primer año?"),
        qr: [UNKNOWN] },
      { key: "logistics_responsibility", section: "flows", label: bi("Who arranges the transport", "Quién organiza el transporte"),
        ask: bi("Who will arrange the transport to Mexico: you, your buyer, or both?", "¿Quién organizará el transporte a México: tú, tu comprador o ambos?"),
        qr: [qr("us", "We do", "Nosotros"), qr("buyer", "Our buyer", "Nuestro comprador"), qr("shared", "Both", "Ambos"), UNKNOWN] },
      { key: "logistics_storage", section: "handling", label: bi("Storage in Mexico", "Almacenaje en México"),
        ask: bi("Will you need storage in Mexico before delivery to your buyers?", "¿Necesitarás almacenaje en México antes de entregar a tus compradores?"),
        qr: [qr("yes", "Yes", "Sí"), qr("no", "No", "No"), UNKNOWN] },
      { key: "logistics_delivery", section: "handling", label: bi("First delivery point in Mexico", "Primer punto de entrega en México"),
        ask: bi("Where will your goods be delivered first in Mexico?", "¿Dónde se entregarán primero tus productos en México?") },
      { key: "logistics_special", section: "handling", label: bi("Special handling", "Manejo especial"),
        ask: bi("Is there any special handling, such as fragile products or short shelf life?", "¿Hay algún manejo especial, como productos frágiles o de vida útil corta?"),
        qr: [qr("none", "No special handling", "Sin manejo especial"), UNKNOWN] },
    ],
  },
  international_trade_customs: {
    id: "international_trade_customs", iconKey: "international_trade_customs", kind: "category",
    label: bi("International Trade and Customs", "Comercio exterior y aduanas"),
    intro: bi("Let's cover the import side in Mexico. One question at a time.", "Vamos a cubrir la parte de importación en México. Una pregunta a la vez."),
    sections: [{ id: "import", title: bi("Import in Mexico", "Importación en México") }, { id: "docs", title: bi("Classification and origin", "Clasificación y origen") }],
    contextLines: [bi("Destination: Mexico", "Destino: México"), bi("Scope: import of specialty food products", "Alcance: importación de alimentos especializados")],
    requiredLater: [bi("Product composition per item, used when the classification is reviewed.", "Composición de cada producto, que se usa cuando se revisa la clasificación.")],
    questions: [
      { key: "itc_classification", section: "docs", blocking: true, label: bi("Tariff classification", "Clasificación arancelaria"),
        ask: bi("Do you already know the tariff classification of your main products?", "¿Ya conoces la clasificación arancelaria de tus productos principales?"),
        qr: [qr("yes", "Yes, we know it", "Sí, la conocemos"), qr("no", "Not yet", "Todavía no"), UNKNOWN] },
      { key: "itc_importer", section: "import", executionDependency: true, label: bi("Importer in Mexico", "Importador en México"),
        ask: bi("Who will act as the importer in Mexico?", "¿Quién actuará como importador en México?"),
        qr: [qr("own", "Our own entity", "Nuestra propia entidad"), qr("buyer", "Our buyer", "Nuestro comprador"), UNKNOWN] },
      { key: "itc_permits", section: "import", label: bi("Import permits", "Permisos de importación"),
        ask: bi("Do you know whether your products need sanitary or import permits? If you are unsure, I note it as pending.", "¿Sabes si tus productos necesitan permisos sanitarios o de importación? Si no estás seguro, lo anoto como pendiente."),
        qr: [qr("yes", "Yes, they do", "Sí los necesitan"), qr("no", "No permits needed", "No necesitan permisos"), UNKNOWN] },
      { key: "itc_preference", section: "docs", label: bi("Preferential tariff treatment", "Trato arancelario preferencial"),
        ask: bi("Do you plan to claim preferential tariff treatment under a trade agreement?", "¿Planeas solicitar trato arancelario preferencial bajo un acuerdo comercial?"),
        qr: [qr("yes", "Yes", "Sí"), qr("no", "No", "No"), UNKNOWN] },
      { key: "itc_broker", section: "import", label: bi("Customs broker", "Agente aduanal"),
        ask: bi("Do you already work with a customs broker in Mexico?", "¿Ya trabajas con un agente aduanal en México?"),
        qr: [qr("yes", "Yes", "Sí"), qr("no", "Not yet", "Todavía no"), UNKNOWN] },
      { key: "itc_lines", section: "docs", label: bi("Product lines in the first shipment", "Líneas de producto del primer envío"),
        ask: bi("How many product lines will be in your first shipment?", "¿Cuántas líneas de producto irán en tu primer envío?") },
    ],
  },
  corporate_legal_admin: {
    id: "corporate_legal_admin", iconKey: "corporate_legal_admin", kind: "category",
    label: bi("Corporate and Legal Administration", "Administración corporativa y legal"),
    intro: bi("Let's cover how you will operate legally in Mexico. One question at a time.", "Vamos a ver cómo vas a operar legalmente en México. Una pregunta a la vez."),
    sections: [{ id: "structure", title: bi("Structure", "Estructura") }, { id: "agreements", title: bi("Agreements and brand", "Acuerdos y marca") }],
    contextLines: [bi("Destination: Mexico", "Destino: México"), bi("Scope: operating structure and commercial agreements", "Alcance: estructura de operación y acuerdos comerciales")],
    requiredLater: [bi("Who will sign on behalf of the company, defined when the structure is chosen.", "Quién firmará en nombre de la empresa, que se define cuando se elija la estructura.")],
    questions: [
      { key: "cla_structure", section: "structure", blocking: true, label: bi("Operating structure", "Estructura de operación"),
        ask: bi("How do you plan to operate in Mexico: through a local entity, a distributor, or directly from abroad?", "¿Cómo planeas operar en México: con una entidad local, con un distribuidor o directamente desde el extranjero?"),
        qr: [qr("entity", "Through a local entity", "Con una entidad local"), qr("distributor", "Through a distributor", "Con un distribuidor"), qr("direct", "Directly from abroad", "Directamente desde el extranjero"), UNKNOWN] },
      { key: "cla_agreements", section: "agreements", label: bi("First agreements", "Primeros acuerdos"),
        ask: bi("Which agreements do you expect to sign first, for example with a distributor or a buyer?", "¿Qué acuerdos esperas firmar primero, por ejemplo con un distribuidor o un comprador?") },
      { key: "cla_representation", section: "structure", executionDependency: true, label: bi("Legal representation in Mexico", "Representación legal en México"),
        ask: bi("Do you already have someone who can represent the company legally in Mexico?", "¿Ya tienes a alguien que pueda representar legalmente a la empresa en México?"),
        qr: [qr("yes", "Yes", "Sí"), qr("no", "Not yet", "Todavía no"), UNKNOWN] },
      { key: "cla_brand", section: "agreements", label: bi("Brand registration", "Registro de marca"),
        ask: bi("Is your brand already registered in Mexico?", "¿Tu marca ya está registrada en México?"),
        qr: [qr("yes", "Yes", "Sí"), qr("no", "No", "No"), UNKNOWN] },
      { key: "cla_labelling", section: "agreements", label: bi("Local labelling requirements", "Requisitos locales de etiquetado"),
        ask: bi("Have you reviewed the local labelling requirements for your products?", "¿Has revisado los requisitos locales de etiquetado de tus productos?"),
        qr: [qr("yes", "Yes", "Sí"), qr("no", "Not yet", "Todavía no"), UNKNOWN] },
    ],
  },
  strategic_advisory: {
    id: "strategic_advisory", iconKey: "strategic_advisory", kind: "strategic_advisory",
    label: bi("Strategic Advisory", "Strategic Advisory"),
    intro: bi("For your advisor to start with clarity, tell me what you want to resolve with this study or advisory.", "Para que tu asesor estratégico empiece con claridad, cuéntame qué quieres resolver con este estudio o asesoría."),
    sections: [{ id: "study", title: bi("Study or advisory", "Estudio o asesoría") }],
    contextLines: [bi("Destination: Mexico", "Destino: México")],
    requiredLater: [],
    questions: [
      { key: "sa_question", section: "study", blocking: true, label: bi("What you want to resolve", "Qué quieres resolver"),
        ask: bi("What do you want to resolve with this study or advisory?", "¿Qué quieres resolver con este estudio o asesoría?") },
      { key: "sa_scope", section: "study", label: bi("Market or segment", "Mercado o segmento"),
        ask: bi("Which market or segment should it focus on?", "¿En qué mercado o segmento debe enfocarse?") },
      { key: "sa_decision", section: "study", label: bi("Decision you expect to take", "Decisión que esperas tomar"),
        ask: bi("Which decision do you expect to take with the result?", "¿Qué decisión esperas tomar con el resultado?"),
        qr: [UNKNOWN] },
    ],
  },
};

export interface MapItemFx { id: string; label: Bi; why: Bi; priority: "high" | "medium" | "low"; timing: Bi; state: "confirmed" | "assumed" | "pending" }
export const MAP_ITEMS: Record<string, MapItemFx[]> = {
  logistics: [
    { id: "sm-log-1", label: bi("International freight, United Kingdom to Mexico", "Transporte internacional, Reino Unido a México"), why: bi("You plan to ship finished food products to Mexico.", "Planeas enviar productos alimenticios terminados a México."), priority: "high", timing: bi("Before the first shipment", "Antes del primer envío"), state: "confirmed" },
    { id: "sm-log-2", label: bi("Temperature-controlled transport", "Transporte con control de temperatura"), why: bi("Some of your products may need chilled transport.", "Algunos de tus productos podrían necesitar transporte refrigerado."), priority: "medium", timing: bi("Before the first shipment", "Antes del primer envío"), state: "assumed" },
    { id: "sm-log-3", label: bi("Storage and delivery in Mexico", "Almacenaje y entrega en México"), why: bi("Your buyers will receive goods in Mexico.", "Tus compradores recibirán la mercancía en México."), priority: "medium", timing: bi("Second quarter", "Segundo trimestre"), state: "pending" },
  ],
  international_trade_customs: [
    { id: "sm-itc-1", label: bi("Import and customs clearance in Mexico", "Importación y despacho aduanal en México"), why: bi("Your products must clear customs on arrival.", "Tus productos deben pasar por aduana al llegar."), priority: "high", timing: bi("Before the first shipment", "Antes del primer envío"), state: "confirmed" },
    { id: "sm-itc-2", label: bi("Tariff classification and import permits", "Clasificación arancelaria y permisos de importación"), why: bi("Food products usually need both reviewed.", "Los alimentos suelen requerir revisar ambos."), priority: "medium", timing: bi("Before the first shipment", "Antes del primer envío"), state: "pending" },
  ],
  corporate_legal_admin: [
    { id: "sm-cla-1", label: bi("Operating structure in Mexico", "Estructura de operación en México"), why: bi("The way you operate defines contracts and obligations.", "La forma en que operes define contratos y obligaciones."), priority: "high", timing: bi("Before signing with buyers", "Antes de firmar con compradores"), state: "confirmed" },
    { id: "sm-cla-2", label: bi("Distribution and commercial agreements", "Acuerdos de distribución y comerciales"), why: bi("You expect to sell through a local partner.", "Esperas vender a través de un socio local."), priority: "medium", timing: bi("Second quarter", "Segundo trimestre"), state: "assumed" },
  ],
  strategic_advisory: [
    { id: "sm-sa-1", label: bi("Market entry study for Mexico", "Estudio de entrada al mercado en México"), why: bi("You want to understand the market before committing.", "Quieres entender el mercado antes de comprometerte."), priority: "low", timing: bi("Before choosing the structure", "Antes de elegir la estructura"), state: "confirmed" },
  ],
};

export const MAP_OPEN_ITEMS: Bi[] = [
  bi("Who will act as importer in Mexico is still open.", "Todavía está abierto quién actuará como importador en México."),
  bi("Expected shipments per month are not defined yet.", "Todavía no están definidos los envíos esperados al mes."),
];

export const NEEDS_KNOWN: { match: RegExp; category: string }[] = [
  { match: /payroll|nómina|nomina|employ|empleados|hiring|contrat/i, category: "people_payroll_employment" },
  { match: /tax|impuesto|fiscal|account|contab/i, category: "tax_accounting_audit" },
];
export const EXTRA_CATEGORY_LABELS: Record<string, Bi> = {
  people_payroll_employment: bi("People, Payroll and Employment", "Personas, nómina y empleo"),
  tax_accounting_audit: bi("Tax, Accounting and Audit", "Impuestos, contabilidad y auditoría"),
};
