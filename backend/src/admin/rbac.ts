/**
 * Admin/Supervisor RBAC (Functional Specification v1 §10, Technical Architecture v1.1 §12): a
 * role-to-permission table re-checked server-side on every request. SUPERVISOR is read-only:
 * it can find and open assessments and review answers, the Snapshot, the Internal Assessment,
 * findings/signals/handoff, Premium and lifecycle status, but never edit content, publish, change
 * configuration or run operations. No role can edit client answers or historical records — there
 * is no endpoint for it, and the database refuses it independently.
 */
export type AdminRole = "ADMIN" | "SUPERVISOR";

export const PERMISSIONS = {
  "projects.read": ["ADMIN", "SUPERVISOR"],
  "config.read": ["ADMIN", "SUPERVISOR"],
  "operations.read": ["ADMIN", "SUPERVISOR"],
  "config.write": ["ADMIN"],
  "config.publish": ["ADMIN"],
  "operations.execute": ["ADMIN"],
  "premium.manage": ["ADMIN"],
  "audit.read": ["ADMIN"],
  "admin_users.manage": ["ADMIN"],
} as const satisfies Record<string, readonly AdminRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function isAdminRole(value: unknown): value is AdminRole {
  return value === "ADMIN" || value === "SUPERVISOR";
}

export function can(role: AdminRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly AdminRole[]).includes(role);
}

export function permissionsFor(role: AdminRole): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
}
