import type { Contact, JobOrder } from "./types";

/**
 * "Same as primary" on the additional contact blocks (Bryan 2026-11-25).
 *
 * The checkbox state lives in the wizard, NOT on the order: the payload, the
 * PDF and the email keep one set of fields per role, filled with the copied
 * values, so every role is still recorded separately even when it is the same
 * person.
 */
export const LINKABLE_CONTACT_ROLES = [
  "supervisor",
  "timesheet",
  "generalContractor",
  "accounting",
  "safety",
  "otherContact",
] as const;

export type LinkableContactRole = (typeof LINKABLE_CONTACT_ROLES)[number];
export type LinkedContactRoles = Partial<Record<LinkableContactRole, boolean>>;

function copyOfPrimary(primary: Contact): Contact {
  return { name: primary.name, title: primary.title || "", phone: primary.phone, email: primary.email };
}

function sameContact(a: Contact, b: Contact): boolean {
  return a.name === b.name && (a.title || "") === (b.title || "") && a.phone === b.phone && a.email === b.email;
}

/** Every checked role mirrors the primary contact. Returns the same object when nothing changes. */
export function syncLinkedContacts(order: JobOrder, linked: LinkedContactRoles): JobOrder {
  const primary = order.contacts.primary;
  let contacts: JobOrder["contacts"] | null = null;
  for (const role of LINKABLE_CONTACT_ROLES) {
    if (!linked[role]) continue;
    if (sameContact(order.contacts[role], primary)) continue;
    contacts = contacts ?? { ...order.contacts };
    contacts[role] = copyOfPrimary(primary);
  }
  return contacts ? { ...order, contacts } : order;
}

/**
 * Check or uncheck one role. Checking copies the primary in; unchecking keeps
 * the copied values as the starting point (the fields just become editable).
 */
export function setContactLinked(
  order: JobOrder,
  linked: LinkedContactRoles,
  role: LinkableContactRole,
  on: boolean,
): { order: JobOrder; linked: LinkedContactRoles } {
  const nextLinked = { ...linked, [role]: on };
  return { order: on ? syncLinkedContacts(order, nextLinked) : order, linked: nextLinked };
}
