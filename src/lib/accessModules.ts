import type { Role } from '../hooks/useAuth';

/**
 * The modules whose access can be customised per role in Settings → Role-Based
 * Access. Each entry's `defaults` are the built-in roles used when the admin
 * hasn't overridden that module. Admin always sees everything, and Users &
 * Settings are intentionally NOT here — they stay admin-only so nobody can lock
 * the admin out.
 */
export interface AccessModule { path: string; label: string; defaults: Role[] }

export const ACCESS_MODULES: AccessModule[] = [
  { path: '/reception', label: 'Reception', defaults: ['receptionist'] },
  { path: '/appointments', label: 'Appointments', defaults: ['receptionist', 'doctor'] },
  { path: '/doctor-select', label: 'Doctor Consultation', defaults: ['doctor', 'receptionist'] },
  { path: '/lab', label: 'Laboratory', defaults: ['lab_tech', 'doctor', 'receptionist'] },
  { path: '/pharmacy', label: 'Pharmacy', defaults: ['pharmacist', 'doctor', 'receptionist'] },
  { path: '/ipd', label: 'IPD (In-Patient)', defaults: ['doctor', 'receptionist', 'nurse', 'ward_incharge', 'manager'] },
  { path: '/discharge-summary', label: 'Discharge Summary', defaults: ['doctor', 'receptionist', 'nurse'] },
  { path: '/pediatrics', label: 'Pediatrics', defaults: ['doctor', 'receptionist', 'nurse'] },
  { path: '/print-jobs', label: 'Print Jobs', defaults: ['receptionist', 'doctor', 'nurse', 'manager'] },
  { path: '/tpa', label: 'Insurance / TPA', defaults: ['receptionist', 'manager'] },
  { path: '/patient-log', label: 'Patient Log', defaults: ['receptionist', 'doctor', 'manager'] },
  { path: '/origin', label: 'Patient Origin', defaults: ['receptionist', 'doctor', 'manager'] },
  { path: '/billing', label: 'Billing', defaults: ['receptionist', 'manager'] },
  { path: '/miscellaneous', label: 'Services', defaults: ['receptionist', 'doctor', 'manager'] },
  { path: '/accounts', label: 'Accounts', defaults: ['receptionist', 'manager'] },
  { path: '/analytics', label: 'Analytics', defaults: ['receptionist', 'doctor', 'manager'] },
  { path: '/whatsapp', label: 'Communication', defaults: ['receptionist', 'doctor', 'manager'] },
  { path: '/notifications', label: 'Notifications', defaults: ['receptionist', 'manager'] },
];

/** Roles that can be assigned to staff (admin is implicit-all, staff is legacy). */
export const ASSIGNABLE_ROLES: { role: Role; label: string }[] = [
  { role: 'manager', label: 'Manager' },
  { role: 'receptionist', label: 'Reception' },
  { role: 'doctor', label: 'Doctor' },
  { role: 'nurse', label: 'Nurse / Sister' },
  { role: 'ward_incharge', label: 'Ward In-charge' },
  { role: 'pharmacist', label: 'Pharmacist' },
  { role: 'lab_tech', label: 'Lab Tech' },
];

/** Parse the stored override JSON safely into a { path: Role[] } map. */
export function parseRoleAccess(json?: string | null): Record<string, Role[]> {
  if (!json) return {};
  try {
    const o = JSON.parse(json);
    return o && typeof o === 'object' ? o : {};
  } catch { return {}; }
}

/** Roles allowed for a path: the admin's override if set, else the built-in defaults. */
export function effectiveRoles(path: string, defaults: Role[], overrides: Record<string, Role[]>): Role[] {
  const o = overrides[path];
  // An EMPTY list is treated as "no override", not as "nobody but admin". Unticking
  // every role in the matrix used to save [] and silently lock that module away
  // from the whole clinic — under a success toast.
  return Array.isArray(o) && o.length > 0 ? (o as Role[]) : defaults;
}
