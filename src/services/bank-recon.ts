import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions, bankReconciliations, chartOfAccounts } from "@/db/schema";
import { parseCents, formatCents } from "@/lib/money";
import { writeAudit } from "@/services/audit";

/**
 * Bank reconciliation (spec 5.3).
 *
 * The identity: items recorded in the books that have not yet cleared the bank
 * explain the gap between the two balances —
 *
 *   statement balance = book balance − (signed total of uncleared items)
 *
 * (money-in not yet on the statement makes the book higher; an uncashed cheque
 * makes it lower). Approving locks the reconciliation; locked rows are immutable
 * at the database level.
 */

export class ReconciliationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconciliationError";
  }
}

export type ReconTxn = {
  id: string;
  date: string;
  description: string;
  amount: string;
  jeId: string | null;
};

export type ReconWorkspace = {
  bankAccountId: string;
  bankLabel: string;
  statementDate: string;
  /** GL balance of the bank account as at the statement date */
  bookBalance: string;
  /** posted, not yet reconciled, dated on/before the statement date */
  openItems: ReconTxn[];
  lastReconciliation: {
    statementDate: string;
    statementBalance: string;
    approvedAt: Date;
  } | null;
};

export async function getReconWorkspace(
  entityId: string,
  bankAccountId: string,
  statementDate: string
): Promise<ReconWorkspace> {
  const [account] = await db
    .select({ number: chartOfAccounts.accountNumber, name: chartOfAccounts.name })
    .from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.id, bankAccountId), eq(chartOfAccounts.entityId, entityId)));
  if (!account) throw new ReconciliationError("Bank account not found");

  // GL balance as at the statement date (posted + voided, per report convention)
  const balRows = await db.execute(sql`
    SELECT COALESCE(SUM(l.debit_base - l.credit_base), 0) AS net
    FROM journal_entry_lines l
    JOIN journal_entries je ON je.id = l.je_id
    WHERE l.account_id = ${bankAccountId}
      AND je.entity_id = ${entityId}
      AND je.status IN ('posted', 'voided')
      AND je.date <= ${statementDate}
  `);
  const bookBalance = parseCents((balRows.rows[0] as { net: string }).net);

  const open = await db
    .select({
      id: bankTransactions.id,
      date: bankTransactions.txnDate,
      description: bankTransactions.description,
      amount: bankTransactions.amount,
      jeId: bankTransactions.jeId,
    })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.entityId, entityId),
        eq(bankTransactions.bankAccountId, bankAccountId),
        eq(bankTransactions.status, "posted"),
        sql`${bankTransactions.reconciliationId} IS NULL`,
        sql`${bankTransactions.txnDate} <= ${statementDate}`
      )
    )
    .orderBy(bankTransactions.txnDate);

  const [last] = await db
    .select({
      statementDate: bankReconciliations.statementDate,
      statementBalance: bankReconciliations.statementBalance,
      approvedAt: bankReconciliations.approvedAt,
    })
    .from(bankReconciliations)
    .where(
      and(
        eq(bankReconciliations.entityId, entityId),
        eq(bankReconciliations.bankAccountId, bankAccountId)
      )
    )
    .orderBy(desc(bankReconciliations.statementDate))
    .limit(1);

  return {
    bankAccountId,
    bankLabel: `${account.number} · ${account.name}`,
    statementDate,
    bookBalance: formatCents(bookBalance),
    openItems: open.map((o) => ({
      id: o.id,
      date: String(o.date).slice(0, 10),
      description: o.description,
      amount: o.amount,
      jeId: o.jeId,
    })),
    lastReconciliation: last
      ? {
          statementDate: String(last.statementDate).slice(0, 10),
          statementBalance: last.statementBalance,
          approvedAt: last.approvedAt,
        }
      : null,
  };
}

/**
 * Approve a reconciliation: the ticked items are marked cleared and the
 * reconciliation is locked. Rejects unless the statement balance agrees with
 * the book balance after allowing for the un-ticked (still outstanding) items.
 */
export async function approveReconciliation(
  input: {
    entityId: string;
    bankAccountId: string;
    statementDate: string;
    statementBalance: string;
    clearedTxnIds: string[];
  },
  userId: string
) {
  return db.transaction(async (tx) => {
    const workspace = await getReconWorkspace(
      input.entityId,
      input.bankAccountId,
      input.statementDate
    );

    const clearedSet = new Set(input.clearedTxnIds);
    const outstanding = workspace.openItems
      .filter((i) => !clearedSet.has(i.id))
      .reduce((sum, i) => sum + parseCents(i.amount), 0n);
    const cleared = workspace.openItems
      .filter((i) => clearedSet.has(i.id))
      .reduce((sum, i) => sum + parseCents(i.amount), 0n);

    const book = parseCents(workspace.bookBalance);
    const expected = book - outstanding;
    const stated = parseCents(input.statementBalance);

    if (stated !== expected) {
      throw new ReconciliationError(
        `Does not reconcile: statement says ${formatCents(stated)} but the books less outstanding items come to ${formatCents(expected)} (out by ${formatCents(stated - expected)}).`
      );
    }

    const [recon] = await tx
      .insert(bankReconciliations)
      .values({
        entityId: input.entityId,
        bankAccountId: input.bankAccountId,
        statementDate: input.statementDate,
        statementBalance: formatCents(stated),
        bookBalance: formatCents(book),
        clearedTotal: formatCents(cleared),
        approvedBy: userId,
      })
      .returning();

    if (input.clearedTxnIds.length > 0) {
      await tx
        .update(bankTransactions)
        .set({ reconciliationId: recon.id })
        .where(
          and(
            eq(bankTransactions.entityId, input.entityId),
            inArray(bankTransactions.id, input.clearedTxnIds)
          )
        );
    }

    await writeAudit(tx, {
      entityId: input.entityId,
      userId,
      action: "BANK_RECONCILED",
      tableName: "bank_reconciliations",
      recordId: recon.id,
      afterState: {
        statementDate: input.statementDate,
        statementBalance: formatCents(stated),
        cleared: input.clearedTxnIds.length,
      },
    });

    return recon;
  });
}

export async function listReconciliations(entityId: string) {
  return db
    .select({
      id: bankReconciliations.id,
      statementDate: bankReconciliations.statementDate,
      statementBalance: bankReconciliations.statementBalance,
      bookBalance: bankReconciliations.bookBalance,
      approvedAt: bankReconciliations.approvedAt,
      bankNumber: chartOfAccounts.accountNumber,
      bankName: chartOfAccounts.name,
    })
    .from(bankReconciliations)
    .innerJoin(chartOfAccounts, eq(bankReconciliations.bankAccountId, chartOfAccounts.id))
    .where(eq(bankReconciliations.entityId, entityId))
    .orderBy(desc(bankReconciliations.statementDate))
    .limit(25);
}
