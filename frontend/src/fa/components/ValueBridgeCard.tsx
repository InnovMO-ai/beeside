import { RenderedValueBridge } from "../types";
import bridgeTheHive from "../../assets/bridge-the-hive.png";
import bridgeVerified from "../../assets/bridge-beeside-verified.png";
import bridgeOperationHub from "../../assets/bridge-operation-hub.png";
import bridgeStrategicAdvisory from "../../assets/bridge-strategic-advisory.png";
import bridgeSherpa from "../../assets/bridge-sherpa.png";

const BRIDGE_ICON: Record<RenderedValueBridge["key"], string> = {
  the_hive: bridgeTheHive,
  beeside_verified: bridgeVerified,
  operation_hub_secure: bridgeOperationHub,
  operation_hub_productivity: bridgeOperationHub,
  strategic_advisory: bridgeStrategicAdvisory,
  sherpa: bridgeSherpa,
};

/**
 * ValueBridgeCard — "beeside can help" (2026-09-30 Product Owner authorization, item 1: converge to
 * `snapshot_etapa4_FROZEN_v8.1-contrast-cta-fix.html`'s `.bridge`/`.bridge-icon-badge` pattern exactly
 * — icon in a white circle badge, uppercase eyebrow, heading, body, on the warm dark-gray `--bridge-bg`
 * surface). Superseds the old `ValueBridges.tsx` end-of-page grid: this single-bridge card is now
 * threaded inline by `VirtualSnapshot.tsx` at the point in the story where each bridge's trigger fired
 * (Capability Footprint, Project Path, Findings, Next Decisions) — never grouped in one generic block.
 *
 * `large` gives beeside Sherpa's badge/icon their own bigger size (frozen file's v7.4 correction,
 * `.bridge-icon-badge-lg`/`.bridge-icon-lg` — the bee+compass mark read too small at the standard
 * size); every other bridge keeps the standard size, unchanged.
 */
export function ValueBridgeCard({ bridge, large = false }: { bridge: RenderedValueBridge; large?: boolean }) {
  return (
    <div className={`value-bridge-card${large ? " value-bridge-card-lg" : ""}`}>
      <p className="value-bridge-eyebrow">{bridge.eyebrow}</p>
      <div className="value-bridge-head-row">
        <div className={`value-bridge-icon-badge${large ? " value-bridge-icon-badge-lg" : ""}`}>
          <img className={`value-bridge-icon${large ? " value-bridge-icon-lg" : ""}`} src={BRIDGE_ICON[bridge.key]} alt="" />
        </div>
        <h3 className="value-bridge-heading">{bridge.heading}</h3>
      </div>
      <p className="value-bridge-body">{bridge.body}</p>
    </div>
  );
}
