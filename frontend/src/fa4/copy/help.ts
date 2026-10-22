import type { Locale } from '@beeside/fa-public-engine';

/**
 * DSC-37 · Discovery contextual help — approved content `help-v1` (Product, 2026-10-21), copied LITERALLY from `DSC-37_HELP_CONTENT_v1.md`. Design and Code do not rewrite it:
 * a change of text needs a new approved version. Never rendered in v1.0 (kept here as approved content, not mapped): G (PD-30, duplicates the privacy notice already on screen).
 * Frozen / not in v1.0 and therefore NOT in this file: K, L, M (frozen until the commercial mechanism exists, DSC-39) and N.
 */
export const HELP_CONTENT_VERSION = 'help-v1';

export type HelpId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'I' | 'J' | 'O' | 'P' | 'P-1' | 'P-3' | 'Q' | 'R' | 'S' | 'T';
export type HelpPara = string | { link: string; href: string };
export interface HelpEntry { q: Record<Locale, string>; a: Record<Locale, HelpPara[]>; /** Extra line, shown ONLY during Stabilization (entry E). */ stab?: Record<Locale, string> }

export const HELP: Record<HelpId, HelpEntry> = {
  "A": { q: {"es": "¿Qué es Discovery?", "en": "What is Discovery?"}, a: { es: ["Discovery te ayuda a organizar la información esencial de tu proyecto de expansión y a identificar los temas que pueden ser relevantes antes de avanzar.", "A partir de lo que nos compartes, generamos tu Your Expansion View (YEV), una primera visión estructurada de tu proyecto.", "Discovery no sustituye un análisis especializado ni toma decisiones por ti."], en: ["Discovery helps you organize the essential information about your expansion project and identify the topics that may be relevant before you move forward.", "Based on what you share with us, we create your Your Expansion View (YEV), an initial structured view of your project.", "Discovery doesn't replace specialized analysis or make decisions for you."] } },
  "B": { q: {"es": "¿Por qué me hacen estas preguntas?", "en": "Why are you asking me these questions?"}, a: { es: ["Cada pregunta nos ayuda a entender mejor tu proyecto y a mostrarte sólo los temas que pueden ser relevantes para tu expansión.", "No todas las preguntas aplican a todos los proyectos. El recorrido se adapta a lo que nos vas contando."], en: ["Each question helps us understand your project better and show you only the topics that may be relevant to your expansion.", "Not every question applies to every project. The journey adapts to what you tell us."] } },
  "C": { q: {"es": "¿Qué pasa si todavía no sé la respuesta?", "en": "What if I don't know the answer yet?"}, a: { es: ["No necesitas tener todo definido.", "Cuando una pregunta lo permite, puedes indicar que todavía no lo sabes. Las preguntas opcionales puedes dejarlas en blanco.", "Discovery busca reflejar dónde estás hoy, no evaluarte ni obligarte a tener todas las respuestas."], en: ["You don't need to have everything defined.", "When a question allows it, you can say you don't know yet. You can leave optional questions blank.", "Discovery aims to reflect where you are today, not to evaluate you or require you to have every answer."] } },
  "D": { q: {"es": "¿Discovery me está evaluando?", "en": "Is Discovery evaluating me?"}, a: { es: ["No.", "Discovery no es un examen y no genera una calificación de tu empresa o de tu proyecto.", "Utiliza la información que compartes para organizar tu expansión y mostrarte qué está definido, qué sigue abierto y qué temas pueden requerir atención."], en: ["No.", "Discovery isn't a test and doesn't score your company or your project.", "It uses the information you share to organize your expansion and show you what's defined, what's still open and which topics may need attention."] } },
  "E": { q: {"es": "¿Puedo guardar y continuar después?", "en": "Can I save and continue later?"}, a: { es: ["Sí.", "Tus respuestas se guardan automáticamente desde que registras tus datos.", "Puedes usar «Guardar y seguir después» para recibir un enlace seguro en el correo que registraste; si dejas Discovery inactivo, también te lo enviamos.", "El enlace abre el mismo proyecto; no crea uno nuevo."], en: ["Yes.", "Your answers are saved automatically once you've entered your details.", "You can use \"Save and continue later\" to receive a secure link at the email address you provided; if you leave Discovery inactive, we send it to you as well.", "The link opens the same project; it doesn't create a new one."] }, stab: {"es": "Durante la etapa de Estabilización sólo podemos enviar enlaces a direcciones autorizadas.", "en": "During Stabilization we can only send links to authorized addresses."} },
  "F": { q: {"es": "¿Qué pasa si cierro la ventana?", "en": "What happens if I close the window?"}, a: { es: ["Tus respuestas se guardan automáticamente mientras avanzas.", "Si cierras la ventana, puedes continuar con el enlace que te enviamos por correo o pedir uno nuevo desde la portada de Discovery."], en: ["Your answers are saved automatically as you go.", "If you close the window, you can continue with the link we sent to your email or request a new one from the Discovery home page."] } },
  "G": { q: {"es": "¿Qué hacen con mi información?", "en": "What do you do with my information?"}, a: { es: ["Antes de Premium, no compartimos tu proyecto con proveedores.", {"link": "Política de Privacidad", "href": "https://www.beeside.you/privacy"}], en: ["Before Premium, we do not share your project with service providers.", {"link": "Privacy Policy", "href": "https://www.beeside.you/privacy"}] } },
  "I": { q: {"es": "¿Qué es Your Expansion View?", "en": "What is Your Expansion View?"}, a: { es: ["Your Expansion View (YEV) es el resultado de Discovery.", "Resume lo que entendimos de tu proyecto, las decisiones que ya tienes tomadas, los temas que siguen abiertos y los aspectos que pueden ser relevantes para tu expansión.", "El YEV refleja la información que compartiste y no sustituye una recomendación profesional especializada."], en: ["Your Expansion View (YEV) is the result of Discovery.", "It summarizes what we understood about your project, the decisions you've already made, the topics that are still open and the aspects that may be relevant to your expansion.", "The YEV reflects the information you shared and doesn't replace specialized professional advice."] } },
  "J": { q: {"es": "¿Puedo corregir información?", "en": "Can I correct information?"}, a: { es: ["Sí. Puedes regresar y ajustar tus respuestas mientras avanzas, también después de ver la vista previa de tu Your Expansion View.", "Cuando lo envías a tu correo, el resultado queda cerrado y ya no se puede modificar."], en: ["Yes. You can go back and adjust your answers as you go, including after you see the preview of your Your Expansion View.", "Once you send it to your email, the result is final and can no longer be changed."] } },
  "O": { q: {"es": "¿Qué pasa si quiero expandirme a varios países?", "en": "What if I want to expand to several countries?"}, a: { es: ["Puedes indicar más de un país cuando tu proyecto lo requiera.", "Discovery utiliza esa información para entender el alcance general de tu expansión.", "Algunas necesidades pueden variar entre países y posteriormente requerir mayor precisión."], en: ["You can select more than one country when your project requires it.", "Discovery uses that information to understand the overall scope of your expansion.", "Some needs may vary between countries and may later require more detail."] } },
  "P": { q: {"es": "¿Qué pasa si beeside todavía no tiene cobertura en un país?", "en": "What if beeside doesn't have coverage in a country yet?"}, a: { es: ["Discovery puede ayudarte a estructurar tu proyecto aunque el país todavía no tenga cobertura activa completa dentro del ecosistema de beeside.", "Cuando corresponda, tu Your Expansion View te indica si un país todavía no tiene cobertura activa."], en: ["Discovery can help you structure your project even if beeside's ecosystem doesn't yet have full active coverage in that country.", "Where relevant, your Your Expansion View tells you when a country doesn't have active coverage yet."] } },
  "Q": { q: {"es": "¿Tengo que saber qué servicios necesito?", "en": "Do I need to know which services I need?"}, a: { es: ["No.", "Puedes completar Discovery aunque todavía no sepas exactamente qué servicios necesitas.", "El recorrido está diseñado para ayudarte a identificar los temas que pueden ser relevantes a partir de tu proyecto.", "Si ya sabes lo que necesitas, Discovery puede utilizar esa información como parte del recorrido."], en: ["No.", "You can complete Discovery even if you don't know exactly which services you need yet.", "The journey is designed to help you identify the topics that may be relevant to your project.", "If you already know what you need, Discovery can use that information as part of the journey."] } },
  "R": { q: {"es": "¿Por qué algunas preguntas no aparecen?", "en": "Why don't some questions appear?"}, a: { es: ["Discovery adapta el recorrido según lo que nos cuentas.", "Si una pregunta no es relevante para tu proyecto, puede no mostrarse.", "Esto permite mantener el recorrido más corto y centrado en tu situación."], en: ["Discovery adapts the journey to what you tell us.", "If a question isn't relevant to your project, it may not be shown.", "This keeps the journey shorter and focused on your situation."] } },
  "S": { q: {"es": "¿Puedo usar un correo personal?", "en": "Can I use a personal email address?"}, a: { es: ["Sí, aunque recomendamos utilizar un correo de trabajo para identificar mejor tu proyecto y facilitar la continuidad con beeside.", "Si utilizas un correo personal, Discovery puede pedirte que confirmes que deseas continuar con esa dirección."], en: ["Yes, although we recommend using a work email so we can better identify your project and support continuity with beeside.", "If you use a personal email address, Discovery may ask you to confirm that you want to continue with it."] } },
  "T": { q: {"es": "¿Cuánto tiempo toma Discovery?", "en": "How long does Discovery take?"}, a: { es: ["Normalmente toma entre 10 y 15 minutos, aunque puede variar según la complejidad de tu proyecto y el número de países o actividades."], en: ["It usually takes 10 to 15 minutes, although it can vary depending on how complex your project is and how many countries or activities it involves."] } },
  "P-1": { q: {"es": "¿Qué pasa si mi empresa todavía no está operando?", "en": "What if my company isn't operating yet?"}, a: { es: ["Puedes usar Discovery también para un negocio o proyecto nuevo.", "No necesitas tener una empresa operando hoy: cuéntanos tu situación y el recorrido se adapta a lo que nos compartas."], en: ["You can also use Discovery for a new business or project.", "You don't need a company that's operating today: tell us about your situation and the journey adapts to what you share."] } },
  "P-3": { q: {"es": "¿Qué diferencia hay entre el estado de un tema y pedir apoyo?", "en": "What's the difference between a topic's status and asking for support?"}, a: { es: ["El estado indica cómo va hoy cada tema, por ejemplo, si ya está resuelto o sigue pendiente.", "Pedir apoyo indica si quieres que beeside te ayude en ese tema.", "Sólo te preguntamos por apoyo en los temas que no están resueltos."], en: ["The status shows where each topic stands today, for example whether it's already resolved or still pending.", "Asking for support tells us whether you'd like beeside to help you with that topic.", "We only ask about support for topics that aren't resolved yet."] } },
};

/** The screens that carry help (a screen id is derived from the flow step by `helpScreenOf`). */
export type HelpScreen = 'cover' | 'identity' | 'company' | 'destinations' | 'activity' | 'reason' | 'decision' | 'size' | 'activators' | 'topics' | 'extra' | 'yevPreview' | 'yevDelivered' | 'recovery';

/** Entries per screen, in this order, at most 4 (PD-29 mapping + S1/PD-30: G is not mapped anywhere). «Detalles adicionales» (support values + extra) has none. */
export const HELP_MAP: Record<HelpScreen, HelpId[]> = {
  cover: ['A', 'T', 'D'],
  identity: ['S', 'E', 'T'],
  company: ['P-1', 'B'],
  destinations: ['O', 'P'],
  activity: ['B', 'R'],
  reason: ['C', 'D'],
  decision: ['C', 'D'],
  size: ['D', 'C'],
  activators: ['R', 'C'],
  topics: ['Q', 'P-3', 'C'],
  extra: [],
  yevPreview: ['I', 'J', 'P'],
  yevDelivered: ['I', 'P'],
  recovery: ['E', 'F'],
};

/**
 * Publication conditions (PD-29 / OPEN_ITEMS §3), runtime flags:
 *  E — after DSC-36 FUNCTIONALLY VALIDATED · F — after DSC-36 + DSC-38 validated (and requires E) · J — after the J-check (done: DSC-J, e2e verifications) · P — after DSC-09 (done).
 * E and F stay OFF until the deployed behaviour is validated; flipping them is a one-line change here. `stabilization` only controls the extra line of E (comes from the runtime config).
 */
export interface HelpFlags { E: boolean; F: boolean; J: boolean; P: boolean; stabilization: boolean }
export const HELP_FLAGS: Omit<HelpFlags, 'stabilization'> = { E: false, F: false, J: true, P: true };

export function helpIdsFor(screen: HelpScreen, flags: HelpFlags): HelpId[] {
  const on = (id: HelpId) => id === 'E' ? flags.E : id === 'F' ? flags.E && flags.F : id === 'J' ? flags.J : id === 'P' ? flags.P : true;
  return HELP_MAP[screen].filter(on).slice(0, 4);
}
/** True when the Recovery screen shows the help trigger at all (only when E or F can be published, D9). */
export const recoveryHasHelp = (flags: HelpFlags) => helpIdsFor('recovery', flags).length > 0;
