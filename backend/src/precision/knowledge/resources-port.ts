/**
 * Country Resource Library, offered inside the Understanding conversation. A guide is offered ONCE, only for a country where the
 * operation will happen (or sell), only when its topic is on the table (or it has no topic and the client is already at the priority
 * moment), always optional. The text never carries the destination: the client opens it through the resolver endpoint, so the link is
 * configuration (Admin), never in code or in the chat text.
 */
import type { Frame, Loc } from "../understanding/types";
import { topicDrivers } from "./drivers";
import { offerResource, resolveResources, type CountryResourceRepository } from "./country-resources";

export interface ResourceOffer { id: string; title: string; text: string }
export interface ResourcesPort {
  /** At most one offer for this frame, or null. The caller marks `frame.asked[key]` so it is never repeated. */
  offer(frame: Frame, locale: Loc, now: string, stage: "topic" | "priority"): Promise<(ResourceOffer & { key: string }) | null>;
}

const DESTINATION_ROLES = new Set(["operation", "sales"]);

export function createResourcesPort(repo: CountryResourceRepository): ResourcesPort {
  return {
    async offer(frame, locale, now, stage) {
      const countries = [...new Set(frame.countries.filter((c) => DESTINATION_ROLES.has(c.role)).map((c) => c.code.toUpperCase()))];
      if (countries.length === 0) return null;
      const topics = [...new Set([...Object.keys(frame.concepts), ...frame.needs.flatMap((n) => n.conceptIds), ...topicDrivers(frame).map((d) => d.topic as string)])];
      const alreadyOffered = Object.keys(frame.asked).filter((k) => k.startsWith("res:")).map((k) => k.slice(4));
      for (const code of countries) {
        const resources = await resolveResources(repo, { countryCode: code, language: locale, now });
        const usable = resources.filter((r) => (r.topic ? topics.includes(r.topic) : stage === "priority"));
        const o = offerResource(usable, { topics, alreadyOffered, language: locale });
        if (o) return { key: `res:${o.resource.id}`, id: o.resource.id, title: o.resource.title, text: o.text[locale] };
      }
      return null;
    },
  };
}
