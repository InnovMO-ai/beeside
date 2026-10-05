import type { Locale } from '@beeside/fa-public-engine';
import { L, NC, type L10n } from '@beeside/fa-public-engine';

/** Journey + result microcopy. Visible vocabulary only: no "frentes", "activadores", "demand signal", "core/adjacent" (DESIGN_HANDOFF §12). */
export const UI = {
  back: L('Atrás', 'Back'), next: L('Continuar', 'Continue'), saveLater: L('Guardar y seguir después', 'Save and continue later'),
  stepOf: L('de', 'of'), optional: L('opcional', 'optional'), logoAlt: L('beeside', 'beeside'),
  stages: [L('Tu empresa', 'Your company'), L('Tu proyecto', 'Your project'), L('Por qué y cuándo', 'Why and when'), L('Lo que necesita tu proyecto', 'What your project needs'), L('Algo más', 'Anything else'), L('Tu resultado', 'Your result')] as L10n[],
  saved: L('Te enviamos el enlace de regreso a {email}.', 'We sent your return link to {email}.'),
  saveError: L('No pudimos guardar ahora. Tu avance sigue en este dispositivo.', "We couldn't save right now. Your progress is still on this device."),

  // Cover (PO design): English from the approved mock; Spanish is a proposal pending PO approval (NC).
  coverEyebrow: NC('cover.eyebrow', 'Un camino más claro. Un mañana más brillante.', 'A clearer path. A brighter tomorrow.'),
  coverTitleLead: NC('cover.title.lead', 'Tu expansión empieza con una', 'Your expansion starts with a'),
  coverTitleAccent: NC('cover.title.accent', 'visión más clara.', 'clearer view.'),
  coverLead: NC('cover.lead', 'Cuéntanos sobre tu proyecto. Te ayudaremos a identificar lo que ya está definido, lo que necesita atención y lo que sigue.', "Tell us about your project. We'll help you identify what's already defined, what needs attention, and what comes next."),
  coverCta: NC('cover.cta', 'Comienza tu evaluación', 'Start your assessment'),
  coverNoteStrong: NC('cover.note.strong', 'Dedicar 10–15 minutos a planear hoy te dará semanas de libertad mañana.', 'Investing 10-15 minutes to plan today will give you weeks of freedom tomorrow.'),
  coverNote: NC('cover.note', 'Puedes guardar y continuar después.', 'You can save and continue later.'),
  switchLanguage: NC('switchLanguage', 'Cambiar idioma a', 'Switch language to'),
  // Fixed brand elements: always in English, in both languages.
  coverProduct: L('First Assessment', 'First Assessment'),
  coverSideTop: [L('PEOPLE', 'PEOPLE'), L('IDEAS', 'IDEAS'), L('OPPORTUNITIES', 'OPPORTUNITIES'), L('A BRIGHTER TOMORROW', 'A BRIGHTER TOMORROW')],
  coverSideBottom: [L('EXPAND', 'EXPAND'), L('WITH', 'WITH'), L('CONFIDENCE', 'CONFIDENCE')],
  benefits: { clarity: L('Clarity from day one', 'Clarity from day one'), expert: L('Expert guidance', 'Expert guidance'), global: L('Global expansion', 'Global expansion'), real: L('Real opportunities', 'Real opportunities') },

  idTitle: L('¿Quién eres tú en este proyecto?', 'Who are you in this project?'), idLead: L('Sin cuenta ni contraseña.', 'No account or password.'),
  name: L('Tu nombre', 'Your name'), company: L('Empresa', 'Company'), email: L('Email de trabajo', 'Work email'),
  emailHelp: NC('emailHelp', 'Preferimos un correo de la empresa, pero puedes usar otro. Lo usaremos para guardar tu avance, enviarte el resultado y continuar contigo; no te lo volveremos a pedir.', "We prefer a company address, but any works. We'll use it to save your progress, send your result and continue with you; we won't ask again."),
  emailInvalid: L('Revisa el email', 'Check the email address'),
  role: L('Tu rol', 'Your role'),
  decider: L('¿Quién decide sobre este proyecto?', 'Who decides on this project?'),
  deciderOpts: { me: L('Decido yo', 'I do'), other: L('Otra persona', 'Someone else'), shared: L('Entre varias personas', 'Several of us') },
  terms: L('Acepto los Términos y Condiciones', 'I accept the Terms and Conditions'), privacy: NC('privacy', 'Reconozco la Política de Privacidad', 'I acknowledge the Privacy Policy'),
  openInNewTab: L('(se abre en una pestaña nueva)', '(opens in a new tab)'),

  coTitle: L('¿Quiénes son?', 'Who are you?'),
  hasBiz: L('¿Tu empresa o negocio ya está en marcha?', 'Is your company or business already operating?'), yes: L('Sí', 'Yes'), no: L('No', 'No'), unknown: L('No lo sé', 'Not sure'),
  sector: L('¿Qué hace tu empresa?', 'What does your company do?'), sectorPh: L('Ej. desarrollo de software', 'e.g. software development'),
  size: L('¿De qué tamaño es tu empresa?', 'How big is your company?'),
  sizes: { '1-10': L('1–10 personas', '1–10 people'), '11-50': L('11–50', '11–50'), '51-250': L('51–250', '51–250'), '251-1000': L('251–1,000', '251–1,000'), '1000+': L('Más de 1,000', 'More than 1,000') },
  operatesIn: L('¿Dónde opera hoy?', 'Where does it operate today?'), searchCountry: L('Busca un país', 'Search for a country'), none: L('Sin resultados', 'No results'),
  exitTitle: L('Por ahora, First Assessment es para negocios en marcha', 'For now, First Assessment is for operating businesses'),
  exitBody: L('First Assessment está pensado para empresas o negocios que ya operan y quieren expandirse.', 'First Assessment is designed for businesses that already operate and want to expand.'),

  destTitle: L('¿A dónde quieres llevar tu empresa?', 'Where do you want to take your company?'), destLead: L('Puede ser uno o varios países.', 'It can be one or several countries.'),
  destLabel: L('Destino', 'Destination'), destOpen: L('Aún no lo tengo decidido', "I haven't decided yet"), region: L('Región o estado (opcional)', 'Region or state (optional)'),
  sameTitle: L('¿Harás lo mismo en', 'Will you do the same in'), sameLead: L('Si es distinto, te preguntamos por cada país.', "If it's different, we'll ask for each country."),
  sameYes: L('Sí, lo mismo en los dos', 'Yes, the same in both'), sameYesMany: L('Sí, lo mismo en todos', 'Yes, the same in all'), sameNo: L('No, cada país tiene su papel', 'No, each country has its own role'),
  actTitle: L('¿Qué quieres hacer allí?', 'What do you want to do there?'),
  acts: { sell: L('Vender', 'Sell'), produce: L('Producir', 'Produce'), source: L('Comprar a proveedores locales', 'Buy from local suppliers'), operate: L('Operar', 'Operate'), hire: L('Contratar personas', 'Hire people'), invest_only: L('Sólo invertir sin operar', 'Only invest, without operating') },
  withTitle: L('¿Con qué?', 'With what?'), withs: { goods: L('Bienes físicos', 'Physical goods'), services: L('Servicios', 'Services'), digital: L('Productos o servicios digitales', 'Digital products or services') },
  descPh: L('Cuéntalo con tus palabras (opcional)', 'Say it in your own words (optional)'),
  presTitle: L('¿Cómo piensas estar presente?', 'How do you plan to be present?'),
  pres: { remote: L('Desde fuera, de forma remota', 'From abroad, remotely'), third_parties: L('A través de terceros', 'Through third parties'), own_physical: L('Con presencia propia: oficina, planta o local', 'With your own presence: office, plant or premises'), own_onsite: L('Con equipo propio ejecutando en sitio, sin espacio propio', 'With your own team executing on site, without premises of your own'), acquisition: L('Comprando o adquiriendo una empresa', 'Buying or acquiring a company'), open: L('Aún no está definido', 'Not defined yet') },
  perm: L('¿Será permanente o temporal?', 'Will it be permanent or temporary?'), permOpts: { permanent: L('Permanente', 'Permanent'), temporary: L('Temporal', 'Temporary'), open: L('Aún no definido', 'Not defined yet') },
  months: L('¿Cuántos meses, aproximadamente?', 'About how many months?'),
  existTitle: L('¿Qué tienes ya allí?', 'What do you already have there?'),
  exist: { nothing: L('Nada todavía', 'Nothing yet'), via_third: L('Presencia a través de terceros: distribuidor, clientes…', 'Presence through third parties: distributor, customers…'), own: L('Presencia propia', 'A presence of your own') },
  existNote: L('¿Con quién o cómo? (opcional)', 'With whom or how? (optional)'),

  r1Eyebrow: L('Esto es lo que entendemos', "This is what we understand"), r1Fix: L('Toca cualquier parte para corregirla.', 'Tap any part to correct it.'),
  r1Know: L('¿Ya sabes lo que necesitas?', 'Do you already know what you need?'), r1KnowHelp: L('Puedes ir directo a marcarlo; antes te haremos tres preguntas cortas.', "You can go straight to marking it; first we'll ask three short questions."),
  r1Direct: L('Ir directo', 'Go direct'), r1Confirm: L('Sí, es así', "Yes, that's right"),
  r1EyebrowNamed: L('esto es lo que entendemos', 'this is what we understand'),
  colTopic: L('Aplican a tu proyecto', 'Apply to your project'), colStatus: L('¿En qué punto está?', 'Where does it stand?'),
  colSupport: L('¿Quieres apoyo aquí?', 'Do you want support here?'), readyBefore: L('¿Listo antes de', 'Ready before'),
  catalogErrorTitle: L('No pudimos cargar First Assessment', "We couldn't load First Assessment"),
  catalogErrorBody: L('Revisa tu conexión e inténtalo de nuevo.', 'Check your connection and try again.'),
  retry: L('Reintentar', 'Try again'),
  progress: L('Progreso', 'Progress'), remove: L('Quitar', 'Remove'), marked: L('Marcados', 'Marked'),
  and: L('y', 'and'), of: L('de', 'of'), because: L('Porque', 'Because'), dependsOnLabel: L('Depende de', 'Depends on'),
  countryYouChoose: L('el país que elijas', 'the country you choose'),
  /** Language names are shown in their own language (not translated). */
  languageNames: { es: 'Español', en: 'English' },
  notIndicatedNote: L('«No indicado» no significa resuelto: aplica a tu proyecto, pero no lo marcaste.', "“Not indicated” doesn't mean resolved: it applies to your project, but you didn't mark it."),
  noStatusNote: L('No asignamos estado a los {n} temas que no marcaste.', "We don't assign a status to the {n} topics you didn't mark."),
  glanceOthers: L('Otros {n} temas no aplican a tu proyecto. El detalle, abajo.', '{n} other topics do not apply to your project. Details below.'),
  glanceOther1: L('Otro tema no aplica a tu proyecto. El detalle, abajo.', '1 other topic does not apply to your project. Details below.'),
  headAppliesShortcut: L('{applies} temas aplican a tu proyecto. Marcaste {marked}.', '{applies} topics apply to your project. You marked {marked}.'),
  headApplies1: L('{applies} tema aplica a tu proyecto', '{applies} topic applies to your project'), headAppliesN: L('{applies} temas aplican a tu proyecto', '{applies} topics apply to your project'),
  headIn: L(' en {n} países', ' across {n} countries'),
  headDepends1: L(' Uno más depende de una decisión.', ' One more depends on a decision.'), headDependsN: L(' {n} más dependen de una decisión.', ' {n} more depend on a decision.'),
  r1Company: L('Tu empresa', 'Your company'),

  reasonEyebrow: L('Lo que te mueve', "What's driving you"), reasonTitle: L('¿Por qué ahora?', 'Why now?'),
  reasons: {
    client_request: L('Un cliente nos lo pidió', 'A customer asked us to'), follow_clients: L('Acompañar a clientes actuales', 'Follow current customers'), growth: L('Una oportunidad de crecimiento', 'A growth opportunity'),
    talent: L('Acceso a talento', 'Access to talent'), cost: L('Costos o eficiencia', 'Cost or efficiency'), resilience: L('Una cadena de suministro más resiliente', 'A more resilient supply chain'),
    diversify: L('Depender menos de un mercado', 'Depend less on one market'), contract: L('Ejecutar un contrato ganado', 'Execute a contract I won'), partner: L('Una plataforma para crecer con otros clientes', 'A platform to grow with other customers'), other: L('Otro motivo', 'Something else'),
  },
  reasonWords: L('Escríbelo con tus palabras (opcional)', 'Say it in your own words (optional)'),
  reasonMirror: L('Lo que nos cuentas', "What you're telling us"),
  decTitle: L('¿En qué punto está la decisión?', 'Where does the decision stand?'),
  dec: { exploring: L('Lo estoy explorando', "I'm exploring it"), decided: L('Está decidido; vemos cómo hacerlo', "It's decided; we're working out how"), in_progress: L('Ya está en marcha', "It's already under way") },
  dependsOn: L('¿De qué depende todavía?', 'What does it still depend on?'),
  startQ: L('¿Cuándo te gustaría empezar?', 'When would you like to start?'),
  starts: { asap: L('Cuanto antes', 'As soon as possible'), '3m': L('En unos 3 meses', 'In about 3 months'), '6m': L('En unos 6 meses', 'In about 6 months'), '12m': L('En un año o más', 'In a year or more'), unknown: L('Aún no lo sé', "Don't know yet") },
  extDate: L('¿Hay alguna fecha externa que no puedas mover?', 'Is there an external date you cannot move?'), extDateHelp: L('Un contrato, una licitación, el compromiso con un cliente…', 'A contract, a tender, a commitment to a customer…'),
  dateLabel: L('Fecha', 'Date'), dateWhat: L('¿Qué ocurre ese día?', 'What happens that day?'), datePh: L('Ej. 2028-Q1 o 2026-12', 'e.g. 2028-Q1 or 2026-12'),

  scaleTitle: L('¿De qué tamaño es el proyecto?', 'How big is the project?'), scaleWhy: L('Sólo nos ayuda a dimensionar el proyecto y los temas que puede involucrar. No lo usamos para evaluarte.', "It only helps us understand the scale of the project and the topics it may involve. We don't use it to evaluate you."),
  scaleQ: {
    investment: L('¿Qué inversión estimas en', 'What investment do you expect in'), people: L('¿Cuántas personas contratarías en', 'How many people would you hire in'),
    products: L('¿Cuántos productos o líneas llevarías a', 'How many products or lines would you take to'), purchase: L('¿Qué volumen de compra prevés en', 'What purchase volume do you expect in'), duration: L('¿Cuánto durará el proyecto en', 'How long will the project last in'),
  },
  scaleDecline: L('Prefiero no decirlo', 'I prefer not to say'), scaleUnknown: L('Aún no lo sé', "Don't know yet"),

  actTitle1: L('Dos preguntas que cambian lo que toca a tu proyecto.', 'Two questions that change what your project involves.'),
  sellTitle: L('Lo que vendes', 'What you sell'), siteTitle: L('Lo que montas allí', 'What you set up there'),
  regulated: L('¿Actividad o producto regulado?', 'Regulated activity or product?'),
  sellsTo: L('¿A quién vendes?', 'Who do you sell to?'), sellsToOpts: { companies: L('Empresas', 'Businesses'), government: L('Gobierno', 'Government'), consumers: L('Consumidores', 'Consumers'), mixed: L('Mixto', 'Mixed') },
  ownBrand: L('¿Marca propia?', 'Own brand?'),
  location: L('¿Ya sabes dónde estará?', 'Do you know where it will be?'), locationSite: L('¿Ya sabes dónde estará la obra?', 'Do you know where the site will be?'), locOpts: { defined: L('Lugar definido', 'Place decided'), region_only: L('Región elegida, lugar por decidir', 'Region chosen, place to be decided'), undecided: L('Aún no', 'Not yet') },
  carries: L('¿Qué llevarás desde el país?', 'What will you bring from your home country?'), carryOpts: { people: L('Personas de tu equipo', 'People from your team'), equipment: L('Maquinaria, herramientas o equipos', 'Machinery, tools or equipment'), nothing: L('Nada', 'Nothing') },

  topicsTitle: L('Esto es lo que toca tu proyecto', 'This is what your project involves'),
  topicsLead: L('Primero, dinos en qué punto está cada tema. Después te preguntamos dónde quieres apoyo', "First, tell us where each topic stands. Then we'll ask where you'd like support"),
  topicsLeadDate: L(' y qué debe estar listo antes de tu fecha clave', ' and what must be ready before your key date'),
  statuses: { resolved: L('Ya resuelto', 'Resolved'), in_progress: L('En marcha', 'Under way'), pending: L('Pendiente', 'Pending'), unknown: L('No lo sé', 'Not sure') },
  notStarted: L('Aún no he empezado nada', "I haven't started anything yet"),
  missing: L('¿Falta algo?', 'Anything missing?'), missingPh: L('Escríbelo con tus palabras', 'Write it in your own words'), add: L('Añadir', 'Add'),
  notApply: L('No aplican, por lo que nos contaste', 'Not relevant, based on what you told us'),
  dependsTitle: L('Todavía no está definido', "It's not yet defined"), dependsLead: L('De esa decisión depende:', 'That decision affects:'), dependsTag: L('Depende', 'Depends'),
  causes: { presence: L('cómo estarás presente en', 'how you will be present in'), hire: L('cómo contrates', 'how you hire'), legal_operation: L('cómo operarás legalmente en', 'how you will operate legally in') },
  possible: L('Posible', 'Possible'),
  supportTitle: L('¿Dónde quieres apoyo?', 'Where do you want support?'), supportLead: L('Solo en los temas que aún no están resueltos. «No» no significa que no quieras delegarlo más adelante.', "Only on topics not yet resolved. “No” doesn't mean you won't want to delegate it later."),
  markTitle: L('Marca lo que necesitas', 'Mark what you need'), markLead: L('Estos temas aplican a tu proyecto. Lo que no marques quedará como «no indicado», no como resuelto.', 'These topics apply to your project. Anything you leave unmarked stays “not indicated”, not “resolved”.'),
  concreteQ: L('¿Buscas algo concreto? Escríbelo', 'Looking for something specific? Write it'), concretePh: L('Por ejemplo, grúas', 'For example, cranes'),
  related: L('Lo relacionamos con', 'We linked it to'), change: L('Cambiar', 'Change'), applyHere: L('Aplican a tu proyecto', 'Apply to your project'),
  markedCount: L('Marcados', 'Marked'), notIndicated: L('No indicado', 'Not indicated'), otherTopics: L('Otros temas que aplican', 'Other topics that apply'),
  criticalTitleQuarter: L('¿Qué debe estar listo antes del', 'What needs to be ready before'), criticalTitleDate: L('¿Qué debe estar listo antes de', 'What needs to be ready before'), criticalTitle: L('¿Qué debe estar listo según tu calendario?', 'What needs to be ready according to your schedule?'), criticalLead: L('Marca los temas atados a una fecha que no puedes mover.', "Mark the topics tied to a date you can't move."),
  cargoTitle: L('¿Dónde necesitas mover la carga?', 'Where do you need to move the cargo?'),
  cargo: (c: string) => ({ within: L(`Dentro de ${c}`, `Within ${c}`), into_from_abroad: L(`Hacia ${c} desde otro país`, `Into ${c} from another country`), both: L('Ambos', 'Both'), unknown: L('Aún no lo sé', "Don't know yet") }),

  valuesTitle: L('¿Qué valoras de un apoyo?', 'What do you value in support?'), valuesLead: L('Elige lo que más valoras. Puedes saltar este paso.', 'Choose what you value most. You can skip this step.'),
  values: { speed: L('Velocidad', 'Speed'), no_network: L('No construir red desde cero', "Not building a network from scratch"), single_contact: L('Un solo interlocutor', 'A single point of contact'), local_validation: L('Validación local', 'Local validation'), comparable_options: L('Alternativas comparables', 'Comparable options'), coordination: L('Coordinación', 'Coordination'), cost: L('Costo', 'Cost'), keep_control: L('Mantener el control de mi equipo', 'Keeping control of my team') },
  valueWords: L('En tus palabras (opcional)', 'In your own words (optional)'), keepQ: L('¿Qué quieres mantener en tu equipo? (opcional)', 'What do you want to keep in your team? (optional)'),
  extraTitle: L('Algo más', 'Anything else'), extraLead: L('Nada depende de este paso.', 'Nothing depends on this step.'),
  success: L('¿Cómo sería un buen resultado?', 'What would a good outcome look like?'), constraints: L('Restricciones que ya conoces', 'Constraints you already know'),
  descr: L('Descríbelo con tus palabras', 'Describe it in your own words'), experience: L('Experiencia o intentos anteriores', 'Previous experience or attempts'), unknowns: L('Lo que todavía no sabes', "What you don't know yet"),
  personal: L('Hay una necesidad personal ligada al proyecto (sólo queremos saber que existe, sin detalles)', 'There is a personal need tied to the project (we only need to know it exists, no details)'),
  seeResult: L('Ver mi resultado', 'See my result'),
  generating: L('Preparando tu resultado…', 'Preparing your result…'), resultError: L('No pudimos preparar el resultado. Inténtalo de nuevo.', "We couldn't prepare your result. Please try again."),

  // ----- result -----
  yev: L('Your Expansion View', 'Your Expansion View'), glance: L('De un vistazo', 'At a glance'), topics: L('temas', 'topics'),
  yourProject: L('Tu proyecto', 'Your project'), whyNow: L('Por qué ahora', 'Why now'), whyNowWords: L('Por qué ahora, en tus palabras', 'Why now, in your words'),
  decided: L('Ya decidido', 'Already decided'), stillOpen: L('Todavía abierto', 'Still open'), projectSize: L('Tamaño del proyecto', 'Project size'), goodResult: L('Cómo sería un buen resultado', 'What a good outcome looks like'),
  fixSomething: L('Corregir algo', 'Edit something'),
  whatItInvolves: L('Lo que toca', 'What it involves'), whereYouAre: L('Dónde estás', 'Where you are'),
  resolved: L('Ya resuelto', 'Resolved'), underWay: L('En marcha', 'Under way'), pendingL: L('Pendiente', 'Pending'),
  alreadyHave: L('Lo que ya tienes', 'What you already have'),
  whereValue: L('Where beeside adds value.', 'Where beeside adds value.'), whereValueTitle: L('Dónde puede aportar beeside en tu proyecto', 'Where beeside can add value to your project'),
  valuedSupport: L('Lo que valoras en un apoyo', 'What you value in support'), keptTeam: L('Lo que mantienes en tu equipo', 'What you keep in-house'),
  criticalTag: L('Fecha crítica', 'Critical date'), nextStep: L('Siguiente paso', 'Next step'),
  premiumBody: L('Con acceso Premium, trabajamos contigo el detalle de cada tema y te presentamos propuestas con alcance, plazo y costo para que decidas.', 'With Premium access, we work through each topic with you and bring you proposals with scope, timing and cost so you can decide.'),
  continueWith: L('Continuar con beeside', 'Continue with beeside'), continued: NC('continued', 'Listo: tu solicitud quedó registrada. Seguiremos contigo en el mismo correo.', "Done: your request is recorded. We'll continue with you at the same email."),
  emailResult: L('Recibir este resultado por email', 'Get this result by email'), emailed: L('Te lo enviamos al email que nos diste.', 'We sent it to the email you gave us.'),
  noPremiumTitle: L('Tu proyecto, más claro', 'Your project, with more clarity'),
  noPremiumBody: L('Por ahora no vemos un siguiente paso de beeside que aporte suficiente valor a este proyecto. Your Expansion View queda como tu resultado y puedes volver cuando el proyecto cambie o aparezca una nueva necesidad.', "For now, we don't see a next beeside step that would add enough value to this project. Your Expansion View remains your result, and you can come back when the project changes or a new need appears."),
  backToStart: L('Volver al inicio', 'Back to the start'),
  footerCopy: L('© 2026 beeside', '© 2026 beeside'), termsLink: L('Términos y Condiciones', 'Terms and Conditions'), privacyLink: L('Política de Privacidad', 'Privacy Policy'),
  aboutBeeside: L('Sobre beeside', 'About beeside'),
  vsHeadline: L('Expande tu negocio.\nNo tu carga de trabajo.', 'Expand your business.\nNot your workload.'),
  // BeesideValueSection (PO-approved copy, D-134). Headline stays "Expande tu negocio. No tu carga de trabajo." (D-120).
  vsSherpa: L('Tu Sherpa', 'Your Sherpa'), vsSherpaD: L('Una persona que coordina tu expansión y mantiene continuidad de principio a fin.', 'One person coordinating your expansion and keeping continuity from start to finish.'),
  vsHive: L('The Hive', 'The Hive'), vsHiveD: L('Especialistas y proveedores seleccionados para las necesidades de tu proyecto.', 'Curated specialists and providers for the needs of your project.'),
  vsHub: L('Operation Hub', 'Operation Hub'), vsHubD: L('Un solo lugar para seguir avances, tareas, documentos y próximos pasos.', 'One place to follow progress, tasks, documents and next steps.'),
  vsAdvisory: L('Strategic Advisory', 'Strategic Advisory'), vsAdvisoryD: L('Experiencia especializada para ayudarte a resolver decisiones complejas de expansión.', 'Specialized expertise to help you navigate complex expansion decisions.'),
  idBeforeTitle: L('Antes de continuar', 'Before you continue'),
  idBeforeLead: L('Revisa y acepta lo necesario para continuar con tu First Assessment.', "Review and accept what's required to continue with your First Assessment."),
  marketingConsent: L('Quiero recibir novedades, información y comunicaciones comerciales de beeside.', 'I would like to receive news, information and commercial communications from beeside.'),
  acceptContinue: L('Aceptar y continuar', 'Accept and continue'),
  privacyNotice: L('Lo que nos contaste no se usa para evaluarte. Antes de Premium, no compartimos tu proyecto con proveedores.', "What you told us isn't used to assess you. Before Premium, we don't share your project with providers."),
} as const;

export type UiKey = keyof typeof UI;
export const tr = (l: L10n, locale: Locale) => l[locale];

/** "Porque …" explanation shown under each topic (derived from the declared facts that activated it). */
const BECAUSE: Record<string, L10n> = {
  own_premises: L('tendrás presencia propia', 'you will have a presence of your own'), own_plant: L('tendrás planta propia', 'you will have your own plant'),
  own_presence: L('tendrás presencia propia', 'you will have your own presence'), hire: L('vas a contratar personas', 'you will hire people'),
  operate: L('vas a operar', 'you will operate'), produce: L('vas a producir en el lugar', 'you will produce on site'), source: L('comprarás a proveedores locales', 'you will buy from local suppliers'),
  sell: L('vas a vender', 'you will sell'), goods_cross: L('tus bienes cruzarán fronteras', 'your goods will cross borders'), goods: L('producirás bienes físicos', 'you will handle physical goods'),
  carries_people: L('llevarás personas de tu equipo', 'you will bring people from your team'), carries_equipment: L('llevarás maquinaria, herramientas o equipos', 'you will bring machinery, tools or equipment'),
  onsite_execution: L('vas a ejecutar una obra en sitio', 'you will execute work on site'), temporary: L('el proyecto tiene fin previsto', 'the project has a planned end'),
  sells_government: L('vendes a gobierno', 'you sell to government'), own_brand: L('vendes con marca propia', 'you sell under your own brand'),
  regulated: L('tu actividad está regulada', 'your activity is regulated'), regulated_unknown: L('nos dijiste que no sabes si tu actividad está regulada', "you said you're not sure if your activity is regulated"),
  group_operation: L('la operación será parte de tu grupo', 'the operation will be part of your group'), invest_only: L('inviertes sin operar', 'you invest without operating'),
  third_parties: L('estarás presente a través de terceros', 'you will be present through third parties'), declared: L('lo mencionaste', 'you mentioned it'),
};
export function becauseText(keys: string[], locale: Locale): string {
  const parts = keys.map((k) => BECAUSE[k]?.[locale]).filter((x): x is string => !!x);
  const uniq = [...new Set(parts)];
  if (!uniq.length) return '';
  const joined = uniq.length === 1 ? uniq[0]! : `${uniq.slice(0, -1).join(', ')} ${UI.and[locale]} ${uniq[uniq.length - 1]}`;
  return `${UI.because[locale]} ${joined}`;
}

/** Fills `{name}` placeholders of a localized template. */
export const fill = (l: L10n, locale: Locale, vars: Record<string, string | number>): string => l[locale].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
