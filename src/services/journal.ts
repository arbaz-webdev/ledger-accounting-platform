import "server-only";
import { z } from "zod";
import Decimal from "decimal.js";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, withTransaction, type Tx } from "@/db";
import {
  journalEntries,
  journalEntryLines,
  chartOfAccounts,
  entities,
  periods,
  accountMappings,
  fiscalYearCloses,
} from "@/db/schema";
import { writeAudit } from "@/services/audit";

/**
 * THE single write path to the ledger (spec 16.4).
 * Every module — manual JE, invoicing, bills, payroll, bank import, inventory —
 * must go through postJournalEntry / saveDraftJournalEntry / voidJournalEntry.
 * Nothing else may write to journal_entries or journal_entry_lines.
 */

const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => new Decimal(v || 0))
  .refine((d) => d.isFinite() && !d.isNegative(), "Amounts must be finite and nonnegative")
  .refine((d) => d.decimalPlaces() <= 2, "Amounts cannot exceed 2 decimal places");

export const jeLineSchema = z
  .object({
    accountId: z.string().uuid(),
    description: z.string().max(500).optional(),
    debit: moneyString.optional(),
    credit: moneyString.optional(),
    currency: z.string().length(3).optional(),
    fxRate: z
      .union([z.string(), z.number()])
      .transform((v) => new Decimal(v || 1))
      .refine((d) => d.isFinite() && d.isPositive(), "FX rate must be finite and positive")
      .optional(),
  })
  .refine(
    (l) => {
      const d = l.debit ?? new Decimal(0);
      const c = l.credit ?? new Decimal(0);
      return (d.isZero() ? 1 : 0) + (c.isZero() ? 1 : 0) === 1;
    },
    { message: "Each line must have either a debit or a credit amount, not both" }
  );

export const journalEntryInputSchema = z.object({
  entityId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
  }, "Date must be a valid calendar date"),
  description: z.string().min(1).max(1000),
  reference: z.string().max(200).optional(),
  sourceModule: z
    .enum(["manual", "invoice", "bill", "payroll", "bank", "inventory", "system"])
    .default("manual"),
  autoReverseOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  lines: z.array(jeLineSchema).min(2, "A journal entry needs at least two lines"),
});

export type JournalEntryInput = z.input<typeof journalEntryInputSchema>;

export class JournalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalValidationError";
  }
}

type ParsedInput = z.output<typeof journalEntryInputSchema>;

/**
 * Validation pipeline (spec 4.1 step 2). Throws JournalValidationError with a
 * user-readable message. The DB triggers re-enforce every one of these rules —
 * these checks exist to give friendly errors before hitting constraints.
 */
async function validate(input: ParsedInput) {
  const entityRows = await db
    .select({ id: entities.id, baseCurrency: entities.baseCurrency })
    .from(entities)
    .where(eq(entities.id, input.entityId));
  const entity = entityRows[0];
  if (!entity) throw new JournalValidationError("Entity not found");

  // Debits must equal credits (in base currency)
  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);
  for (const line of input.lines) {
    const rate = line.fxRate ?? new Decimal(1);
    totalDebit = totalDebit.plus((line.debit ?? new Decimal(0)).times(rate).toDecimalPlaces(2));
    totalCredit = totalCredit.plus((line.credit ?? new Decimal(0)).times(rate).toDecimalPlaces(2));
  }
  totalDebit = totalDebit.toDecimalPlaces(2);
  totalCredit = totalCredit.toDecimalPlaces(2);
  if (!totalDebit.equals(totalCredit)) {
    throw new JournalValidationError(
      `Entry is unbalanced: debits ${totalDebit.toFixed(2)} ≠ credits ${totalCredit.toFixed(2)}`
    );
  }
  if (totalDebit.isZero()) {
    throw new JournalValidationError("Entry total cannot be zero");
  }

  // All accounts must exist, belong to this entity, and be active
  const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
  const accounts = await db
    .select({
      id: chartOfAccounts.id,
      isActive: chartOfAccounts.isActive,
      number: chartOfAccounts.accountNumber,
      name: chartOfAccounts.name,
      subType: chartOfAccounts.subType,
    })
    .from(chartOfAccounts)
    .where(
      and(eq(chartOfAccounts.entityId, input.entityId), inArray(chartOfAccounts.id, accountIds))
    );
  const found = new Map(accounts.map((a) => [a.id, a]));
  if (input.sourceModule === "manual") {
    const protectedRows = await db.select({ id: accountMappings.accountId }).from(accountMappings)
      .where(and(eq(accountMappings.entityId, input.entityId),
        inArray(accountMappings.key, ["ar_control", "ap_control", "retained_earnings"])));
    const protectedIds = new Set(protectedRows.map(a => a.id));
    if (accounts.some(a => protectedIds.has(a.id) || a.subType === "receivable" || a.subType === "payable" || a.number === "3200")) {
      throw new JournalValidationError("Manual journals cannot post to AR/AP controls or retained earnings; use a document, opening-balance or approved correction workflow");
    }
  }
  for (const id of accountIds) {
    const acct = found.get(id);
    if (!acct) throw new JournalValidationError("One or more accounts do not exist for this entity");
    if (!acct.isActive) {
      throw new JournalValidationError(
        `Account ${acct.number} — ${acct.name} is inactive and cannot receive postings`
      );
    }
  }

  // Date must fall in an open period
  const [y, m] = [Number(input.date.slice(0, 4)), Number(input.date.slice(5, 7))];
  const periodRows = await db
    .select({ isLocked: periods.isLocked })
    .from(periods)
    .where(
      and(eq(periods.entityId, input.entityId), eq(periods.year, y), eq(periods.month, m))
    );
  if (periodRows[0]?.isLocked) {
    throw new JournalValidationError(`Period ${y}-${String(m).padStart(2, "0")} is locked`);
  }

  return { entity };
}

function toLineRows(input: ParsedInput, jeId: string, baseCurrency: string) {
  return input.lines.map((line, i) => {
    const rate = line.fxRate ?? new Decimal(1);
    const debit = line.debit ?? new Decimal(0);
    const credit = line.credit ?? new Decimal(0);
    return {
      jeId,
      lineNo: i + 1,
      accountId: line.accountId,
      description: line.description,
      currency: line.currency ?? baseCurrency,
      fxRate: rate.toString(),
      debit: debit.toFixed(2),
      credit: credit.toFixed(2),
      debitBase: debit.times(rate).toDecimalPlaces(2).toFixed(2),
      creditBase: credit.times(rate).toDecimalPlaces(2).toFixed(2),
    };
  });
}

/**
 * Post a journal entry (spec 4.1 steps 2–4): validate, create in Posted status
 * with a sequential per-entity JE number, insert lines, audit — all in one
 * transaction. Trial balance and reports need no refresh step; they are live
 * reads of posted lines.
 *
 * `callerTx`: modules whose own records must commit atomically with the JE
 * (inventory lot consumption, document status flips) pass their open
 * transaction; the JE then commits or rolls back with the caller's work. This
 * function remains the ONLY write path to the ledger either way.
 */
export async function postJournalEntry(
  rawInput: JournalEntryInput,
  postedByUserId: string,
  callerTx?: Tx
): Promise<{ jeId: string; jeNumber: number }> {
  const input = journalEntryInputSchema.parse(rawInput);
  const { entity } = await validate(input);

  const run = async (tx: Tx) => {
    await tx.select({ id: entities.id }).from(entities).where(eq(entities.id, input.entityId)).for("share");
    const numberRows = await tx.execute(
      sql`SELECT next_je_number(${input.entityId}::uuid) AS n`
    );
    const jeNumber = Number((numberRows.rows[0] as { n: string | number }).n);

    const [je] = await tx
      .insert(journalEntries)
      .values({
        entityId: input.entityId,
        jeNumber,
        date: input.date,
        reference: input.reference,
        description: input.description,
        sourceModule: input.sourceModule,
        status: "posted",
        autoReverseOn: input.autoReverseOn,
        createdBy: postedByUserId,
        postedBy: postedByUserId,
        postedAt: new Date(),
      })
      .returning({ id: journalEntries.id });

    await tx.insert(journalEntryLines).values(toLineRows(input, je.id, entity.baseCurrency));

    await writeAudit(tx, {
      entityId: input.entityId,
      userId: postedByUserId,
      action: "JE_POSTED",
      tableName: "journal_entries",
      recordId: je.id,
      afterState: {
        jeNumber,
        date: input.date,
        description: input.description,
        sourceModule: input.sourceModule,
        lines: input.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit?.toFixed(2) ?? "0.00",
          credit: l.credit?.toFixed(2) ?? "0.00",
        })),
      },
    });

    return { jeId: je.id, jeNumber };
  };

  return callerTx ? run(callerTx) : withTransaction(run);
}

/** Save a balanced draft. Drafts have no JE number and never appear in reports. */
export async function saveDraftJournalEntry(
  rawInput: JournalEntryInput,
  createdByUserId: string
): Promise<{ jeId: string }> {
  const input = journalEntryInputSchema.parse(rawInput);
  const { entity } = await validate(input);

  return withTransaction(async (tx) => {
    const [je] = await tx
      .insert(journalEntries)
      .values({
        entityId: input.entityId,
        date: input.date,
        reference: input.reference,
        description: input.description,
        sourceModule: input.sourceModule,
        status: "draft",
        autoReverseOn: input.autoReverseOn,
        createdBy: createdByUserId,
      })
      .returning({ id: journalEntries.id });

    await tx.insert(journalEntryLines).values(toLineRows(input, je.id, entity.baseCurrency));

    await writeAudit(tx, {
      entityId: input.entityId,
      userId: createdByUserId,
      action: "JE_DRAFT_SAVED",
      tableName: "journal_entries",
      recordId: je.id,
    });

    return { jeId: je.id };
  });
}

/** Post an existing draft: allocate a number and flip status, atomically. */
export async function postDraftJournalEntry(
  jeId: string,
  entityId: string,
  postedByUserId: string
): Promise<{ jeNumber: number }> {
  return withTransaction(async (tx) => {
    await tx.select({ id: entities.id }).from(entities).where(eq(entities.id, entityId)).for("share");
    const jeRows = await tx
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.id, jeId), eq(journalEntries.entityId, entityId)))
      .for("update");
    const je = jeRows[0];
    if (!je) throw new JournalValidationError("Journal entry not found");
    if (je.status !== "draft" && je.status !== "pending_approval") {
      throw new JournalValidationError(`Cannot post a ${je.status} entry`);
    }
    const draftLines = await tx.select().from(journalEntryLines).where(eq(journalEntryLines.jeId, jeId));
    await validate(journalEntryInputSchema.parse({ entityId, date: je.date, description: je.description,
      sourceModule: je.sourceModule, lines: draftLines.map(l => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, currency: l.currency, fxRate: l.fxRate })) }));

    const numberRows = await tx.execute(sql`SELECT next_je_number(${entityId}::uuid) AS n`);
    const jeNumber = Number((numberRows.rows[0] as { n: string | number }).n);

    await tx
      .update(journalEntries)
      .set({ status: "posted", jeNumber, postedBy: postedByUserId, postedAt: new Date() })
      .where(eq(journalEntries.id, jeId));

    await writeAudit(tx, {
      entityId,
      userId: postedByUserId,
      action: "JE_POSTED",
      tableName: "journal_entries",
      recordId: jeId,
      beforeState: { status: je.status },
      afterState: { status: "posted", jeNumber },
    });

    return { jeNumber };
  });
}

/** Discard a draft. Only draft / pending entries can be deleted (posted ones
 * are immutable and must be voided instead — enforced by DB trigger too). */
export async function deleteDraftJournalEntry(
  jeId: string,
  entityId: string,
  userId: string
): Promise<void> {
  return withTransaction(async (tx) => {
    const jeRows = await tx
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.id, jeId), eq(journalEntries.entityId, entityId)))
      .for("update");
    const je = jeRows[0];
    if (!je) throw new JournalValidationError("Journal entry not found");
    if (je.status === "posted" || je.status === "voided") {
      throw new JournalValidationError(`A ${je.status} entry cannot be deleted; void it instead`);
    }

    await writeAudit(tx, {
      entityId,
      userId,
      action: "JE_DRAFT_DISCARDED",
      tableName: "journal_entries",
      recordId: jeId,
      beforeState: { status: je.status, description: je.description },
    });
    await tx.delete(journalEntries).where(eq(journalEntries.id, jeId));
  });
}

/**
 * Void = reversal (spec 16.2 rule 5): creates a new posted JE with debits and
 * credits swapped, marks the original as voided. Both stay in the ledger.
 * The reversal is dated `voidDate` (defaults to the original date), which must
 * fall in an open period.
 */
export async function voidJournalEntry(
  jeId: string,
  entityId: string,
  voidedByUserId: string,
  voidDate?: string,
  callerTx?: Tx,
  expectedDocumentSource?: "invoice" | "bill"
): Promise<{ reversalJeId: string; reversalJeNumber: number }> {
  const run = async (tx: Tx) => {
    await tx.select({ id: entities.id }).from(entities).where(eq(entities.id, entityId)).for("share");
    const jeRows = await tx
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.id, jeId), eq(journalEntries.entityId, entityId)))
      .for("update");
    const je = jeRows[0];
    if (!je) throw new JournalValidationError("Journal entry not found");
    if (je.status !== "posted") {
      throw new JournalValidationError(`Only posted entries can be voided (this one is ${je.status})`);
    }
    if (je.reversesJeId) throw new JournalValidationError("A reversal entry cannot itself be reversed");
    if (expectedDocumentSource) {
      if (!callerTx || je.sourceModule !== expectedDocumentSource) throw new JournalValidationError("Document reversal requires its matching document workflow");
    } else if (!["manual", "system"].includes(je.sourceModule)) {
      throw new JournalValidationError("Document and stock journals require a document-aware correction; they cannot be reversed here");
    }
    if (voidDate && voidDate < je.date) throw new JournalValidationError("Reversal date cannot precede the original entry");
    if (!callerTx) {
      const [close] = await tx.select({ id: fiscalYearCloses.id }).from(fiscalYearCloses).where(eq(fiscalYearCloses.jeId, jeId));
      if (close) throw new JournalValidationError("Use the fiscal-year reopening workflow to reverse a closing entry");
    }

    const lines = await tx
      .select()
      .from(journalEntryLines)
      .where(eq(journalEntryLines.jeId, jeId))
      .orderBy(asc(journalEntryLines.lineNo));

    const reversalDate = voidDate ?? je.date;
    const numberRows = await tx.execute(sql`SELECT next_je_number(${entityId}::uuid) AS n`);
    const reversalNumber = Number((numberRows.rows[0] as { n: string | number }).n);

    const [reversal] = await tx
      .insert(journalEntries)
      .values({
        entityId,
        jeNumber: reversalNumber,
        date: reversalDate,
        reference: je.reference,
        description: `REVERSAL of JE #${je.jeNumber}: ${je.description}`,
        sourceModule: "system",
        status: "posted",
        reversesJeId: je.id,
        createdBy: voidedByUserId,
        postedBy: voidedByUserId,
        postedAt: new Date(),
      })
      .returning({ id: journalEntries.id });

    // Swap debit and credit on every line
    await tx.insert(journalEntryLines).values(
      lines.map((l) => ({
        jeId: reversal.id,
        lineNo: l.lineNo,
        accountId: l.accountId,
        description: l.description,
        currency: l.currency,
        fxRate: l.fxRate,
        debit: l.credit,
        credit: l.debit,
        debitBase: l.creditBase,
        creditBase: l.debitBase,
      }))
    );

    await tx
      .update(journalEntries)
      .set({ status: "voided", voidedByJeId: reversal.id })
      .where(eq(journalEntries.id, jeId));

    await writeAudit(tx, {
      entityId,
      userId: voidedByUserId,
      action: "JE_VOIDED",
      tableName: "journal_entries",
      recordId: jeId,
      beforeState: { status: "posted", jeNumber: je.jeNumber },
      afterState: { status: "voided", reversalJeId: reversal.id, reversalJeNumber: reversalNumber },
    });

    return { reversalJeId: reversal.id, reversalJeNumber: reversalNumber };
  };
  return callerTx ? run(callerTx) : withTransaction(run);
}
