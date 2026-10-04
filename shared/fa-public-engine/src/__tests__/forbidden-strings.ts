// Test-only: strings that must never reach customer-facing output (legacy / internal vocabulary).
// Kept out of runtime code on purpose so partner names never ship in a browser bundle.
export const FORBIDDEN_CUSTOMER_STRINGS = [
  'Por confirmar', 'Sin servicio hoy', 'Snapshot', 'radar', 'readiness', 'score', 'Level2', 'Level 2',
  'SOURCEABLE', 'NOT_OFFERED', 'UNMAPPED_NEED', 'NO_ACTIVE_COVERAGE', 'DEVELOPING', 'Demand Signal', 'demand signal',
  'internal_ref', 'Grant Thornton', 'Baker Tilly', 'Traxión', 'Santander', 'MAPFRE', 'Garza Ponce', 'AMPIP',
];

