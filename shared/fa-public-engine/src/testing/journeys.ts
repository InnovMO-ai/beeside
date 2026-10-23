import { emptyAnswers, type Answers, type ProjectComponent } from '../domain/answers';

const comp = (o: Partial<ProjectComponent> & Pick<ProjectComponent, 'id' | 'destinations'>): ProjectComponent => ({
  activities: [], withWhat: [], presence: null, permanence: null, existing: null,
  sellsTo: null, ownBrand: null, location: null, carries: [], ...o,
});

/** Journey A — simple: Spanish B2B software, 3–5 developers in Mexico (SYN-02). */
export function journeyA(locale: 'es' | 'en' = 'es'): Answers {
  const a = emptyAnswers(locale);
  a.identity = { name: 'Laura', company: 'Nubia Software', email: 'laura@nubia.example', role: 'CEO', decider: 'me', termsAccepted: true, privacyAcknowledged: true };
  a.company = { hasExistingBusiness: true, sector: 'Desarrollo de software', size: '11-50', operatesIn: ['ES'] };
  a.destinations = { list: [{ iso: 'MX' }], open: false, sameInAll: null };
  a.components = [comp({ id: 'c1', destinations: ['MX'], activities: ['hire'], presence: 'open', permanence: 'open', existing: 'nothing' })];
  a.projectConfirmed = true; a.knowsNeeds = false;
  a.reasons = ['talent'];
  a.reasonText = 'Nos cuesta encontrar perfiles senior en España y tenemos más proyectos de los que podemos absorber.';
  a.decision = 'decided'; a.startWhen = '6m';
  a.scale = { c1: { proxy: 'people', text: '3 a 5 personas', declined: false } };
  a.regulated = 'no';
  a.fronts = {
    'MX|FR_LEGAL_TAX': { status: 'pending', support: 'yes' },
    'MX|FR_EMPLOYMENT': { status: 'pending', support: 'yes' },
    'MX|FR_RECRUITMENT': { status: 'pending', support: 'unknown' },
  };
  a.supportWords = 'Entender cómo contratar sin complicar la empresa.';
  a.context.success = 'Un buen equipo sin una operación compleja.';
  return a;
}

/** Journey B — complex: German industrial, Mexico + Texas, conditional decision (SYN-01). */
export function journeyB(locale: 'es' | 'en' = 'es', cargoRoute?: 'within' | 'into_from_abroad' | 'both' | 'unknown'): Answers {
  const a = emptyAnswers(locale);
  a.identity = { name: 'Klaus', company: 'Müller Automation', email: 'klaus@mueller.example', role: 'VP International Expansion', decider: 'other', termsAccepted: true, privacyAcknowledged: true };
  a.company = { hasExistingBusiness: true, sector: 'Automatización para automoción', size: '251-1000', operatesIn: ['DE', 'CZ', 'CN'] };
  a.destinations = { list: [{ iso: 'MX' }, { iso: 'US', region: 'Texas' }], open: false, sameInAll: false };
  a.components = [
    comp({ id: 'mx', destinations: ['MX'], activities: ['produce', 'source', 'hire'], withWhat: ['goods'], presence: 'own_physical', permanence: 'permanent',
      existing: 'via_third', existingNote: 'Vendes en México a través de un distribuidor', location: 'undecided', carries: ['nothing'] }),
    comp({ id: 'us', destinations: ['US'], description: 'una presencia comercial y de ingeniería', activities: ['operate', 'hire'], withWhat: ['services'],
      presence: 'open', permanence: 'permanent', existing: 'via_third', existingNote: 'Tienes clientes en Estados Unidos' }),
  ];
  a.projectConfirmed = true; a.knowsNeeds = false;
  a.reasons = ['client_request', 'resilience', 'diversify', 'partner'];
  a.reasonText = 'Un cliente estratégico me pidió producir en Norteamérica. Además buscamos depender menos de Asia, una cadena de suministro más resiliente y una plataforma para crecer con otros clientes.';
  a.decision = 'decided'; a.dependsOn = 'confirmación del cliente, aprobación del Board, ubicación'; a.startWhen = '12m';
  a.externalDate = { has: true, date: '2028-Q1', what: 'Programa de nuestro cliente' };
  a.scale = { mx: { proxy: 'investment', text: '35–50 M€', declined: false }, us: { proxy: 'investment', text: '', declined: false } };
  a.regulated = 'no';
  const mx = ['FR_SITE', 'FR_LEGAL_TAX', 'FR_PERMITS', 'FR_RECRUITMENT', 'FR_EMPLOYMENT', 'FR_TRADE', 'FR_LOGISTICS', 'FR_SUPPLIERS', 'FR_BANKING', 'FR_INSURANCE'];
  for (const f of mx) a.fronts[`MX|${f}`] = { support: 'yes' };
  Object.assign(a.fronts['MX|FR_SITE']!, { status: 'in_progress' });
  Object.assign(a.fronts['MX|FR_SUPPLIERS']!, { status: 'in_progress' });
  for (const f of ['FR_LEGAL_TAX', 'FR_RECRUITMENT', 'FR_EMPLOYMENT', 'FR_BANKING']) Object.assign(a.fronts[`MX|${f}`]!, { status: 'pending' });
  a.fronts['US|FR_RECRUITMENT'] = { support: 'yes' }; a.fronts['US|FR_EMPLOYMENT'] = { support: 'yes' };
  if (cargoRoute) a.cargoRoute = { MX: cargoRoute };
  a.supportWords = 'expertise local rápido, coordinación, partners';
  a.keepWords = 'mantener a nuestros equipos corporativos';
  return a;
}

/** Journey C — "I know what I need": wind-farm assembly, awarded contract, temporary on-site execution (CASE-03). */
export function journeyC(locale: 'es' | 'en' = 'es', cargoRoute?: 'within' | 'into_from_abroad' | 'both' | 'unknown'): Answers {
  const a = emptyAnswers(locale);
  a.identity = { name: 'Íñigo', company: 'Eólica Montajes', email: 'inigo@eolica.example', role: 'Director del proyecto internacional', decider: 'shared', termsAccepted: true, privacyAcknowledged: true };
  a.company = { hasExistingBusiness: true, sector: 'Montaje e instalación de infraestructura renovable', size: null, operatesIn: ['ES'] };
  a.destinations = { list: [{ iso: 'MX' }], open: false, sameInAll: null };
  a.components = [comp({ id: 'c1', destinations: ['MX'], description: 'montaje de torres de un parque eólico', activities: ['operate', 'hire', 'source'], withWhat: ['goods'],
    presence: 'own_onsite', permanence: 'temporary', durationMonths: 24, existing: 'nothing', location: 'undecided', carries: ['people', 'equipment'] })];
  a.projectConfirmed = true; a.knowsNeeds = true;
  a.reasons = ['contract']; a.reasonText = 'ganamos un contrato';
  a.decision = 'in_progress'; a.startWhen = 'asap';
  a.externalDate = { has: true, date: '2026-12', what: 'Movilización' };
  a.scale = { c1: { proxy: 'duration', text: '2 años', declined: false } };
  a.regulated = 'unknown';
  for (const f of ['FR_LEGAL_TAX', 'FR_RECRUITMENT', 'FR_EMPLOYMENT', 'FR_MOBILE_STAFF', 'FR_LOGISTICS', 'FR_SUPPLIERS', 'FR_INSURANCE', 'FR_STAFF_HOUSING']) a.fronts[`MX|${f}`] = { marked: true };
  for (const f of ['FR_RECRUITMENT', 'FR_MOBILE_STAFF', 'FR_LOGISTICS', 'FR_SUPPLIERS']) a.fronts[`MX|${f}`]!.critical = true;
  a.addedNeeds = [
    { id: 'n1', text: 'grúas de gran capacidad', destination: 'MX' },
    { id: 'n2', text: 'transporte especializado (sobredimensionado, rutas, permisos)', destination: 'MX' },
    { id: 'n3', text: 'alojamiento', destination: 'MX' },
  ];
  if (cargoRoute) a.cargoRoute = { MX: cargoRoute };
  a.supportWords = 'Alternativas comparables, coordinación, velocidad';
  a.keepWords = 'dirección técnica la llevamos nosotros';
  a.context.success = 'llegar, montar lo necesario, cumplir el contrato y no construir una estructura permanente';
  return a;
}

/** Presentation route — Nórtica Envases (Spain → Mexico), sell + hire, own premises, permanent (Product Handoff §6). Fictitious data. */
export function journeyNortica(locale: 'es' | 'en' = 'es'): Answers {
  const a = emptyAnswers(locale);
  a.identity = { name: 'Lucía', company: 'Nórtica Envases', email: 'lucia@nortica.example', role: 'Directora de Desarrollo de Negocio', decider: 'shared', termsAccepted: true, privacyAcknowledged: true, marketingConsent: false };
  a.company = { hasExistingBusiness: true, sector: 'Fabricación de envases sostenibles para alimentación', size: '51-250', operatesIn: ['ES', 'PT'] };
  a.destinations = { list: [{ iso: 'MX' }], open: false, sameInAll: null };
  a.components = [comp({ id: 'c1', destinations: ['MX'], activities: ['sell', 'hire'], withWhat: ['goods'], presence: 'own_physical', permanence: 'permanent',
    existing: 'commercial_traction', existingNote: 'Exportamos a dos clientes en México', sellsTo: 'companies', ownBrand: 'yes', location: 'region_only', locationText: 'Bajío', carries: ['nothing'] })];
  a.projectConfirmed = true; a.knowsNeeds = false;
  a.reasons = ['follow_clients', 'growth'];
  a.reasonText = 'Nuestros clientes en México nos piden servicio local y entregas más rápidas.';
  a.decision = 'decided'; a.startWhen = '6m'; a.externalDate = { has: false };
  a.scale = { c1: { proxy: 'people', text: locale === 'es' ? '8 personas' : '8 people', declined: false } };
  a.regulated = 'no';
  for (const f of ['FR_LEGAL_TAX', 'FR_EMPLOYMENT', 'FR_TRADE', 'FR_BANKING', 'FR_INSURANCE', 'FR_SITE', 'FR_RECRUITMENT', 'FR_BRAND', 'FR_LOGISTICS', 'FR_GTM'])
    a.fronts[`MX|${f}`] = { status: f === 'FR_GTM' ? 'in_progress' : 'pending', support: 'yes' };
  a.cargoRoute = { MX: 'both' };
  a.supportValues = ['single_contact', 'speed'];
  a.keepWords = 'La relación comercial con nuestros clientes';
  return a;
}

/**
 * NEW BUSINESS route (Discovery Public v1.0 rule): nobody operates today; the person is creating a new business / operation in another country.
 * Same journey as every other route: only the current-operation facts (sector, size, countries of activity) are absent — nothing is invented for them.
 * Fictitious data.
 */
export function journeyNewBusiness(locale: 'es' | 'en' = 'es'): Answers {
  const a = journeyNortica(locale);
  a.identity = { ...a.identity, name: 'Mateo', company: 'Proyecto Nuevo Taller MX', email: 'mateo@nuevo-taller.example', role: 'Fundador' };
  a.company = { hasExistingBusiness: false, sector: '', size: null, operatesIn: [] };
  a.components = a.components.map((c) => ({ ...c, existing: 'nothing', existingNote: '' }));
  a.reasonText = locale === 'es' ? 'Queremos abrir una operación propia en México.' : 'We want to open our own operation in Mexico.';
  a.keepWords = '';
  a.scale = { c1: { proxy: 'people', text: locale === 'es' ? '5 personas' : '5 people', declined: false } };
  return a;
}

/** "No lo sé" route (Product Handoff §7): same company, every undecided answer left as "not sure". */
export function journeyUnknown(locale: 'es' | 'en' = 'es'): Answers {
  const a = journeyNortica(locale);
  a.components = [comp({ id: 'c1', destinations: ['MX'], activities: ['sell'], withWhat: ['goods'], presence: 'open', permanence: 'open',
    existing: 'commercial_traction', existingNote: 'Exportamos a dos clientes en México', sellsTo: 'companies', ownBrand: 'yes' })];
  a.decision = 'exploring'; a.startWhen = 'unknown';
  a.scale = { c1: { proxy: 'products', text: '', declined: false } };
  a.regulated = 'unknown'; a.reasons = ['follow_clients', 'growth'];
  a.fronts = {};
  for (const f of ['FR_LEGAL_TAX', 'FR_TRADE', 'FR_BANKING', 'FR_INSURANCE', 'FR_BRAND', 'FR_LOGISTICS', 'FR_GTM']) a.fronts[`MX|${f}`] = { status: 'unknown', support: 'unknown' };
  a.cargoRoute = { MX: 'unknown' };
  return a;
}
