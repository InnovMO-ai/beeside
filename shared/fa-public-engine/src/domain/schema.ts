import { z } from 'zod';
import type { Answers } from './answers';

const s = (max = 2000) => z.string().max(max);
const iso = z.string().regex(/^([A-Z]{2}|OPEN)$/);
const component = z.object({
  id: z.string().min(1).max(40), destinations: z.array(iso).max(30), description: s(500).optional(),
  activities: z.array(z.enum(['sell', 'produce', 'source', 'operate', 'hire', 'invest_only'])).max(6),
  withWhat: z.array(z.enum(['goods', 'services', 'digital'])).max(3),
  presence: z.enum(['remote', 'third_parties', 'own_physical', 'own_onsite', 'acquisition', 'open']).nullable(),
  permanence: z.enum(['permanent', 'temporary', 'open']).nullable(),
  durationMonths: z.number().int().min(1).max(600).optional(),
  existing: z.enum(['nothing', 'via_third', 'own']).nullable(), existingNote: s(500).optional(),
  sellsTo: z.enum(['companies', 'government', 'consumers', 'mixed']).nullable(),
  ownBrand: z.enum(['yes', 'no', 'unknown']).nullable(),
  location: z.enum(['defined', 'region_only', 'undecided']).nullable(), locationText: s(300).optional(),
  carries: z.array(z.enum(['people', 'equipment', 'nothing'])).max(3),
});
/** Strict server-side validation of everything the client saves (no prototype pollution, bounded sizes). */
export const answersSchema: z.ZodType<Answers> = z.object({
  locale: z.enum(['es', 'en']),
  identity: z.object({ name: s(200), company: s(200), email: s(254), role: s(200), decider: z.enum(['me', 'other', 'shared']).nullable(), termsAccepted: z.boolean(), privacyAcknowledged: z.boolean() }).strict(),
  company: z.object({ hasExistingBusiness: z.boolean().nullable(), sector: s(200), size: z.enum(['1-10', '11-50', '51-250', '251-1000', '1000+']).nullable(), operatesIn: z.array(iso).max(60) }).strict(),
  destinations: z.object({ list: z.array(z.object({ iso, region: s(120).optional() }).strict()).max(30), open: z.boolean(), sameInAll: z.boolean().nullable() }).strict(),
  components: z.array(component.strict()).max(30),
  projectConfirmed: z.boolean(), knowsNeeds: z.boolean().nullable(),
  reasons: z.array(z.enum(['client_request', 'follow_clients', 'growth', 'talent', 'cost', 'resilience', 'diversify', 'contract', 'partner', 'other'])).max(10),
  reasonText: s(3000), decision: z.enum(['exploring', 'decided', 'in_progress']).nullable(), dependsOn: s(1000),
  startWhen: z.enum(['asap', '3m', '6m', '12m', 'unknown']).nullable(),
  externalDate: z.object({ has: z.boolean().nullable(), date: s(40).optional(), what: s(300).optional() }).strict(),
  scale: z.record(z.string().max(40), z.object({ proxy: z.enum(['investment', 'people', 'products', 'purchase', 'duration']), text: s(200), declined: z.boolean() }).strict()),
  regulated: z.enum(['yes', 'no', 'unknown']).nullable(),
  fronts: z.record(z.string().max(80), z.object({ status: z.enum(['resolved', 'in_progress', 'pending', 'unknown']).optional(), support: z.enum(['yes', 'no', 'unknown']).optional(), critical: z.boolean().optional(), marked: z.boolean().optional(), note: s(500).optional() }).strict()),
  addedNeeds: z.array(z.object({ id: z.string().max(40), text: s(500), destination: z.string().max(10) }).strict()).max(60),
  cargoRoute: z.record(z.string().max(10), z.enum(['within', 'into_from_abroad', 'both', 'unknown'])),
  supportValues: z.array(z.enum(['speed', 'no_network', 'single_contact', 'local_validation', 'comparable_options', 'coordination', 'cost', 'keep_control'])).max(8),
  supportWords: s(1000), keepWords: s(1000),
  context: z.object({ success: s(2000), constraints: s(2000), description: s(3000), experience: s(2000), unknowns: s(2000), personalNeed: z.boolean() }).strict(),
}).strict() as unknown as z.ZodType<Answers>;
