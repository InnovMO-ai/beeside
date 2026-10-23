/**
 * Which contact action the Operation Hub block offers. The label must never promise more than the destination delivers:
 *
 *   "Contact my Sherpa"  only when the hub is active, the client has access, a Sherpa is assigned AND a valid direct Sherpa
 *                        channel exists (hub-provided per project, or configured). The destination is that channel.
 *   "Contact beeside"    when a Sherpa is assigned but no direct channel is available: the configured general address.
 *   nothing              otherwise (general Help stays available everywhere).
 */
import type { Db } from "../../db/database";
import type { OhContactDto, Locale } from "../api/dto";
import type { SendStateView } from "../delivery/oh-delivery-service";
import { contactEmail, sherpaContactChannel } from "./config";

export async function ohContactAction(db: Pick<Db, "query">, locale: Locale, view: Pick<SendStateView, "ux" | "ohAccess">): Promise<OhContactDto | null> {
  if (view.ux.goToOperationHub !== "enter" || !view.ux.contactMySherpa) return null;
  const direct = await sherpaContactChannel(db, locale, view.ohAccess.sherpaContactEmail);
  if (direct) return { kind: "sherpa", email: direct };
  return { kind: "beeside", email: await contactEmail(db, locale) };
}
