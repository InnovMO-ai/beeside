import type { Locale } from '@beeside/fa-public-engine';
import { L, type L10n } from '@beeside/fa-public-engine';

/** Journey + result microcopy. Visible vocabulary only: no "frentes", "activadores", "demand signal", "core/adjacent" (DESIGN_HANDOFF §12). */
export const UI = {
  back: L('Atrás', 'Back'), next: L('Continuar', 'Continue'), saveLater: L('Guardar y seguir después', 'Save and continue later'),
  stepOf: L('de', 'of'), optional: L('opcional', 'optional'), logoAlt: L('beeside', 'beeside'),
  stages: [L('Tu empresa', 'Your company'), L('Tu proyecto', 'Your project'), L('Por qué y cuándo', 'Why and when'), L('Lo que necesita tu proyecto', 'What your project needs'), L('Detalles adicionales', 'Additional details'), L('Tu resultado', 'Your result')] as L10n[],
  saved: L('Te enviamos el enlace de regreso a {email}.', 'We sent your return link to {email}.'),
  saveError: L('No pudimos guardar ahora. Tu avance sigue en este dispositivo.', "We couldn't save right now. Your progress is still on this device."),

  // Cover (PO design): English from the approved mock; PO-approved copy (final decisions 2026-10-12).
  coverEyebrow: L('Un camino más estructurado, mejores resultados.', 'A more structured path, better results.'),
  coverTitleLead: L('Tu expansión empieza con una', 'Your expansion starts with a'),
  coverTitleAccent: L('visión más clara.', 'clearer view.'),
  coverLead: L('Cuéntanos sobre tu proyecto. Te ayudaremos a identificar lo que ya está definido, lo que necesita atención y lo que sigue.', "Tell us about your project. We'll help you identify what's already defined, what needs attention, and what comes next."),
  coverCta: L('Comenzar', 'Start'),
  coverNoteStrong: L('Dedicar 10–15 minutos hoy puede darte más claridad para lo que sigue.', 'Spending 10–15 minutes today can give you more clarity for what comes next.'),
  coverNote: L('Puedes guardar y continuar después.', 'You can save and continue later.'),
  switchLanguage: L('Cambiar idioma a', 'Switch language to'),
  // Product name stays "Discovery" in both languages. Side words and benefits follow the locale (D-143); ES wording = proposal (LANG-1).
  coverProduct: L('Discovery', 'Discovery'),
  coverSideTop: [L('PERSONAS', 'PEOPLE'), L('IDEAS', 'IDEAS'), L('OPORTUNIDADES', 'OPPORTUNITIES'), L('UN MAÑANA MÁS BRILLANTE', 'A BRIGHTER TOMORROW')],   // ES = proposal (D-143 / LANG-1)
  coverSideBottom: [L('EXPANDE TU NEGOCIO', 'EXPAND YOUR BUSINESS'), L('CON CONFIANZA', 'WITH TRUST')],   // approved tagline: «EXPANDE TU NEGOCIO CON CONFIANZA» / «EXPAND YOUR BUSINESS WITH TRUST»
  benefits: { clarity: L('Clarity from day one', 'Clarity from day one'), expert: L('Expert guidance', 'Expert guidance'), global: L('Global expansion', 'Global expansion'), real: L('Real opportunities', 'Real opportunities') },

  idTitle: L('Cuéntanos un poco sobre ti.', 'Tell us a little about yourself.'), idLead: L('Sin cuenta ni contraseña.', 'No account or password.'),
  name: L('Nombre', 'Name'), company: L('Empresa', 'Company'), email: L('Correo de trabajo', 'Work email'),
  emailHelp: L('Lo usaremos para guardar tu avance y enviarte tu resultado.', "We'll use it to save your progress and send you your result."),
  emailInvalid: L('Revisa el email', 'Check the email address'),
  role: L('Tu rol en el proyecto', 'Your role in the project'),
  rolePh: L('Por ejemplo: director general, asesor externo', 'For example: CEO, external advisor'), roleHelp: L('Puedes indicar más de uno.', 'You can list more than one.'),   // DSC-23
  decider: L('¿Quién toma las decisiones sobre este proyecto?', 'Who makes the decisions on this project?'),
  deciderOpts: { me: L('Yo', 'I do'), other: L('Otra persona', 'Someone else'), shared: L('Decidimos entre varios', 'We decide together') },
  terms: L('Acepto los Términos y Condiciones', 'I accept the Terms and Conditions'), privacy: L('Reconozco la Política de Privacidad', 'I acknowledge the Privacy Policy'),
  openInNewTab: L('(se abre en una pestaña nueva)', '(opens in a new tab)'),

  coTitle: L('¿Quiénes son?', 'Who are you?'),
  hasBiz: L('¿Tu empresa se encuentra operando actualmente?', 'Is your company currently operating?'), yes: L('Sí', 'Yes'), no: L('No', 'No'), unknown: L('No lo sé', 'Not sure'),
  sector: L('¿A qué se dedica tu empresa?', 'What does your company do?'), sectorPh: L('p. ej., desarrollo de software', 'e.g. software development'),
  size: L('Aproximadamente, ¿cuántas personas trabajan hoy en tu empresa?', 'Roughly how many people work at your company today?'),
  sizes: { '1-10': L('1–10', '1–10'), '11-50': L('11–50', '11–50'), '51-250': L('51–250', '51–250'), '251-1000': L('251–1,000', '251–1,000'), '1000+': L('Más de 1,000', 'More than 1,000') },
  operatesIn: L('¿En qué países tiene hoy actividad tu empresa?', 'In which countries is your company active today?'), operatesInHelp: L('Donde tienes oficinas, plantas o equipo. Si ya vendes en el país al que quieres ir, lo indicarás más adelante.', 'Where you have offices, plants or staff. If you already sell in the country you want to expand to, you will tell us later.'), searchCountry: L('Busca un país', 'Search for a country'), none: L('Sin resultados', 'No results'),

  destTitle: L('¿A qué país o países quieres expandirte?', 'Which country or countries do you want to expand to?')   /* neutral: valid for an operating company and for a new business */, destLead: L('Puede ser uno o varios países.', 'It can be one or several countries.'),
  destLabel: L('Destino', 'Destination'), destOpen: L('Aún no lo tengo decidido', "I haven't decided yet"), region: L('Región o estado (opcional)', 'Region or state (optional)'),
  sameTitle: L('¿Tu proyecto será el mismo en todos estos países?', 'Will your project be the same in all these countries?'), sameLead: L('Por ejemplo, producir en uno y vender en otro', 'For example, produce in one and sell in another'),
  sameYes: L('Sí, lo mismo en todos', 'Yes, the same in all'), sameYesMany: L('Sí, lo mismo en todos', 'Yes, the same in all'), sameNo: L('No, es distinto en cada país', 'No, it differs by country'),
  actTitle: L('¿Qué planeas hacer en {country}?', 'What do you plan to do in {country}?'), actHelp: L('Puedes elegir varias', 'You can choose several'),
  acts: { sell: L('Vender', 'Sell'), produce: L('Producir', 'Produce'), source: L('Comprar a proveedores locales', 'Buy from local suppliers'), operate: L('Operar (dar servicios o ejecutar trabajos allí)', 'Operate (provide services or carry out work there)'), hire: L('Contratar personas', 'Hire people'), invest_only: L('Solo invertir, sin operar', 'Only invest, without operating') },
  withTitle: L('¿Qué vas a vender, producir o comprar en {country}?', 'What will you sell, produce or buy in {country}?'), withsHelp: L('Bienes físicos incluye productos terminados, materias primas y equipos.', 'Physical goods include finished products, raw materials and equipment.'),   // DSC-22
  withs: { goods: L('Bienes físicos', 'Physical goods'), services: L('Servicios', 'Services'), digital: L('Productos o servicios digitales', 'Digital products or services') },
  descPh: L('Cuéntalo con tus palabras (opcional)', 'Say it in your own words (optional)'),
  presTitle: L('¿Cómo piensas estar presente en {country}?', 'How do you plan to be present in {country}?'),
  pres: { remote: L('Desde mi país, sin estar allí', 'From my country, without being there'), third_parties: L('Con un socio o distribuidor', 'Through a partner or distributor'), own_physical: L('Con oficina, planta o local propio', 'With my own office, plant or premises'), own_onsite: L('Con mi equipo trabajando allí, sin oficina propia', 'With my team working there, without our own office'), acquisition: L('Comprando una empresa', 'By buying a company'), open: L('Aún por definir', 'Still to be decided') },
  perm: L('¿Tu proyecto en {country} será permanente o temporal?', 'Will your project in {country} be permanent or temporary?'), permOpts: { permanent: L('Permanente', 'Permanent'), temporary: L('Temporal', 'Temporary'), open: L('Aún por definir', 'Still to be decided') },
  permHelp: L('Temporal si tiene un final previsto, como una obra o un contrato.', 'Temporary if it has a planned end, such as a construction job or a contract.'),
  months: L('¿Cuántos meses?', 'How many months?'),
  existTitle: L('¿Qué actividad o presencia tienes hoy en {country}?', 'What activity or presence do you have in {country} today?'),
  exist: { nothing: L('Nada todavía', 'Nothing yet'), commercial_traction: L('Clientes, pedidos o conversaciones comerciales, sin presencia propia', 'Customers, orders or sales conversations, without my own presence'), own: L('Ya tengo presencia propia (oficina, equipo o empresa)', 'I already have my own presence (office, staff or company)') },
  existNote: L('Cuéntalo brevemente (opcional)', 'Tell us briefly (optional)'), existNoteHelp: L('Por ejemplo, un cliente, un pedido o una conversación en curso.', 'For example, a customer, an order or an ongoing conversation.'),

    r1Know: L('¿Ya tienes claro qué necesitas para avanzar?', 'Do you already know what you need to move forward?'), r1KnowHelp: L('Puedes ir directo a marcarlo; antes te haremos tres preguntas cortas.', "You can go straight to marking it; first we'll ask three short questions."),
  colTopic: L('Aplican a tu proyecto', 'Apply to your project'), colStatus: L('¿En qué punto está?', 'Where does it stand?'),
  colSupport: L('¿Quieres apoyo aquí?', 'Do you want support here?'), readyBefore: L('¿Listo antes de', 'Ready before'),
  catalogErrorTitle: L('No pudimos cargar Discovery', "We couldn't load Discovery"),
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

  reasonEyebrow: L('Lo que te mueve', "What's driving you"), reasonTitle: L('¿Por qué quieres hacerlo y por qué ahora?', 'Why do you want to do it, and why now?'),
  reasons: {
    client_request: L('Un cliente nos lo pidió', 'A customer asked us to'), follow_clients: L('Acompañar a clientes actuales', 'Follow current customers'), growth: L('Una oportunidad de crecimiento', 'A growth opportunity'),
    talent: L('Acceso a talento', 'Access to talent'), cost: L('Costos o eficiencia', 'Cost or efficiency'), resilience: L('Una cadena de suministro más resiliente', 'A more resilient supply chain'),
    diversify: L('Depender menos de un mercado', 'Depend less on one market'), contract: L('Ejecutar un contrato ganado', 'Execute a contract I won'), partner: L('Tener una base para crecer con nuevos clientes', 'A base to grow with new customers'), other: L('Otro motivo', 'Something else'),
  },
  reasonWords: L('Si quieres, cuéntalo con tus palabras (opcional)', 'If you like, tell us in your own words (optional)'), reasonWordsHelp: L('Una o dos frases son suficientes.', 'One or two sentences is enough.'),
  decTitle: L('¿En qué punto está la decisión sobre este proyecto?', 'Where does the decision on this project stand?'),
  dec: { exploring: L('Lo estoy explorando', "I'm exploring it"), decided: L('Está decidido; vemos cómo hacerlo', "It's decided; we're working out how"), in_progress: L('Ya está en marcha', "It's already under way") },
  dependsOn: L('¿De qué depende todavía?', 'What does it still depend on?'), dependsOnHelp: L('Puedes mencionar cualquier condición que todavía tenga que resolverse.', 'You can mention any condition that still needs to be resolved.'),
  startQ: L('¿Cuándo te gustaría arrancar este proyecto de expansión?', 'When would you like to start this expansion project?'),
  starts: { asap: L('Cuanto antes', 'As soon as possible'), '3m': L('En unos 3 meses', 'In about 3 months'), '6m': L('En unos 6 meses', 'In about 6 months'), '12m': L('En un año o más', 'In a year or more'), unknown: L('Aún por definir', 'Still to be decided') },
  extDate: L('¿Hay una fecha límite que no dependa de ti?', "Is there a deadline that doesn't depend on you?"), extDateHelp: L('Un contrato, una licitación, el compromiso con un cliente…', 'A contract, a tender, a commitment to a customer…'),
  dateLabel: L('Fecha', 'Date'), dateWhat: L('¿Qué ocurre ese día?', 'What happens that day?'), datePh: L('Ej. 2028-Q1 o 2026-12', 'e.g. 2028-Q1 or 2026-12'),

  scaleTitle: L('Tamaño del proyecto', 'Project size'), scaleWhy: L('Un dato aproximado basta. Solo nos ayuda a dimensionar el proyecto; no lo usamos para evaluarte.', "A rough figure is enough. It only helps us size the project; we don't use it to assess you."),
  scaleQ: {
    investment: L('¿Qué inversión estimas en', 'What investment do you expect in'), people: L('¿Cuántas personas contratarías en', 'How many people would you hire in'),
    products: L('¿Cuántos productos o líneas llevarías a', 'How many products or lines would you take to'), purchase: L('¿Qué volumen de compra prevés en', 'What purchase volume do you expect in'), duration: L('¿Cuánto durará el proyecto en', 'How long will the project last in'),
  },
  scaleDecline: L('Prefiero no decirlo', 'I prefer not to say'), scaleUnknown: L('Aún no lo sé', 'Not sure yet'),

  actTitle1: L('Unas preguntas rápidas para saber qué temas aplican a tu proyecto.', 'A few quick questions to see which topics apply to your project.'),
  sellTitle: L('Sobre lo que vendes', 'About what you sell'), siteTitle: L('Sobre tu operación en {country}', 'About your operation in {country}'),
  regulated: L('¿Tu producto o actividad está sujeto a alguna regulación específica en {destinations}?', 'Is your product or activity subject to any specific regulation in {destinations}?'), regulatedHelp: L('Por ejemplo, licencias, registros sanitarios o certificaciones para vender u operar.', 'For example, licences, health registrations or certifications to sell or operate.'),
  sellsTo: L('¿A qué tipo de clientes venderás en {country}?', 'What type of customers will you sell to in {country}?'), sellsToOpts: { companies: L('Empresas', 'Businesses'), government: L('Gobierno', 'Government'), consumers: L('Consumidores', 'Consumers'), mixed: L('Varios', 'A mix') },
  ownBrand: L('¿Venderás en {country} con una marca propia?', 'Will you sell in {country} under your own brand?'),
  location: L('¿Ya tienes elegido el lugar exacto en {country}?', 'Have you chosen the exact location in {country}?'), locationSite: L('¿Ya sabes dónde estará la obra?', 'Do you know where the site will be?'), locationRegion: L('Indicaste: {region}', 'You mentioned: {region}'), locOpts: { defined: L('Sí, ya está definido', "Yes, it's decided"), region_only: L('Tengo la zona; falta el lugar exacto', 'I have the area; the exact place is still open'), undecided: L('Aún no', 'Not yet') },
  carries: L('¿Vas a trasladar a {country} personas de tu empresa o maquinaria desde otro país?', 'Will you move people from your company or machinery to {country} from another country?'), carryOpts: { people: L('Personas de mi empresa', 'People from my company'), equipment: L('Maquinaria, herramientas o equipos de trabajo', 'Machinery, tools or work equipment'), nothing: L('Nada', 'Nothing') },

  topicsTitle: L('Estos son los temas de tu proyecto. ¿En qué punto está cada uno?', "These are your project's topics. Where does each one stand?"),
  topicsLead: L('Primero, dinos en qué punto está cada tema. Después te preguntamos dónde quieres apoyo', "First, tell us where each topic stands. Then we'll ask where you'd like support"),
  topicsLeadDate: L(' y qué debe estar listo antes de tu fecha clave', ' and what must be ready before your key date'),
  statuses: { resolved: L('Ya resuelto', 'Resolved'), in_progress: L('En marcha', 'Under way'), pending: L('Pendiente', 'Pending'), unknown: L('No lo sé', 'Not sure') },
  missing: L('¿Necesitas algo que no aparece aquí? Escríbelo.', "Need something that isn't listed? Write it here."), missingPh: L('Escríbelo con tus palabras', 'Write it in your own words'), add: L('Añadir', 'Add'),
  yevNotApply: L('Temas que no aplican a tu proyecto', "Topics that don't apply to your project"),   // DSC-07 (PO, 2026-10-21): the YEV lists them WITHOUT a reason until Product approves one per rule
  notApply: L('No aplican, por lo que nos contaste', 'Not relevant, based on what you told us'),
  dependsTitle: L('Todavía no está definido', "It's not yet defined"), dependsLead: L('De esa decisión depende:', 'That decision affects:'), dependsTag: L('Depende', 'Depends'),
  causes: { presence: L('cómo estarás presente en', 'how you will be present in'), hire: L('cómo contrates', 'how you hire'), legal_operation: L('cómo operarás legalmente en', 'how you will operate legally in') },
  possible: L('Posible', 'Possible'),
  supportTitle: L('¿En qué temas te gustaría que beeside te apoye?', "On which topics would you like beeside's support?"), supportLead: L('Solo en los temas que aún no están resueltos. «No» no significa que no quieras delegarlo más adelante.', "Only on topics not yet resolved. “No” doesn't mean you won't want to delegate it later."),
  markTitle: L('Marca los temas en los que necesitas apoyo', 'Mark the topics you need support with'), markLead: L('Estos temas aplican a tu proyecto. Lo que no marques quedará como «no indicado», no como resuelto.', 'These topics apply to your project. Anything you leave unmarked stays “not indicated”, not “resolved”.'),
  concreteQ: L('¿Buscas algo concreto? Escríbelo', 'Looking for something specific? Write it'), concretePh: L('Por ejemplo, grúas', 'For example, cranes'),
  related: L('Lo relacionamos con', 'We linked it to'), change: L('Cambiar', 'Change'), applyHere: L('Aplican a tu proyecto', 'Apply to your project'),
  markedCount: L('Marcados', 'Marked'), notIndicated: L('No indicado', 'Not indicated'), otherTopics: L('Otros temas que aplican', 'Other topics that apply'),
  criticalTitleQuarter: L('¿Qué temas deben estar listos antes de', 'Which topics need to be ready before'), criticalTitleDate: L('¿Qué temas deben estar listos antes de', 'Which topics need to be ready before'), criticalTitle: L('¿Qué temas deben estar listos según tu calendario?', 'Which topics need to be ready according to your schedule?'), criticalLead: L('Marca los temas atados a una fecha que no puedes mover.', "Mark the topics tied to a date you can't move."),
  cargoTitle: L('¿Dónde necesitas mover la carga?', 'Where do you need to move the cargo?'),
  cargo: (c: string) => ({ within: L(`Dentro de ${c}`, `Within ${c}`), into_from_abroad: L(`Hacia ${c} desde otro país`, `Into ${c} from another country`), both: L('Ambos', 'Both'), unknown: L('Aún no lo sé', 'Not sure yet') }),

  valuesTitle: L('¿Qué es lo más importante para ti al recibir apoyo?', 'What matters most to you when getting support?'), valuesLead: L('Elige lo que más valoras. Puedes saltar este paso.', 'Choose what you value most. You can skip this step.'),
  values: { speed: L('Velocidad', 'Speed'), no_network: L('No construir red desde cero', "Not building a network from scratch"), single_contact: L('Un solo interlocutor', 'A single point of contact'), local_validation: L('Validación local', 'Local validation'), comparable_options: L('Alternativas comparables', 'Comparable options'), coordination: L('Coordinación', 'Coordination'), cost: L('Costo', 'Cost'), keep_control: L('Mantener el control de mi equipo', 'Keeping control of my team') },
  keepQ: L('¿Qué prefieres seguir haciendo con tu propio equipo?', 'What would you rather keep doing with your own team?'),
  extraTitle: L('¿Hay algo más de tu proyecto que nos quieras contar?', "Is there anything else about your project you'd like to tell us?"), extraLead: L('Nada depende de este paso.', 'Nothing depends on this step.'),
  success: L('¿Cómo sabrás que la expansión salió bien?', 'How will you know the expansion went well?'), successHelp: L('Una o dos frases son suficientes.', 'One or two sentences is enough.'), constraints: L('¿Hay algo que hoy frene o limite el proyecto?', 'Is anything holding back or limiting the project today?'), constraintsHelp: L('Una o dos frases son suficientes.', 'One or two sentences is enough.'),
  descr: L('Otros detalles (opcional)', 'Other details (optional)'), experience: L('¿Has intentado antes expandirte a otro país?', 'Have you tried expanding to another country before?'), experienceHelp: L('Cuéntanos brevemente qué pasó y qué fue difícil.', 'Tell us briefly what happened and what was hard.'),
  personal: L('¿Hay alguna necesidad personal, tuya o de alguien de tu equipo, relacionada con este proyecto?', 'Is there a personal need, for you or someone on your team, related to this project?'), personalHelp: L('Solo queremos saber si existe; no necesitamos detalles.', 'We only need to know it exists; no details needed.'),
  reqField: L('Falta responder esto para continuar.', 'This is needed to continue.'), reqSummary: L('Para continuar, completa:', 'To continue, please complete:'),
  seeResult: L('Ver mi resultado', 'See my result'),
  generating: L('Preparando tu resultado…', 'Preparing your result…'), resultError: L('No pudimos preparar el resultado. Inténtalo de nuevo.', "We couldn't prepare your result. Please try again."),

  // ----- result -----
  yev: L('Your Expansion View', 'Your Expansion View'), glance: L('De un vistazo', 'At a glance'), topics: L('temas', 'topics'),
  yourProject: L('Tu proyecto', 'Your project'), whyNow: L('Por qué ahora', 'Why now'), whyNowWords: L('Por qué ahora, en tus palabras', 'Why now, in your words'),
  decided: L('Ya decidido', 'Already decided'), stillOpen: L('Todavía abierto', 'Still open'), projectSize: L('Tamaño del proyecto', 'Project size'), goodResult: L('Cómo sabrás que salió bien', "How you'll know it went well"),
  fixSomething: L('Corregir algo', 'Edit something'),
  whatItInvolves: L('Lo que toca', 'What it involves'), whereYouAre: L('Dónde estás', 'Where you are'),
  resolved: L('Ya resuelto', 'Resolved'), underWay: L('En marcha', 'Under way'), pendingL: L('Pendiente', 'Pending'),
  alreadyHave: L('Lo que ya tienes', 'What you already have'),
  whereValue: L('Where beeside adds value.', 'Where beeside adds value.'), whereValueTitle: L('Dónde puede aportar beeside en tu proyecto', 'Where beeside can add value to your project'),
  valuedSupport: L('Lo que valoras en un apoyo', 'What you value in support'), keptTeam: L('Lo que mantienes en tu equipo', 'What you keep in-house'),
  criticalTag: L('Fecha crítica', 'Critical date'), nextStep: L('Siguiente paso', 'Next step'),
  premiumBody: L('Mantén integrada tu estrategia, coordina cada tema con tu Sherpa y activa las capacidades que tu proyecto necesita para ejecutarse.', 'Keep your strategy integrated, coordinate every topic with your Sherpa and activate the capabilities your project needs to execute.'),
  continueWith: L('Start Your Expansion', 'Start Your Expansion'),   // branded CTA, identical in ES and EN (PO, 2026-10-14)
  continued: L('Listo. Tu beeside Sherpa revisará tu Your Expansion View y te escribirá desde contact@beeside.you dentro de 2 días hábiles para agendar la llamada. Todavía no hay ningún pago.', 'Done. Your beeside Sherpa will review your Your Expansion View and write to you from contact@beeside.you within 2 business days to schedule the call. There is no payment yet.'),
  confirmTitle: L('¿Confirmas que quieres comenzar?', 'Do you confirm you want to start?'),
  confirmBody: L('Este será tu Your Expansion View definitivo: al confirmar, tus respuestas quedan cerradas. Tu beeside Sherpa lo revisará y te contactará. No hay ningún pago en este paso.', 'This will be your final Your Expansion View: once you confirm, your answers are closed. Your beeside Sherpa will review it and contact you. There is no payment in this step.'),
  // Used only when a Premium purchase destination is configured (VITE_FA4_PREMIUM_PURCHASE_URL): no mention of Sherpa review or «no payment». ES/EN = proposal for copy sign-off.
  confirmBodyPay: L('Este será tu Your Expansion View definitivo: al confirmar, tus respuestas quedan cerradas y continúas al siguiente paso.', 'This will be your final Your Expansion View: once you confirm, your answers are closed and you continue to the next step.'),
  confirmGo: L('Confirmar y continuar', 'Confirm and continue'), continuedPay: L('Listo. Te llevamos al siguiente paso…', 'Done. Taking you to the next step…'),
  confirmYes: L('Sí, comenzar', 'Yes, start'), confirmNo: L('Todavía no', 'Not yet'),
  emailFinalNote: L('Al recibirlo por correo, este será tu Your Expansion View definitivo y tus respuestas quedarán cerradas.', 'Once you receive it by email, this will be your final Your Expansion View and your answers will be closed.'),
  deliveredNote: L('Este es tu Your Expansion View definitivo.', 'This is your final Your Expansion View.'),
  emailResult: L('Recibir este resultado por email', 'Get this result by email'), emailed: L('Te lo enviamos al email que nos diste.', 'We sent it to the email you gave us.'),
  noPremiumTitle: L('Tu proyecto, más claro', 'Your project, with more clarity'),
  noPremiumBody: L('Por ahora no vemos un siguiente paso de beeside que aporte suficiente valor a este proyecto. Your Expansion View queda como tu resultado y puedes volver cuando el proyecto cambie o aparezca una nueva necesidad.', "For now, we don't see a next beeside step that would add enough value to this project. Your Expansion View remains your result, and you can come back when the project changes or a new need appears."),
  backToStart: L('Volver al inicio', 'Back to the start'),
  footerCopy: L('© 2026 beeside', '© 2026 beeside'), termsLink: L('Términos y Condiciones', 'Terms and Conditions'), privacyLink: L('Política de Privacidad', 'Privacy Policy'),
  aboutBeeside: L('Sobre beeside', 'About beeside'),
  // Discovery v1.0 (PO, 2026-10-14): approved localized brand lines (not literal translations).
  vsHeadline: L('Piensa en grande.\nNosotros nos ocupamos del resto.', 'Think bigger.\nExpand smarter.'),
  // Value of Continuing — commercial comparison (PO, 2026-10-14). EN = approved reference copy; ES = translation proposal for PO copy sign-off.
  cmpEyebrow: L('Por qué continuar con beeside', 'Why continue with beeside'),
  // PO copy (2026-10-15): fixed institutional text, identical for every result (never project data). EN subtitle = translation proposal pending PO sign-off.
  cmpTitle: L('Entrar es solo el comienzo; crecer viene con beeside.', 'Entering a market is a milestone. Building a presence takes beeside.'),
  cmpLead: L('Continuar con beeside significa mantener integrada la estrategia, coordinación y red local que tu proyecto necesita para avanzar.', 'Continuing with beeside means keeping integrated the strategy, coordination and local network your project needs to move forward.'),
  cmpOption: L('Opción', 'Option'), cmpComplexity: L('Complejidad', 'Complexity'),
  cmpIncluded: L('Incluido', 'Included'), cmpNotIncluded: L('No incluido', 'Not included'),
  cmpOf: L('{n} de {total} capacidades', '{n} of {total} capabilities'),
  cmpOptions: [
    { key: 'premium', name: L('beeside Premium', 'beeside Premium'), sub: L('Sistema coordinado', 'Coordinated system'), complexity: 0.18, covered: 8 },
    { key: 'local', name: L('Contratar a una persona local', 'Hire one local person'), sub: L('Una sola especialidad, un solo punto de vista', 'One skillset, one point of view'), complexity: 0.45, covered: 0 },
    { key: 'office', name: L('Oficina + una persona', 'Office + one person'), sub: L('Suma costos fijos', 'Fixed overhead added'), complexity: 0.7, covered: 0 },
    { key: 'travel', name: L('Oficina + persona + viajes', 'Office + person + travel'), sub: L('El mayor costo y sigue fragmentado', 'Highest cost, still fragmented'), complexity: 0.97, covered: 0 },
  ],
  cmpDims: [L('Activación de varios servicios', 'Multi-service activation'), L('Acceso a especialistas', 'Specialist access'), L('Visibilidad del proyecto', 'Project visibility'), L('Coordinación', 'Coordination'),
    L('Ecosistema seleccionado', 'Curated ecosystem'), L('Continuidad', 'Continuity'), L('Plataforma digital 24/7', '24/7 digital platform access'), L('Documentación centralizada', 'Centralized documentation')],
  cmpNote: L('Solo dimensiones de capacidad coordinada: no es un juicio sobre las personas ni las oficinas, ni una cifra de costo. No se muestran importes hasta contar con datos comerciales validados. La comparación es ilustrativa y no representa precios garantizados.', 'Coordinated-capability dimensions only — not a judgment on the people or offices themselves, and not a cost figure. No monetary values are shown until validated commercial data is available. The comparison is illustrative and does not represent guaranteed pricing.'),
  // Next step — destination-aware (PO, 2026-10-14)
  premiumTitle: L('Con beeside Premium pasas del diagnóstico a la ejecución.', 'With beeside Premium, you move from diagnosis to execution.'),   // DSC-08 (PO, 2026-10-21)
  // BeesideValueSection (PO-approved copy, D-134). Headline: see vsHeadline (Discovery v1.0 brand lines).
  vsSherpa: L('Tu Sherpa', 'Your Sherpa'), vsSherpaD: L('Una persona que coordina tu expansión y mantiene continuidad de principio a fin.', 'One person coordinating your expansion and keeping continuity from start to finish.'),
  vsHive: L('The Hive', 'The Hive'), vsHiveD: L('Especialistas y proveedores seleccionados para las necesidades de tu proyecto.', 'Curated specialists and providers for the needs of your project.'),
  vsHub: L('Operation Hub', 'Operation Hub'), vsHubD: L('Un solo lugar para seguir avances, tareas, documentos y próximos pasos.', 'One place to follow progress, tasks, documents and next steps.'),
  vsAdvisory: L('Strategic Advisory', 'Strategic Advisory'), vsAdvisoryD: L('Experiencia especializada para ayudarte a resolver decisiones complejas de expansión.', 'Specialized expertise to help you navigate complex expansion decisions.'),
  idBeforeTitle: L('Antes de continuar', 'Before you continue'),
  idBeforeLead: L('Revisa y acepta lo necesario para continuar con tu Discovery.', "Review and accept what's required to continue with your Discovery."),
  marketingConsent: L('Quiero recibir novedades, información y comunicaciones comerciales de beeside.', 'I would like to receive news, information and commercial communications from beeside.'),
  acceptContinue: L('Aceptar y continuar', 'Accept and continue'),
  // Discovery v1.0 (PO, 2026-10-14): approved customer-facing wording; no change to privacy logic.
  privacyNotice: L('La información que nos compartiste no se comparte con proveedores en esta etapa. Si decides continuar, te pediremos autorización antes de compartirla.', "The information you shared with us is not shared with providers at this stage. If you decide to continue, we'll ask for your authorization before sharing it."),

  // ----- Presentation RC (Design): persistent access, contact, date picker, email + error/success states -----
  idOptionalTitle: L('Comunicaciones opcionales', 'Optional communications'), optionalTag: L('Opcional', 'Optional'),
  help: L('Necesito ayuda', 'I need help'), helpNewTab: L('Se abre en una pestaña nueva', 'Opens in a new tab'),
  talk: L('Hablar con beeside', 'Talk to beeside'), menu: L('Ayuda y contacto', 'Help and contact'), close: L('Cerrar', 'Close'),
  talkTitle: L('Hablar con beeside', 'Talk to beeside'),
  talkLead: L('Escríbenos y una persona del equipo de beeside te responderá desde {contact}.', 'Write to us and someone from the beeside team will reply from {contact}.'),
  talkMessage: L('Mensaje', 'Message'), talkSend: L('Enviar mensaje', 'Send message'), talkSending: L('Enviando…', 'Sending…'),
  talkShare: L('Compartir mi avance del Discovery para que podamos ayudarte mejor.', 'Share my Discovery progress so we can help you better.'),
  talkNote: L('Es un mensaje directo al equipo de beeside. No te suscribe a comunicaciones comerciales y no se comparte con proveedores.', "This goes straight to the beeside team. It doesn't subscribe you to commercial communications and isn't shared with providers."),
  talkSent: L('Recibimos tu mensaje. Te responderemos en {email}.', "We've received your message. We'll reply to {email}."),
  talkError: L('No pudimos enviar tu mensaje. Revisa tu conexión e inténtalo de nuevo; lo que escribiste sigue aquí.', "We couldn't send your message. Check your connection and try again; what you wrote is still here."),
  datePrecision: L('¿Con qué precisión la conoces?', 'How precisely do you know it?'), byMonth: L('Mes', 'Month'), byQuarter: L('Trimestre', 'Quarter'),
  dateYear: L('Año', 'Year'), dateMonth: L('Mes', 'Month'), dateQuarter: L('Trimestre', 'Quarter'),
  monthNames: [L('enero','January'),L('febrero','February'),L('marzo','March'),L('abril','April'),L('mayo','May'),L('junio','June'),L('julio','July'),L('agosto','August'),L('septiembre','September'),L('octubre','October'),L('noviembre','November'),L('diciembre','December')] as L10n[],
  quarterNames: [L('1.er trimestre','Q1'),L('2.º trimestre','Q2'),L('3.er trimestre','Q3'),L('4.º trimestre','Q4')] as L10n[],
  emailSending: L('Enviando…', 'Sending…'),
  emailSent: L('Te enviamos tu Your Expansion View a {email}. Si no lo ves en unos minutos, revisa la carpeta de correo no deseado.', "We've sent your Your Expansion View to {email}. If you don't see it in a few minutes, check your spam folder."),
  // DSC-33 (Stabilization only): shown ONLY for the recipient-policy refusal code; every other failure keeps `emailFailed`.
  emailNotAuthorized: L('Durante la etapa de Estabilización sólo podemos enviar el resultado a direcciones autorizadas. Tu resultado sigue disponible aquí.', 'During Stabilization we can only send results to authorized addresses. Your result is still available here.'),
  emailFailed: L('No pudimos enviarlo ahora. Tu resultado sigue aquí; inténtalo de nuevo en un momento.', "We couldn't send it right now. Your result is still here; please try again in a moment."),
  // Stabilization notice (closed test only; PO copy, 2026-10-16)
  stabTitle: L('Discovery está en etapa de Estabilización', 'Discovery is in the Stabilization phase'),
  stabP1: L('Esta versión está siendo utilizada para validar su funcionamiento antes de su apertura comercial.', 'This version is being used to validate the platform before its commercial launch.'),
  stabP2: L('Por favor, utiliza únicamente información ficticia o de prueba. No ingreses datos reales, confidenciales, personales o comerciales.', 'Please use only fictitious or test information. Do not enter real, confidential, personal, or commercial data.'),
  stabP3: L('La información que ingreses será procesada únicamente para generar tu Your Expansion View (YEV) durante esta prueba. No será utilizada para procesos internos, comerciales ni operativos de beeside.', 'The information you enter will be processed solely to generate your Your Expansion View (YEV) during this test. It will not be used for beeside\u2019s internal, commercial, or operational processes.'),
  stabP4: L('Toda la información registrada durante esta etapa será eliminada antes de pasar a Producción.', 'All information recorded during this stage will be deleted before the platform moves to Production.'),
  stabP5: L('Al continuar, confirmas que utilizarás únicamente datos ficticios o de prueba.', 'By continuing, you confirm that you will use only fictitious or test data.'),
  stabConfirm: L('Entendido, continuar', 'I understand, continue'),
  // Personal e-mail warning (advisory; PO copy, 2026-10-16)
  personalEmailTitle: L('Parece que estás usando un correo personal.', "It looks like you're using a personal email address."),
  personalEmailBody: L('Recomendamos utilizar tu correo corporativo para identificar mejor tu proyecto y facilitar la continuidad con beeside.', 'We recommend using your work email so we can better identify your project and support continuity with beeside.'),
  personalEmailOther: L('Usar otro correo', 'Use another email'), personalEmailKeep: L('Continuar con este correo', 'Continue with this email'),
  tryAgain: L('Intentar de nuevo', 'Try again'),
  savedOk: L('Guardado. Te enviamos a {email} un enlace para continuar donde lo dejaste.', "Saved. We've sent {email} a link to continue where you left off."),
  linkSending: L('Guardando tu avance y enviando tu enlace…', 'Saving your progress and sending your link…'),
  linkFailed: L('Tu avance está guardado, pero no pudimos enviarte el enlace. Inténtalo de nuevo en un momento.', "Your progress is saved, but we couldn't send your link. Please try again in a moment."),
  resumed: L('Hola de nuevo. Seguimos donde lo dejaste.', "Welcome back. Let's pick up where you left off."),
  linkInvalidTitle: L('Este enlace ya no es válido', 'This link is no longer valid'),
  linkInvalidBody: L('Por seguridad, cada enlace funciona una sola vez y caduca. Pide uno nuevo y te lo enviamos al mismo correo.', 'For security, each link works only once and expires. Ask for a new one and we will send it to the same email.'),
  linkRequest: L('Enviarme un enlace nuevo', 'Send me a new link'),
  offlineTitle: L('Sin conexión', "You're offline"),
  offlineBody: L('Tu avance está guardado en este dispositivo. Cuando vuelva la conexión, seguimos.', "Your progress is kept on this device. We'll continue when you're back online."),
  staleTitle: L('Tu sesión se cerró por inactividad', 'Your session closed after inactivity'),
  staleBody: L('Lo que respondiste está guardado. Pide un enlace para continuar donde lo dejaste.', 'Your answers are saved. Ask for a link to continue where you left off.'),
  resumeContinue: L('Continuar donde lo dejaste', 'Pick up where you left off'),
  linkRequested: L('Si ese correo tiene un proyecto, te enviaremos un enlace nuevo en unos minutos.', "If that email has a project, we'll send you a new link in a few minutes."),
  topicsErrorTitle: L('No pudimos preparar esta parte', "We couldn't prepare this section"),
  startNew: L('Empezar de nuevo', 'Start over'),
  resolveErrorTitle: L('No pudimos preparar tu resultado', "We couldn't prepare your result"),
  resolveErrorBody: L('Tus respuestas están guardadas. Inténtalo de nuevo en un momento.', 'Your answers are saved. Please try again in a moment.'),
  catalogErrorTitle2: L('No pudimos cargar Discovery', "We couldn't load Discovery"),
  ready: L('Your Expansion View ya está listo.', 'Your Expansion View is ready.'),
  conditions: L('Condiciones de los servicios', 'Service conditions'),
  noTopicFound: L('No encontramos un tema para esto; lo guardamos tal como lo escribiste.', "We couldn't match this to a topic; we've saved it as you wrote it."),
  benefitsText: { clarity: L('Claridad desde el primer día', 'Clarity from day one'), expert: L('Acompañamiento experto', 'Expert guidance'), global: L('Expansión global', 'Global expansion'), real: L('Oportunidades reales', 'Real opportunities') },
} as const;

export type UiKey = keyof typeof UI;
export const tr = (l: L10n, locale: Locale) => l[locale];

/** "Porque …" explanation shown under each topic (derived from the declared facts that activated it). */
const BECAUSE: Record<string, L10n> = {
  own_premises: L('tendrás presencia propia', 'you will have a presence of your own'), own_plant: L('tendrás planta propia', 'you will have your own plant'),
  own_presence: L('tendrás presencia propia', 'you will have your own presence'), hire: L('vas a contratar personas', 'you will hire people'),
  operate: L('vas a operar', 'you will operate'), produce: L('vas a producir en el lugar', 'you will produce on site'), source: L('comprarás a proveedores locales', 'you will buy from local suppliers'),
  sell: L('vas a vender', 'you will sell'), goods_cross: L('tus bienes cruzarán fronteras', 'your goods will cross borders'), goods: L('manejarás bienes físicos', 'you will handle physical goods'),
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
