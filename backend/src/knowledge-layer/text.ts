/** Text helpers owned by the Knowledge Layer (accent/case folding). The layer does not depend on any consumer's helpers. */
export const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
