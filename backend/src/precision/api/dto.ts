/* eslint-disable */
// PRECISION API DTOs — single source of truth shared by backend and frontend.
// Canonical copy: docs/f5/precision-dto.ts. Mirrored byte-for-byte (after this header) into
//   backend/src/precision/api/dto.ts   and   frontend/src/precision/api/dto.ts
// `node scripts/check-precision-dto.js` fails when a mirror drifts. Edit the canonical copy, then run
// `node scripts/check-precision-dto.js --sync`. Pure types: no imports, no runtime code except constants.

export type Locale = "en" | "es";
export type AccessMode = "FULL" | "READ_ONLY" | "REVOKED";

/** Every non-2xx response. `message` is a safe, already-localized sentence; clients map `error` to their own copy. */
export interface ApiErrorDto {
  error:
    | "UNAUTHENTICATED"
    | "PRECISION_READ_ONLY"
    | "PRECISION_REVOKED"
    | "NOT_FOUND"
    | "INVALID_INPUT"
    | "CONFLICT"
    | "PREVIEW_STALE"
    | "ACTIVATION_PENDING_RETRY_FIRST"
    | "NOT_READY"
    | "RATE_LIMITED"
    | "TEMPORARILY_UNAVAILABLE";
  message: string;
  retryable: boolean;
  /** Present on UNAUTHENTICATED answers of the link exchange when support contact is configured; absent -> the client hides it. */
  support?: SupportDto;
}

/** Contact beeside for pages shown before or without a session (link, access ended, errors): the configured address (`contact_beeside_email`). */
export interface SupportDto { email: string | null }

// ---------------------------------------------------------------- session & entry
export interface SessionExchangeRequest { code: string }
export interface SessionExchangeResponse { sessionToken: string; expiresAt: string }

export interface AccessDto { mode: AccessMode; readOnlyUntil: string | null }

export interface CoverDto {
  /** photo = approved destination photo; global = approved global photo; neutral = brand composition, no image. */
  composition: "photo" | "global" | "neutral";
  image: null | { url: string; altText: string; focal: { x: number; y: number } };
  destinations: { code: string; label: string }[];
}
export interface EntryDto { screen: "cover" | "center"; locale: Locale; access: AccessDto; cover: CoverDto | null }

// ---------------------------------------------------------------- center
export type UnderstandingState = "not_started" | "in_progress" | "ready_to_confirm" | "confirmed";
export type CategoryStatus = "not_started" | "in_progress" | "ready_for_review" | "confirmed" | "sent";
export type SendStateDto = "not_sent" | "sending" | "sent" | "failed";
/** Icon keys: the 17 canonical categories plus three kinds. Rendered by the frontend icon set. */
export type CategoryIconKey = string;

export interface CategoryCardDto {
  id: string;
  label: string;
  iconKey: CategoryIconKey;
  status: CategoryStatus;
  progressPct: number | null;
  criticalOpen: number;
  pendingCount: number;
  sendState: SendStateDto;
}

export interface OhContactDto { kind: "sherpa" | "beeside"; email: string }

export interface CenterDto {
  locale: Locale;
  access: AccessDto;
  project: { destinations: { code: string; label: string }[]; sector: string | null };
  understanding: { state: UnderstandingState };
  serviceMap: { available: boolean; confirmedAt: string | null; hasUnconfirmedChanges: boolean };
  /** Empty until My Service Map is confirmed. */
  categories: CategoryCardDto[];
  addService: { available: boolean };
  /** `contact`: the one contact action next to Operation Hub. "sherpa" only with a valid direct Sherpa channel; "beeside" when a Sherpa is assigned but none exists; null otherwise. */
  operationHub: { state: "hidden" | "pending_access" | "enter"; url: string | null; contact: OhContactDto | null };
  help: { helpCenterUrl: string | null };
}

// ---------------------------------------------------------------- conversation
export type TurnRole = "client" | "assistant";
export type TurnKind = "message" | "process_question" | "disclosure" | "notice";
export type QuickReplyIntent = "answer" | "unknown" | "withheld" | "estimate" | "confirm" | "correct";

export interface QuickReplyDto { value: string; label: string; intent: QuickReplyIntent }

/** A structured confirmation the assistant asks for (service-map need, new service need, inherited value). */
export interface ConfirmCardDto {
  kind: "inherited_value" | "service_need" | "classification" | "summary";
  title: string;
  body: string;
  confirmLabel: string;
  correctLabel: string;
  token: string;
}

export interface TurnDto {
  id: string;
  role: TurnRole;
  kind: TurnKind;
  text: string;
  createdAt: string;
  quickReplies?: QuickReplyDto[];
  confirmCard?: ConfirmCardDto;
  /** A country guide offered in this turn; opening it goes through GET /resources/:id (destination is Admin configuration). */
  resourceOffer?: { id: string; title: string };
}

/** A country guide the client was offered, resolved on demand. `ref` is Admin configuration (an https URL or a document reference). */
export interface ResourceLinkDto { id: string; title: string; kind: "url" | "document"; ref: string }

export type ThreadSurface = "understanding" | "category" | "add_service";

export interface ThreadDto {
  surface: ThreadSurface;
  scopeId: string;
  title: string;
  turns: TurnDto[];
  /** Understanding never shows a percentage. Category threads carry progress. */
  progress: CategoryProgressDto | null;
  understandingState: UnderstandingState | null;
  /** True after the one-time AI disclosure was delivered in this project. */
  aiDisclosureShown: boolean;
  canWrite: boolean;
  /** A client turn saved without an assistant answer yet (reload mid-processing or AI unavailable): retry with the SAME turnKey. */
  pendingTurn?: { turnKey: string; status: "processing" | "ai_unavailable" } | null;
}

export interface CategoryProgressDto {
  progressPct: number | null;
  criticalOpen: number;
  pendingCount: number;
  ready: boolean;
  status: CategoryStatus;
}

export interface TurnRequest {
  /** Client-generated, stable across retries (>= 8 chars, [A-Za-z0-9_.:-]). */
  turnKey: string;
  text: string;
  quickReply?: { value: string; intent: QuickReplyIntent };
  /** Token of the confirm card being answered, with `intent` confirm | correct. */
  confirm?: { token: string; intent: "confirm" | "correct" };
}

export interface TurnResultDto {
  /** ok = assistant replied; ai_unavailable = the client turn is saved, retry with the SAME turnKey; blocked = input not processable. */
  status: "ok" | "ai_unavailable" | "blocked";
  turns: TurnDto[];
  progress: CategoryProgressDto | null;
  understandingState: UnderstandingState | null;
  serviceMapChanged: boolean;
  retryable: boolean;
}

// ---------------------------------------------------------------- My Service Map
export type ItemState = "confirmed" | "assumed" | "pending" | "not_applicable";

export interface ServiceMapItemDto {
  id: string;
  label: string;
  /** Short client-language reason this service is in the map. */
  why: string | null;
  priority: "high" | "medium" | "low" | null;
  timing: string | null;
  state: ItemState;
}
export interface ServiceMapGroupDto {
  /** Category card id when the group already has a workstream; null before. */
  categoryId: string | null;
  label: string;
  iconKey: CategoryIconKey;
  /** "to_review" groups are shown as "Under review" — never with internal keys. */
  kind: "category" | "strategic_advisory" | "ecosystem_development" | "to_review";
  items: ServiceMapItemDto[];
}
export interface ServiceMapViewDto {
  title: string;
  asOf: string;
  summary: { objective: string | null; destinations: { code: string; label: string }[]; timeWindow: string | null; productOrService: string | null };
  groups: ServiceMapGroupDto[];
  openItems: string[];
  /** Added/removed vs. the confirmed snapshot, in client language. */
  changesSinceConfirmed: { kind: "added" | "removed" | "changed"; text: string }[];
}
export interface ServiceMapDto {
  live: ServiceMapViewDto;
  confirmed: (ServiceMapViewDto & { confirmedAt: string }) | null;
  canConfirm: boolean;
  hasUnconfirmedChanges: boolean;
  canWrite: boolean;
  /** Groups a need can be moved to (opaque ids, client labels). Absent when the client cannot write. */
  moveTargets?: { id: string; label: string }[];
}
/** A client correction of My Service Map: the client's decision, applied as stated. Item and group ids are the opaque ones the map returned. */
export type ServiceMapCorrectionRequest =
  | { requestKey: string; op: "remove"; itemId: string }
  | { requestKey: string; op: "rename"; itemId: string; text: string }
  | { requestKey: string; op: "set_priority"; itemId: string; priority: "high" | "medium" | "low" | null }
  | { requestKey: string; op: "move"; itemId: string; toGroupId: string }
  | { requestKey: string; op: "set_why"; itemId: string; text: string };
export interface ServiceMapCorrectionResponse { serviceMap: ServiceMapDto }
export interface ConfirmServiceMapRequest { requestKey: string }
export interface ConfirmServiceMapResponse { confirmedAt: string; serviceMap: ServiceMapDto }

// ---------------------------------------------------------------- category & CRP
export interface CrpRequirementDto {
  id: string;
  label: string;
  /** Human text of the captured answer; null when pending. */
  value: string | null;
  state: ItemState;
  executionDependency: boolean;
}
export interface CrpSectionDto { id: string; title: string; items: CrpRequirementDto[] }
export interface CrpViewDto {
  categoryId: string;
  title: string;
  /** 'draft' = shown for review while in progress; 'ready_for_review'; 'confirmed' = read-only. */
  state: "draft" | "ready_for_review" | "confirmed";
  confirmedAt: string | null;
  /** Context lines (destination, scope) as plain sentences. */
  context: string[];
  sections: CrpSectionDto[];
  /** Pending Information: always visible, never inside prose. */
  pending: CrpRequirementDto[];
  /** "Information required later" — operational context, never documents or attachments. */
  requiredLater: string[];
  canConfirm: boolean;
  canRequestChanges: boolean;
  canStartNewVersion: boolean;
}
export interface CategoryDto {
  id: string;
  label: string;
  iconKey: CategoryIconKey;
  status: CategoryStatus;
  progress: CategoryProgressDto;
  sendState: SendStateDto;
  thread: ThreadDto;
}
export interface ConfirmCrpRequest { requestKey: string }

// ---------------------------------------------------------------- preview & send
export interface PreviewBlockDto { id: "project" | "service_map" | "crp" | "context"; title: string; lines: string[]; view?: CrpViewDto | ServiceMapViewDto }
export interface PreviewDto {
  categoryId: string;
  /** Opaque; must be echoed in the send request. */
  previewChecksum: string;
  firstSend: boolean;
  blocks: PreviewBlockDto[];
  notSent: string[];
  sendState: SendStateDto;
  canSend: boolean;
  /** Present when sendState is "failed": what the client can do and whether "Try again" makes sense. */
  clientAction?: "try_again_later" | "needs_attention" | null;
  retryable?: boolean;
  /** Present when sending is blocked until the first send succeeds. */
  blockedReason?: "first_send_required" | null;
}
export interface SendRequest { previewChecksum: string }
export interface SendResultDto {
  state: "sent" | "sending" | "failed" | "blocked";
  /** Present when failed or blocked: category of what the client can do. */
  clientAction: "try_again_later" | "needs_attention" | "first_send_required" | null;
  retryable: boolean;
  operationHub: CenterDto["operationHub"];
}

// ---------------------------------------------------------------- help, add a service
export interface HelpDto {
  helpCenterUrl: string | null;
  /** Legal references and the single Contact beeside address, all from configuration. */
  privacyUrl: string | null;
  termsUrl: string | null;
  contactEmail: string | null;
  contactAvailable: boolean;
}
export interface AddServiceThreadDto { available: boolean; thread: ThreadDto | null }

// ---------------------------------------------------------------- internal review (NOT part of the client journey)
export interface InternalStatusDto {
  integrations: { port: string; implementation: string; mode: "SIMULATED" | "SANDBOX" | "REAL"; verification: "NOT_VERIFIED" | "VERIFIED" | "PRODUCTION_READY"; note?: string }[];
  dataset: "SYNTHETIC" | "CUSTOMER";
  build: { sha: string | null; releaseLabel: string };
}

// ---------------------------------------------------------------- routes (documentation constants)
export const PRECISION_ROUTES = {
  sessionExchange: "POST /api/precision/session/exchange",
  entry: "GET /api/precision/entry",
  coverSeen: "POST /api/precision/cover/seen",
  center: "GET /api/precision/center",
  help: "GET /api/precision/help",
  understanding: "GET /api/precision/understanding",
  understandingTurn: "POST /api/precision/understanding/turns",
  serviceMap: "GET /api/precision/service-map",
  serviceMapConfirm: "POST /api/precision/service-map/confirm",
  addService: "GET /api/precision/add-service",
  addServiceTurn: "POST /api/precision/add-service/turns",
  category: "GET /api/precision/categories/:id",
  categoryTurn: "POST /api/precision/categories/:id/turns",
  crp: "GET /api/precision/categories/:id/crp",
  crpRequestChanges: "POST /api/precision/categories/:id/crp/request-changes",
  crpConfirm: "POST /api/precision/categories/:id/crp/confirm",
  crpNewVersion: "POST /api/precision/categories/:id/crp/new-version",
  preview: "GET /api/precision/categories/:id/preview",
  send: "POST /api/precision/categories/:id/send",
  internalStatus: "GET /api/precision/internal/status",
} as const;
