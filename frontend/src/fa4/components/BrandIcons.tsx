/** Line icons of the frozen institutional section (Option A): person (Sherpa), hexagon (The Hive), 2×2 grid (Operation Hub). Decorative. */
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;
export const SherpaIcon = () => <svg {...base}><circle cx="12" cy="8" r="3.6" /><path d="M5 20c.8-4 3.6-6 7-6s6.2 2 7 6" /></svg>;
export const HiveIcon = () => <svg {...base}><path d="M12 2.8l7.6 4.4v9.6L12 21.2l-7.6-4.4V7.2z" /><circle cx="12" cy="12" r="2.4" /></svg>;
export const HubIcon = () => <svg {...base}><rect x="4" y="4" width="6.5" height="6.5" rx="1.6" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" /></svg>;
export const AdvisoryIcon = () => <svg {...base}><path d="M4 18V6l8-3 8 3v12l-8 3z" /><path d="M9 12l2 2 4-4" /></svg>;
