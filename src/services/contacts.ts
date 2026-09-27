import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { writeAudit } from "@/services/audit";

export type ContactType = "customer" | "supplier";

export async function listContacts(entityId: string, type?: ContactType) {
  return db
    .select()
    .from(contacts)
    .where(
      type
        ? and(eq(contacts.entityId, entityId), eq(contacts.type, type))
        : eq(contacts.entityId, entityId)
    )
    .orderBy(asc(contacts.name));
}

export async function createContact(
  input: {
    entityId: string;
    type: ContactType;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    paymentTermsDays?: number;
  },
  userId: string
) {
  return db.transaction(async (tx) => {
    const [contact] = await tx
      .insert(contacts)
      .values({
        entityId: input.entityId,
        type: input.type,
        name: input.name.trim(),
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        address: input.address?.trim() || null,
        paymentTermsDays: input.paymentTermsDays ?? 30,
      })
      .returning();

    await writeAudit(tx, {
      entityId: input.entityId,
      userId,
      action: "CONTACT_CREATED",
      tableName: "contacts",
      recordId: contact.id,
      afterState: { name: contact.name, type: contact.type },
    });
    return contact;
  });
}

export async function setContactActive(
  contactId: string,
  entityId: string,
  isActive: boolean,
  userId: string
) {
  return db.transaction(async (tx) => {
    const [contact] = await tx
      .update(contacts)
      .set({ isActive })
      .where(and(eq(contacts.id, contactId), eq(contacts.entityId, entityId)))
      .returning();
    if (!contact) throw new Error("Contact not found");

    await writeAudit(tx, {
      entityId,
      userId,
      action: "CONTACT_UPDATED",
      tableName: "contacts",
      recordId: contactId,
      afterState: { name: contact.name, isActive },
    });
    return contact;
  });
}
