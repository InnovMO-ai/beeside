import type { Answers, ProjectComponent, StartWhen } from '../domain/answers';
import { OPEN_DEST, deriveDecision } from '../domain/answers';
import type { Catalog, FrontKey, Locale, RoutingState } from '../domain/types';
import { L, NC, countryL10n, type L10n, type VisibleStateKey, visibleStateKey } from '../i18n/messages';
import type { CountryMessageKind, Resolution, ResolvedNeed } from './resolve';
import { resolveAll } from './resolve';
import { NA_DISPLAY_FRONTS, type DependsCause, type NotApplicableGroup } from './frontRules';

/**
 * YourExpansionView data model — dynamic, project-specific (D-120/D-121). Fixed institutional content lives in
 * BeesideValueSection and is NOT part of this model. The model is self-contained (names embedded in ES+EN) so a
 * stored record never changes when the catalog does (D-117).
 */
export interface Topic { front: FrontKey; name: L10n; possible?: boolean }
export interface YevValueItem {
  front: FrontKey; name: L10n; state: RoutingState; capabilities: L10n[]; conditionalNotes: L10n[]; quotes: string[];
  critical: boolean; possible: boolean;
}
export interface YevValueGroup { key: VisibleStateKey; items: YevValueItem[] }
export interface YevDestination {
  destination: string; name: L10n; region?: string;
  countryMessage: CountryMessageKind | null;
  topicCount: number;
  glance: Array<{ key: VisibleStateKey; count: number }>;
  applies: Topic[];
  depends: { cause: DependsCause; topics: Topic[] } | null;
  /** RULE 6/9: canonical Front Catalog names, one group per declared negative. */
  notApplicable: Array<{ fronts: Topic[]; reason: L10n }>;
  involvesNote: L10n | null;
  valueGroups: YevValueGroup[];
  valueFootnotes: L10n[];
  notIndicated: Topic[];
  marked: Topic[];
  unmapped: Array<{ text: string; stateKey: VisibleStateKey }>;
}
export interface YourExpansionViewModel {
  kind: 'YourExpansionView';
  catalogVersion: string;
  generatedAt: string;
  locale: Locale;
  company: string;
  title: L10n;
  subtitle: L10n;
  shortcut: boolean;
  projectParagraphs: L10n[];
  whyNow: { quote: string | null; reasons: L10n[] };
  decided: L10n[];
  stillOpen: L10n[];
  projectSize: L10n[];
  successQuote: string | null;
  counts: { applies: number; depends: number; marked: number; notIndicated: number };
  whereYouAre: { resolved: number; inProgress: number; pending: number; unanswered: number; notIndicated: number; marked: number; sentences: L10n[]; alreadyHave: string[] };
  support: { valued: string | null; keep: string | null };
  destinations: YevDestination[];
  premium: { shown: boolean; headline: L10n; multiDestination: boolean };
}

const frontName = (cat: Catalog, f: FrontKey): L10n => {
  const d = cat.fronts.find((x) => x.key === f);
  return L(d?.nameEs ?? f, d?.nameEn ?? f);
};
const cap1 = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const low1 = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/** Reasons for "not relevant" groups: literal frozen copy where it exists; the unverified side is marked NEEDS_CANONICAL_COPY. */
function naReason(g: NotApplicableGroup, c: ProjectComponent): L10n {
  switch (g) {
    case 'sell': return L('El proyecto no incluye vender allí', 'The project does not include selling there');      // frozen B (ES+EN)
    case 'place': return c.presence === 'own_onsite'
      ? NC('na.place.onsite', 'No tendrás espacio propio', "You won't have premises of your own")                     // ES frozen C
      : NC('na.place.office', 'No abrirás oficina', "You won't open an office");                                       // ES frozen A
    case 'goods': return NC('na.goods', 'No moverás bienes', "You won't move goods");                                 // ES frozen A
    case 'housing_exit': return L('Presencia permanente', 'Permanent presence');                                      // frozen B (ES+EN)
  }
}

export const START_LABEL: Record<StartWhen, L10n> = {
  asap: NC('yev.start.asap', 'Empezar cuanto antes', 'Start as soon as possible'),
  '3m': NC('yev.start.3m', 'Empezar en unos 3 meses', 'Start in about 3 months'),
  '6m': L('Empezar en unos 6 meses', 'Start in about 6 months'),
  '12m': NC('yev.start.12m', 'Empezar en un año o más', 'Start in a year or more'),
  unknown: NC('yev.start.unknown', 'Momento de inicio aún por definir', 'Start date still to be defined'),
};

export function formatKeyDate(raw: string | undefined, locale: Locale): string {
  if (!raw) return '';
  const q = /^(\d{4})-Q([1-4])$/.exec(raw);
  if (q) return locale === 'es' ? `${q[2]}.er trimestre de ${q[1]}`.replace(/^([234])\.er/, '$1.º') : `Q${q[2]} ${q[1]}`;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(raw);
  if (m) {
    const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +(m[3] ?? 1)));
    return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: 'long', ...(m[3] ? { day: 'numeric' } : {}) }).format(d);
  }
  return raw;
}

const ACTIVITY_VERB: Record<string, L10n> = {
  sell: NC('yev.verb.sell', 'vender', 'sell'), produce: NC('yev.verb.produce', 'producir', 'produce'), source: NC('yev.verb.source', 'comprar a proveedores locales', 'buy from local suppliers'),
  operate: NC('yev.verb.operate', 'operar', 'operate'), hire: NC('yev.verb.hire', 'contratar personas', 'hire people'), invest_only: NC('yev.verb.invest_only', 'invertir sin operar', 'invest without operating'),
};
function joinL(items: L10n[]): L10n {
  const j = (xs: string[], and: string) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${and} ${xs[xs.length - 1]}`);
  return L(j(items.map((i) => i.es), 'y'), j(items.map((i) => i.en), 'and'));
}
const destLabel = (a: Answers, iso: string): L10n => {
  const reg = a.destinations.list.find((d) => d.iso === iso)?.region;
  return reg ? L(reg, reg) : countryL10n(iso);
};
const destCountry = (iso: string) => countryL10n(iso);

function componentPhrase(c: ProjectComponent, a: Answers): L10n {
  if (c.description) { const d = cap1(c.description.replace(/^(una?|el|la|an?|the)\s+/i, '')); return L(d, d); }
  const acts = c.activities;
  if (acts.includes('produce') && c.presence === 'own_physical') return L('Planta propia', 'Own plant');
  if (acts.length === 1 && acts[0] === 'hire') {
    const t = a.scale[c.id]?.text;
    return t ? L(`Un equipo de ${t}`, `A team of ${t}`) : NC('yev.phrase.team', 'Un equipo', 'A team');
  }
  if (acts.includes('sell')) return NC('yev.phrase.commercial', 'Presencia comercial', 'Commercial presence');
  if (acts.includes('invest_only')) return NC('yev.phrase.invest', 'Inversión', 'Investment');
  return NC('yev.phrase.operation', 'Operación', 'Operation');
}

function presenceTail(c: ProjectComponent): L10n {
  const dur = c.durationMonths ? (c.durationMonths % 12 === 0 ? L(`unos ${c.durationMonths / 12} años`, `about ${c.durationMonths / 12} years`) : L(`unos ${c.durationMonths} meses`, `about ${c.durationMonths} months`)) : null;
  if (c.permanence === 'temporary') return NC('yev.tail.temporary', `durante ${dur?.es ?? 'un periodo definido'}, con fin previsto`, `for ${dur?.en ?? 'a defined period'}, with a planned end`);
  switch (c.presence) {
    case 'own_physical': return c.activities.includes('produce') ? NC('yev.tail.plant', 'de forma permanente y con planta propia', 'permanently and with your own plant') : NC('yev.tail.own', 'con presencia propia', 'with your own presence');
    case 'own_onsite': return NC('yev.tail.onsite', 'ejecutando en sitio', 'executing on site');
    case 'third_parties': return NC('yev.tail.third', 'a través de terceros', 'through third parties');
    case 'remote': return NC('yev.tail.remote', 'de forma remota', 'remotely');
    case 'acquisition': return NC('yev.tail.acq', 'mediante una adquisición', 'through an acquisition');
    default: return NC('yev.tail.open', 'aún sin definir cómo', 'with the form still to be defined');
  }
}

export function projectParagraphs(a: Answers): L10n[] {
  const out: L10n[] = [];
  for (const c of a.components) {
    const dests = c.destinations.map((d) => destCountry(d));
    const where = joinL(dests);
    const verbs = joinL(c.activities.map((x) => ACTIVITY_VERB[x]!));
    const open = c.presence === 'open' || c.presence === null;
    const body: L10n = c.description
      ? NC('yev.para.described', `En ${where.es} quieres ${c.description}${open ? '; aún no has definido de qué forma' : ''}.`, `In ${where.en} you want ${c.description}${open ? '; you have not yet defined the form' : ''}.`)
      : open
        ? NC('yev.para.open', `En ${where.es} quieres ${verbs.es}. Aún no has definido cómo hacerlo.`, `In ${where.en} you want to ${verbs.en}. You have not yet defined how.`)
        : NC('yev.para.defined', `En ${where.es} quieres ${verbs.es}, ${presenceTail(c).es}.`, `In ${where.en} you want to ${verbs.en}, ${presenceTail(c).en}.`);
    const today = c.existing === 'nothing' ? NC('yev.para.nothing', ' Hoy no tienes presencia allí.', " Today you have no presence there.")
      : c.existingNote ? NC('yev.para.today', ` Hoy ${low1(c.existingNote).replace(/^vendes/, 'vendes')}.`, ` Today: ${low1(c.existingNote)}.`) : L('', '');
    out.push(L(body.es + today.es, body.en + today.en));
  }
  if (a.components.length > 1 && a.projectConfirmed) out.push(L('Lo consideras un solo proyecto.', 'You see it as a single project.'));
  return out;
}

function buildTitle(a: Answers): L10n {
  if (a.components.length === 0) return L('Tu proyecto de expansión', 'Your expansion project');
  const parts = a.components.map((c) => {
    const phrase = componentPhrase(c, a);
    const where = joinL(c.destinations.map((d) => destLabel(a, d)));
    return L(`${phrase.es} en ${where.es}`, `${phrase.en} in ${where.en}`);
  });
  return L(
    parts.map((p, i) => (i === 0 ? p.es : low1(p.es))).join(' y '),
    parts.map((p, i) => (i === 0 ? p.en : low1(p.en))).join(' and '),
  );
}

/**
 * "Not relevant, based on what you told us" (Rules 6 + 9): at most 3 groups, canonical Front Catalog names, reasons only from
 * declared negatives. Shown for a destination when it is the only one or when its presence model is already defined.
 */
export function buildNotApplicable(
  plan: { component?: ProjectComponent; notApplicable: NotApplicableGroup[] },
  topic: (front: FrontKey) => Topic,
  destinationCount: number,
): Array<{ fronts: Topic[]; reason: L10n }> {
  const comp = plan.component;
  if (!comp || !(destinationCount === 1 || comp.presence !== 'open')) return [];
  return plan.notApplicable.slice(0, 3).map((g) => ({ fronts: NA_DISPLAY_FRONTS[g].map((f) => topic(f)), reason: naReason(g, comp) }));
}

export function buildYourExpansionView(a: Answers, catalog: Catalog, now = new Date(), resolution?: Resolution): YourExpansionViewModel {
  const res = resolution ?? resolveAll(a, catalog);
  const shortcut = a.knowsNeeds === true;
  const premiumShown = res.premiumShown;

  const destinations: YevDestination[] = res.destinations.map((d) => {
    const plan = d.plan;
    const comp = plan.component;
    const nameL = d.destination === OPEN_DEST ? countryL10n(OPEN_DEST) : countryL10n(d.destination);
    const region = a.destinations.list.find((x) => x.iso === d.destination)?.region;
    const topic = (front: FrontKey, possible = false): Topic => ({ front, name: frontName(catalog, front), ...(possible ? { possible } : {}) });
    const applies = d.topics.filter((t) => t.kind === 'applies').map((t) => topic(t.front, t.possible));
    const dependsTopics = d.topics.filter((t) => t.kind === 'depends').map((t) => topic(t.front));

    const valueNeeds = d.countryMessage ? [] : d.needs;
    const order: VisibleStateKey[] = ['ACTIVE', 'SOURCEABLE', 'REVIEW', 'DEPENDENT', 'TO_REVIEW_WITH_SHERPA', 'TOPIC_TO_CONSIDER'];
    const groups = new Map<VisibleStateKey, YevValueItem[]>();
    for (const n of valueNeeds) {
      const key = visibleStateKey(n.state, premiumShown);
      const item: YevValueItem = {
        front: n.front, name: frontName(catalog, n.front), state: n.state,
        capabilities: n.capabilities.filter((c) => !c.conditionalOn).map((c) => L(c.nameEs, c.nameEn)),
        conditionalNotes: n.capabilities.filter((c) => c.conditionalOn === 'own_entity').map((c) => L(
          `Si decides tener empresa propia, también está disponible ${c.nameEs}.`, `If you decide to set up your own company, ${c.nameEn} is also available.`)),
        quotes: n.declaredTexts, critical: n.critical, possible: n.possible,
      };
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    const unmappedItems = d.countryMessage ? [] : d.unmapped.map((u) => ({ text: u.text, stateKey: visibleStateKey('UNMAPPED_NEED', premiumShown) }));
    for (const u of unmappedItems) if (!groups.has(u.stateKey)) groups.set(u.stateKey, []);
    const valueGroups = order.filter((k) => groups.has(k)).map((k) => ({ key: k, items: groups.get(k)! }));
    const glanceMap = new Map<VisibleStateKey, number>();
    for (const g of valueGroups) glanceMap.set(g.key, g.items.length + unmappedItems.filter((u) => u.stateKey === g.key).length);

    const foot: L10n[] = [];
    const seen = new Set<string>();
    for (const n of valueNeeds) for (const c of n.capabilities) {
      if (c.conditionalOn || !c.limitEs || c.state === 'REVIEW' && c.kind === 'STRATEGIC_ADVISORY') continue;
      if (n.state === 'DEPENDENT') continue;
      const k = c.capabilityId; if (seen.has(k)) continue; seen.add(k);
      if (['CAP_HIVE_HR_PAYROLL', 'CAP_HIVE_FIN_BANKING', 'CAP_HIVE_FIN_INSURANCE'].includes(c.capabilityId))
        foot.push(L(`${c.nameEs}: ${c.limitEs}.`, `${c.nameEn}: ${c.limitEn}.`));
    }
    if (valueNeeds.some((n) => n.capabilities.some((c) => c.state === 'SOURCEABLE' || (c.state === 'REVIEW' && c.kind === 'HIVE'))))
      foot.push(L('Ninguna búsqueda garantiza disponibilidad ni condiciones.', 'No search guarantees availability or terms.'));

    const notIndicated = d.topics.filter((t) => t.notIndicated).map((t) => topic(t.front, t.possible));
    const marked = d.topics.filter((t) => t.kind === 'applies' && !t.notIndicated).map((t) => topic(t.front));

    const notApplicable = buildNotApplicable(d.plan, topic, res.destinations.length);

    return {
      destination: d.destination, name: nameL, ...(region ? { region } : {}),
      countryMessage: d.countryMessage,
      topicCount: d.topics.length,
      glance: order.filter((k) => glanceMap.has(k)).map((k) => ({ key: k, count: glanceMap.get(k)! })),
      applies,
      depends: dependsTopics.length ? { cause: plan.dependsCause ?? 'presence', topics: dependsTopics } : null,
      notApplicable,
      involvesNote: applies.some((t) => t.front === 'FR_SITE') && applies.some((t) => ['FR_PERMITS', 'FR_RECRUITMENT', 'FR_SUPPLIERS'].includes(t.front)) && comp?.location !== 'defined'
        ? L(`La ubicación que elijas en ${nameL.es} condiciona los permisos, las personas y los proveedores.`, `The location you choose in ${nameL.en} shapes permits, people and suppliers.`) : null,
      valueGroups, valueFootnotes: foot, notIndicated: shortcut ? notIndicated : [], marked: shortcut ? marked : [],
      unmapped: unmappedItems,
    };
  });

  // ----- where you are -----
  const allTopics = res.destinations.flatMap((d) => d.topics);
  const answered = allTopics.filter((t) => t.status);
  const nRes = answered.filter((t) => t.status === 'resolved').length;
  const nProg = answered.filter((t) => t.status === 'in_progress').length;
  const nPend = answered.filter((t) => t.status === 'pending').length;
  const unanswered = shortcut ? 0 : allTopics.length - answered.length;
  const notIndicatedN = allTopics.filter((t) => t.notIndicated).length;
  const markedN = shortcut ? allTopics.filter((t) => t.kind === 'applies' && !t.notIndicated).length : 0;
  const sentences: L10n[] = [];
  const names = (pred: (t: (typeof allTopics)[number]) => boolean) => joinL(allTopics.filter(pred).map((t) => low1(frontName(catalog, t.front).es) === '' ? L('', '') : L(low1(frontName(catalog, t.front).es), low1(frontName(catalog, t.front).en))));
  if (nRes) sentences.push(NC('yev.where.resolved', `Ya resuelto: ${names((t) => t.status === 'resolved').es}.`, `Already resolved: ${names((t) => t.status === 'resolved').en}.`));
  if (nProg) sentences.push(NC('yev.where.inprogress', `En marcha: ${names((t) => t.status === 'in_progress').es}.`, `Under way: ${names((t) => t.status === 'in_progress').en}.`));
  if (!nRes && !nProg && nPend && !shortcut) sentences.push(L(`Todavía no has empezado ninguno de los ${numberEs(nPend)}.`, `You haven't started any of the ${numberEn(nPend)} yet.`));
  if (unanswered && answered.length) sentences.push(L(`De los otros ${unanswered} temas no nos indicaste en qué punto están.`, `For the other ${unanswered} topics you didn't tell us where they stand.`));
  const needs: ResolvedNeed[] = res.destinations.filter((d) => !d.countryMessage).flatMap((d) => d.needs.filter((n) => n.origin === 'derived' && n.state !== 'DEPENDENT'));
  const yes = needs.filter((n) => n.support === 'yes'); const unk = needs.filter((n) => n.support === 'unknown');
  if (!shortcut && yes.length && unk.length) sentences.push(L(`Quieres apoyo en ${numberEs(yes.length)}; en ${joinL(unk.map((n) => L(low1(frontName(catalog, n.front).es), low1(frontName(catalog, n.front).en)))).es} aún no lo sabes.`,
    `You want support on ${numberEn(yes.length)}; on ${joinL(unk.map((n) => L(low1(frontName(catalog, n.front).es), low1(frontName(catalog, n.front).en)))).en} you aren't sure yet.`));
  if (shortcut) sentences.push(L('Fuiste directo a marcar lo que necesitas, así que no te preguntamos en qué punto está cada tema.', "You went straight to marking what you need, so we didn't ask where each topic stands."));
  const alreadyHave = a.components.map((c) => c.existingNote).filter((x): x is string => !!x);

  // ----- decided / open -----
  const decided: L10n[] = [];
  const decision = deriveDecision(a);
  if (decision === 'decided' || decision === 'conditional') decided.push(L('Avanzar con el proyecto', 'Moving ahead with the project'));
  if (decision === 'in_progress') decided.push(L('Ejecutarlo: ya está en marcha', 'Executing it: already under way'));
  if (!a.destinations.open && a.destinations.list.length) {
    const names = joinL(a.destinations.list.map((d) => countryL10n(d.iso)));
    decided.push(a.destinations.list.length > 1 ? L(`${names.es}, como un solo proyecto`, `${names.en}, as a single project`) : names);
  }
  for (const c of a.components) {
    if (c.presence && c.presence !== 'open' && c.permanence === 'permanent' && (c.presence === 'own_physical'))
      decided.push(L(`${componentPhrase(c, a).es} en ${joinL(c.destinations.map((d) => countryL10n(d))).es}, de forma permanente`, `${componentPhrase(c, a).en} in ${joinL(c.destinations.map((d) => countryL10n(d))).en}, permanently`));
    if (c.permanence === 'temporary') decided.push(L(`${cap1(presenceTail(c).es.replace(/^durante /, 'Unos ').replace(/^Unos unos /, 'Unos '))}`, `${cap1(presenceTail(c).en.replace(/^for about/, 'About'))}`));
  }
  const noOwnSpace = a.components.length > 0 && a.components.every((c) => c.presence !== 'own_physical');
  if (noOwnSpace) decided.push(L('Sin espacio propio', 'No premises of your own'));
  if (a.startWhen && a.startWhen !== 'unknown') decided.push(START_LABEL[a.startWhen]);
  if (a.externalDate.has && a.externalDate.date) decided.push(L(`Fecha clave: ${formatKeyDate(a.externalDate.date, 'es')}`, `Key date: ${formatKeyDate(a.externalDate.date, 'en')}`));
  else if (a.externalDate.has) decided.push(L('Con calendario contractual', 'With a contractual schedule'));
  if (a.components.length === 1 && a.scale[a.components[0]!.id]?.proxy === 'people' && a.scale[a.components[0]!.id]!.text)
    decided.push(L(a.scale[a.components[0]!.id]!.text, a.scale[a.components[0]!.id]!.text));

  const stillOpen: L10n[] = [];
  for (const d of destinations) {
    const comp = res.destinations.find((x) => x.destination === d.destination)?.plan.component;
    if (!comp) continue;
    if (comp.location === 'undecided' && (comp.presence === 'own_physical' || comp.presence === 'own_onsite'))
      stillOpen.push(comp.activities.includes('produce') ? L(`Ubicación de la planta en ${d.name.es}`, `Plant location in ${d.name.en}`) : NC('yev.open.where', `Dónde estará el proyecto en ${d.name.es}`, `Where the project will be in ${d.name.en}`));
    if (d.depends) {
      const c = d.depends.cause;
      stillOpen.push(c === 'hire' ? L('Cómo contratar formalmente', 'How to hire formally') : c === 'legal_operation' ? L(`Cómo operarás legalmente en ${d.name.es}`, `How you will operate legally in ${d.name.en}`) : L(`Cómo estarás presente en ${d.name.es}`, `How you will be present in ${d.name.en}`));
    }
    if (comp.permanence === 'open' && d.depends) stillOpen.push(L('Duración de la presencia', 'Length of the presence'));
  }
  if (decision === 'conditional') stillOpen.push(L(`La inversión depende de: “${a.dependsOn}”`, `The investment depends on: “${a.dependsOn}”`));
  // RULE 8: no "Presupuesto" unless FA asked for it or received it; nothing is inferred from the project type.

  const projectSize: L10n[] = [];
  for (const c of a.components) {
    const s = a.scale[c.id]; const dn = joinL(c.destinations.map((d) => countryL10n(d)));
    if (!s || s.proxy === 'people') continue;
    if (s.declined) projectSize.push(NC('yev.size.declined', `En ${dn.es}: prefieres no decirlo.`, `In ${dn.en}: you prefer not to say.`));
    else if (s.text) projectSize.push(s.proxy === 'investment' ? L(`Inversión preliminar en ${dn.es}: ${s.text}.`, `Preliminary investment in ${dn.en}: ${s.text}.`) : NC('yev.size.generic', `En ${dn.es}: ${s.text}.`, `In ${dn.en}: ${s.text}.`));
    else projectSize.push(L(`En ${dn.es}: aún sin definir.`, `In ${dn.en}: not yet defined.`));
  }

  const REASON_LABEL: Record<string, L10n> = {
    client_request: NC('yev.reason.client_request', 'Un cliente te lo pidió', 'A customer asked for it'), follow_clients: NC('yev.reason.follow_clients', 'Acompañar a clientes actuales', 'Following current customers'),
    growth: NC('yev.reason.growth', 'Oportunidad de crecimiento', 'Growth opportunity'), talent: NC('yev.reason.talent', 'Acceso a talento', 'Access to talent'), cost: NC('yev.reason.cost', 'Costos y eficiencia', 'Cost and efficiency'),
    resilience: NC('yev.reason.resilience', 'Resiliencia de la cadena de suministro', 'Supply chain resilience'), diversify: NC('yev.reason.diversify', 'Diversificar mercados o riesgos', 'Diversifying markets or risks'),
    contract: NC('yev.reason.contract', 'Ejecutar un contrato ganado', 'Executing a contract you won'), partner: NC('yev.reason.partner', 'Una plataforma para crecer con otros clientes', 'A platform to grow with other customers'), other: NC('yev.reason.other', 'Otro motivo', 'Another reason'),
  };

  const sectorL: L10n | null = a.company.sector ? L(a.company.sector, a.company.sector) : null;
  const sizeL = a.company.size ? sizeLabel(a.company.size) : null;
  const sub = [sectorL, a.company.operatesIn.length ? joinL(a.company.operatesIn.map(countryL10n)) : null, sizeL,
    a.externalDate.has && a.externalDate.date ? L(`Fecha clave: ${formatKeyDate(a.externalDate.date, 'es')}`, `Key date: ${formatKeyDate(a.externalDate.date, 'en')}`) : null].filter((x): x is L10n => !!x);

  return {
    kind: 'YourExpansionView',
    catalogVersion: res.catalogVersion, generatedAt: now.toISOString(), locale: a.locale,
    company: a.identity.company,
    title: buildTitle(a),
    subtitle: L(sub.map((s) => s.es).join(' · '), sub.map((s) => s.en).join(' · ')),
    shortcut,
    projectParagraphs: projectParagraphs(a),
    whyNow: { quote: a.reasonText.trim() || null, reasons: a.reasons.map((r) => REASON_LABEL[r]!) },
    decided, stillOpen, projectSize,
    successQuote: a.context.success.trim() || null,
    counts: { applies: allTopics.filter((t) => t.kind === 'applies').length, depends: allTopics.filter((t) => t.kind === 'depends').length, marked: markedN, notIndicated: notIndicatedN },
    whereYouAre: { resolved: nRes, inProgress: nProg, pending: nPend, unanswered, notIndicated: notIndicatedN, marked: markedN, sentences, alreadyHave },
    support: { valued: a.supportWords.trim() || null, keep: a.keepWords.trim() || null },
    destinations,
    premium: {
      shown: premiumShown, multiDestination: a.components.length > 1 || a.destinations.list.length > 1,
      headline: a.destinations.list.length === 1 && !a.destinations.open
        ? L(`Concretar tu operación en ${countryL10n(a.destinations.list[0]!.iso).es}`, `Make your operation in ${countryL10n(a.destinations.list[0]!.iso).en} real`)
        : L('Concretar tu expansión con beeside', 'Make your expansion real with beeside'),
    },
  };
}

function sizeLabel(s: string): L10n {
  const m: Record<string, L10n> = {
    '1-10': L('1–10 personas', '1–10 people'), '11-50': L('11–50 personas', '11–50 people'), '51-250': L('51–250 personas', '51–250 people'),
    '251-1000': L('Más de 250 personas', 'More than 250 people'), '1000+': L('Más de 1.000 personas', 'More than 1,000 people'),
  };
  return m[s] ?? L(s, s);
}
const numberEs = (n: number) => ['cero', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'][n] ?? String(n);
const numberEn = (n: number) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? String(n);
