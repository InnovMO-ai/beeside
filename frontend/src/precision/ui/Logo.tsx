import horizontal from "../assets/brand/beeside-logo-horizontal.png";
import { useI18n } from "../i18n";

/** The official beeside logo file, used as delivered (only downscaled). In Night Shift it sits on a light plate so it is never recoloured. */
export function Logo({ height = 28 }: { height?: number }) {
  const { t } = useI18n();
  return (
    <span className="pz-logo">
      <img src={horizontal} alt={t("shell.logoAlt")} height={height} width={Math.round(height * 5)} />
    </span>
  );
}
