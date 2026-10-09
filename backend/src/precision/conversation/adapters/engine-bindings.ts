/**
 * The ONLY file of the conversation module that imports ENGINE runtime code: it binds ENGINE's value renderers
 * (client-language rendering of captured values and enum labels) to the `ValueRenderer` port. Wiring code (DOMAIN's
 * composition root) passes `engineValueRenderer` to `createConversationEngine`; tests use the module's own
 * `basicRenderer`, so CONV's suite does not depend on ENGINE's files.
 *
 * `evaluateCategory` is deliberately NOT imported here: the composition root injects it as the `EvaluateCategory` port.
 */
import { renderFieldValue, valueLabel } from "../../manifest/value-render";
import type { ValueRenderer } from "../fields";

export const engineValueRenderer: ValueRenderer = {
  renderValue: (def, value, locale, scope) => renderFieldValue(def, value, locale, scope),
  enumLabel: (value, locale, scope) => valueLabel(value, locale, scope),
};
