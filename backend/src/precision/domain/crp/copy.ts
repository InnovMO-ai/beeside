/**
 * Customer-facing fixed copy owned by the CRP / Preview / Send surface (EN + ES). Voice Guide v1.1: tuteo, no
 * exclamation marks, no quality judgments, canonical terms only, no technical detail. State labels and the Execution
 * Dependency label come from the conversation copy inventory (single source) when needed by callers.
 */
import type { Locale } from "../../api/dto";

type Pair = Readonly<Record<Locale, string>>;
const p = (en: string, es: string): Pair => ({ en, es });

export const ERROR_COPY: Readonly<Record<string, Pair>> = {
  UNAUTHENTICATED: p("Your session has ended. Open your access link again to continue.", "Tu sesión terminó. Abre de nuevo tu enlace de acceso para continuar."),
  PRECISION_READ_ONLY: p("Your Precision Center is in read-only mode, so this action is not available.", "Tu Precision Center está en modo de solo lectura, por lo que esta acción no está disponible."),
  PRECISION_REVOKED: p("Access to Precision Center is no longer active for this project.", "El acceso a Precision Center ya no está activo para este proyecto."),
  NOT_FOUND: p("We could not find what you are looking for.", "No encontramos lo que buscas."),
  INVALID_INPUT: p("Something in the request is not valid. Review it and try again.", "Algo en la solicitud no es válido. Revísalo e inténtalo de nuevo."),
  CONFLICT: p("This action is not available in the current state of the category.", "Esta acción no está disponible en el estado actual de la categoría."),
  PREVIEW_STALE: p("The information changed after you opened the preview. Review the updated preview before sending.", "La información cambió después de abrir la vista previa. Revisa la vista previa actualizada antes de enviar."),
  ACTIVATION_PENDING_RETRY_FIRST: p(
    "Your first send to Operation Hub has not been completed yet. Complete it first, then you can send other categories.",
    "Tu primer envío a Operation Hub aún no se completó. Complétalo primero y después podrás enviar otras categorías.",
  ),
  NOT_READY: p("This step is not available yet. Confirm the Category Requirement Pack (CRP) of this category first.", "Este paso aún no está disponible. Primero confirma el Category Requirement Pack (CRP) de esta categoría."),
  NOT_READY_INFO: p(
    "Some required information is still missing, so this Category Requirement Pack (CRP) cannot be confirmed yet.",
    "Aún falta información requerida, por lo que este Category Requirement Pack (CRP) todavía no se puede confirmar.",
  ),
  RATE_LIMITED: p("There were too many requests. Wait a moment and try again.", "Hubo demasiadas solicitudes. Espera un momento e inténtalo de nuevo."),
  TEMPORARILY_UNAVAILABLE: p("We could not complete this right now. Your information is saved. Try again in a moment.", "No pudimos completar esto en este momento. Tu información está guardada. Inténtalo de nuevo en un momento."),
};

export function errorMessage(code: string, locale: Locale, detail?: string): string {
  const key = detail ? `${code}_${detail.toUpperCase()}` : code;
  return (ERROR_COPY[key] ?? ERROR_COPY[code] ?? ERROR_COPY.TEMPORARILY_UNAVAILABLE!)[locale];
}

export const NOTICE_REQUEST_CHANGES: Pair = p(
  "You can keep adjusting this category. The summary stays as a draft until you confirm it.",
  "Puedes seguir ajustando esta categoría. El resumen sigue como borrador hasta que lo confirmes.",
);

export const PREVIEW_COPY = {
  project: p("Your project", "Tu proyecto"),
  serviceMap: p("My Service Map", "My Service Map"),
  context: p("Context for execution", "Contexto para la ejecución"),
  company: p("Company", "Empresa"),
  sector: p("Sector", "Sector"),
  objective: p("Objective", "Objetivo"),
  destination: p("Destination", "Destino"),
  timeWindow: p("Time window", "Horizonte de tiempo"),
  product: p("Product or service", "Producto o servicio"),
  operatingEntity: p("Operating entity", "Entidad operativa"),
  operatingCountries: p("Operating countries", "Países de operación"),
  requiredLater: p("Information required later", "Información requerida más adelante"),
  openItems: p("Open items", "Puntos abiertos"),
  pendingDetail: p("Still to define", "Por definir"),
  attentionPoint: p("Point to review with a specialist", "Punto a revisar con un especialista"),
  mapTitle: p("My Service Map", "My Service Map"),
} as const;

export const NOT_SENT: Readonly<Record<Locale, readonly string[]>> = {
  en: [
    "Your conversation with Precision",
    "Names and contact details of people",
    "Documents or attachments",
    "Payment information",
    "Anything that does not appear in the blocks above",
  ],
  es: [
    "Tu conversación con Precision",
    "Nombres y datos de contacto de personas",
    "Documentos o archivos adjuntos",
    "Información de pago",
    "Cualquier cosa que no aparezca en los bloques anteriores",
  ],
};

export const T = <K extends keyof typeof PREVIEW_COPY>(key: K, locale: Locale): string => PREVIEW_COPY[key][locale];
