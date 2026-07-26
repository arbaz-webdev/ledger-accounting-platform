import "server-only";
import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bankTransactions,
  bankImportBatches,
  chartOfAccounts,
  journalEntries,
} from "@/db/schema";
import { parseCsv, parseAmount, parseDate, type ColumnMapping } from "@/lib/csv";
import { loadActiveRules, matchRule, bumpRuleUsage } from "@/services/bank-rules";
import { postJournalEntry } from "@/services/journal";
import { resolveMapping } from "@/services/mappings";
import { writeAudit } from "@/services/audit";

/**
 * Bank statement import (spec 5.1):
 *   Upload → Parse & Validate → Duplicate Check → Auto-Categorise → Review → Post
 *
 * Rows are STAGED in bank_transactions. The ledger is only touched when the user
 * confirms, at which point each transaction posts its own journal entry (5.2):
 *   money in  (bank credit): DR Bank        CR category
 *   money out (bank debit):  DR category    CR Bank
 */

export class BankImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BankImportError";
  }
}

export type PreviewRow = {
  rowNumber: number;
  date: string | null;
  description: string;
  amount: number | null;
  balance: number | null;
  error: string | null;
};

export type ImportPreview = {
  headers: string[];
  mapping: ColumnMapping;
  rows: PreviewRow[];
  validCount: number;
  errorCount: number;
};

/** Normalise a description for fingerprinting: collapse whitespace, lowercase. */
function normaliseDescription(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function dedupeHash(entityId: string, accountId: string, date: string, amount: string, desc: string) {
  return createHash("sha256")
    .update([entityId, accountId, date, amount, normaliseDescription(desc)].join("|"))
    .digest("hex");
}

/** Read a CSV into validated rows without touching the database. */
export function buildPreview(csvText: string, mapping: ColumnMapping): ImportPreview {
  const { headers, rows } = parseCsv(csvText);

  const out: PreviewRow[] = rows.map((row, i) => {
    const rawDate = row[mapping.dateColumn] ?? "";
    const description = (row[mapping.descriptionColumn] ?? "").trim();

    const date = parseDate(rawDate, mapping.dateFormat);

    let amount: number | null = null;
    if (mapping.amountColumn) {
      amount = parseAmount(row[mapping.amountColumn] ?? "");
    } else {
      const debit = parseAmount(row[mapping.debitColumn ?? ""] ?? "");
      const credit = parseAmount(row[mapping.creditColumn ?? ""] ?? "");
      // debit column = money out (negative), credit column = money in (positive)
      if (debit !== null && debit !== 0) amount = -Math.abs(debit);
      else if (credit !== null && credit !== 0) amount = Math.abs(credit);
    }

    const balance = mapping.balanceColumn ? parseAmount(row[mapping.balanceColumn] ?? "") : null;

    let error: string | null = null;
    if (!date) error = `Could not read a date from "${rawDate}"`;
    else if (amount === null || amount === 0) error = "No usable amount on this row";
    else if (!description) error = "Description is empty";

    return { rowNumber: i + 2, date, description, amount, balance, error };
  });

  return {
    headers,
    mapping,
    rows: out,
    validCount: out.filter((r) => !r.error).length,
    errorCount: out.filter((r) => r.error).length,
  };
}

export type ImportResult = {
  batchId: string;
  imported: number;
  duplicates: number;
  rejected: number;
  categorised: number;
  flagged: number;
};

/**
 * Stage validated rows. Exact duplicates (same account+date+amount+description)
 * are skipped; near-duplicates (same amount within ±3 days) are imported but
 * flagged for review, per spec 5.1.
 */
export async function importTransactions(
  input: {
    entityId: string;
    bankAccountId: string;
    filename: string;
    csvText: string;
    mapping: ColumnMapping;
  },
  userId: string
): Promise<ImportResult> {
  const preview = buildPreview(input.csvText, input.mapping);
  const valid = preview.rows.filter((r) => !r.error);
  if (valid.length === 0) {
    throw new BankImportError(
      `No usable rows found. ${preview.errorCount} row(s) failed validation — check the column mapping.`
    );
  }

  const rules = await loadActiveRules(input.entityId);

  // Existing fingerprints for exact-duplicate detection
  const existing = await db
    .select({ hash: bankTransactions.dedupeHash })
    .from(bankTransactions)
    .where(eq(bankTransactions.entityId, input.entityId));
  const seen = new Set(existing.map((e) => e.hash));

  // Existing (date, amount) pairs on this account for near-duplicate detection
  const near = await db
    .select({ date: bankTransactions.txnDate, amount: bankTransactions.amount })
    .from(bankTransactions)
    .where(eq(bankTransactions.bankAccountId, input.bankAccountId));

  const [batch] = await db
    .insert(bankImportBatches)
    .values({
      entityId: input.entityId,
      bankAccountId: input.bankAccountId,
      filename: input.filename,
      rowCount: preview.rows.length,
      createdBy: userId,
    })
    .returning();

  const toInsert: (typeof bankTransactions.$inferInsert)[] = [];
  const appliedRuleIds: string[] = [];
  let duplicates = 0;
  let flagged = 0;

  for (const row of valid) {
    const amountStr = new Decimal(row.amount!).toFixed(2);
    const hash = dedupeHash(
      input.entityId,
      input.bankAccountId,
      row.date!,
      amountStr,
      row.description
    );
    if (seen.has(hash)) {
      duplicates++;
      continue;
    }
    seen.add(hash);

    // near-duplicate: same amount on this account within ±3 days
    const rowMs = Date.parse(`${row.date}T00:00:00Z`);
    const isNearDup = near.some(
      (e) =>
        new Decimal(e.amount).toFixed(2) === amountStr &&
        Math.abs(Date.parse(`${String(e.date).slice(0, 10)}T00:00:00Z`) - rowMs) <=
          3 * 86_400_000
    );
    if (isNearDup) flagged++;

    const rule = matchRule(rules, row.description, row.amount!);
    if (rule) appliedRuleIds.push(rule.id);

    toInsert.push({
      entityId: input.entityId,
      batchId: batch.id,
      bankAccountId: input.bankAccountId,
      txnDate: row.date!,
      description: row.description,
      amount: amountStr,
      statementBalance: row.balance !== null ? new Decimal(row.balance).toFixed(2) : null,
      status: rule ? "categorised" : "pending",
      categoryAccountId: rule?.accountId ?? null,
      matchedRuleId: rule?.id ?? null,
      dedupeHash: hash,
      possibleDuplicate: isNearDup,
    });
  }

  if (toInsert.length > 0) {
    await db.insert(bankTransactions).values(toInsert);
  }
  if (appliedRuleIds.length > 0) {
    await bumpRuleUsage(appliedRuleIds);
  }

  const result: ImportResult = {
    batchId: batch.id,
    imported: toInsert.length,
    duplicates,
    rejected: preview.errorCount,
    categorised: toInsert.filter((t) => t.categoryAccountId).length,
    flagged,
  };

  await db
    .update(bankImportBatches)
    .set({
      importedCount: result.imported,
      duplicateCount: result.duplicates,
      rejectedCount: result.rejected,
    })
    .where(eq(bankImportBatches.id, batch.id));

  await writeAudit(db, {
    entityId: input.entityId,
    userId,
    action: "BANK_IMPORT",
    tableName: "bank_import_batches",
    recordId: batch.id,
    afterState: { filename: input.filename, ...result },
  });

  return result;
}

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------

export async function listBankTransactions(
  entityId: string,
  opts: { status?: "open" | "posted"; bankAccountId?: string } = {}
) {
  const statusFilter =
    opts.status === "posted"
      ? sql`bt.status = 'posted'`
      : sql`bt.status IN ('pending', 'categorised')`;
  const accountFilter = opts.bankAccountId
    ? sql`AND bt.bank_account_id = ${opts.bankAccountId}`
    : sql``;

  const rows = await db.execute(sql`
    SELECT bt.id, bt.txn_date, bt.description, bt.amount, bt.status,
           bt.possible_duplicate, bt.category_account_id, bt.je_id,
           bt.reconciliation_id,
           ca.account_number AS category_number, ca.name AS category_name,
           ba.account_number AS bank_number, ba.name AS bank_name
    FROM bank_transactions bt
    JOIN chart_of_accounts ba ON ba.id = bt.bank_account_id
    LEFT JOIN chart_of_accounts ca ON ca.id = bt.category_account_id
    WHERE bt.entity_id = ${entityId} AND ${statusFilter} ${accountFilter}
    ORDER BY bt.txn_date DESC, bt.created_at DESC
    LIMIT 500
  `);

  return (
    rows.rows as {
      id: string;
      txn_date: string;
      description: string;
      amount: string;
      status: string;
      possible_duplicate: boolean;
      category_account_id: string | null;
      je_id: string | null;
      reconciliation_id: string | null;
      category_number: string | null;
      category_name: string | null;
      bank_number: string;
      bank_name: string;
    }[]
  ).map((r) => ({
    id: r.id,
    date: String(r.txn_date).slice(0, 10),
    description: r.description,
    amount: r.amount,
    status: r.status,
    possibleDuplicate: r.possible_duplicate,
    categoryAccountId: r.category_account_id,
    categoryLabel: r.category_number ? `${r.category_number} · ${r.category_name}` : null,
    bankLabel: `${r.bank_number} · ${r.bank_name}`,
    jeId: r.je_id,
    reconciliationId: r.reconciliation_id,
  }));
}

export async function categoriseTransactions(
  entityId: string,
  txnIds: string[],
  accountId: string,
  userId: string
) {
  if (txnIds.length === 0) return 0;
  const updated = await db
    .update(bankTransactions)
    .set({ categoryAccountId: accountId, status: "categorised" })
    .where(
      and(
        eq(bankTransactions.entityId, entityId),
        inArray(bankTransactions.id, txnIds),
        sql`${bankTransactions.status} IN ('pending','categorised')`
      )
    )
    .returning({ id: bankTransactions.id });

  await writeAudit(db, {
    entityId,
    userId,
    action: "BANK_TXN_CATEGORISED",
    tableName: "bank_transactions",
    afterState: { count: updated.length, accountId },
  });
  return updated.length;
}

export async function ignoreTransactions(entityId: string, txnIds: string[], userId: string) {
  if (txnIds.length === 0) return 0;
  const updated = await db
    .update(bankTransactions)
    .set({ status: "ignored" })
    .where(
      and(
        eq(bankTransactions.entityId, entityId),
        inArray(bankTransactions.id, txnIds),
        sql`${bankTransactions.status} IN ('pending','categorised')`
      )
    )
    .returning({ id: bankTransactions.id });

  await writeAudit(db, {
    entityId,
    userId,
    action: "BANK_TXN_IGNORED",
    tableName: "bank_transactions",
    afterState: { count: updated.length },
  });
  return updated.length;
}

export type PostResult = { posted: number; toSuspense: number; failed: { id: string; error: string }[] };

/**
 * Post staged transactions to the ledger (spec 5.2). Uncategorised rows go to
 * the suspense account so nothing is silently dropped — the accountant clears
 * suspense before period close.
 */
export async function postBankTransactions(
  entityId: string,
  txnIds: string[],
  userId: string
): Promise<PostResult> {
  if (txnIds.length === 0) return { posted: 0, toSuspense: 0, failed: [] };

  const rows = await db
    .select()
    .from(bankTransactions)
    .where(and(eq(bankTransactions.entityId, entityId), inArray(bankTransactions.id, txnIds)))
    .orderBy(asc(bankTransactions.txnDate));

  const suspenseId = await resolveMapping(entityId, "suspense");

  let posted = 0;
  let toSuspense = 0;
  const failed: { id: string; error: string }[] = [];

  for (const txn of rows) {
    if (txn.status === "posted" || txn.status === "ignored") continue;

    const amount = new Decimal(txn.amount);
    const categoryId = txn.categoryAccountId ?? suspenseId;
    if (!txn.categoryAccountId) toSuspense++;

    const abs = amount.abs().toFixed(2);
    const moneyIn = amount.greaterThan(0);

    // money in  → DR bank / CR category ; money out → DR category / CR bank
    const lines = moneyIn
      ? [
          { accountId: txn.bankAccountId, debit: abs },
          { accountId: categoryId, credit: abs },
        ]
      : [
          { accountId: categoryId, debit: abs },
          { accountId: txn.bankAccountId, credit: abs },
        ];

    try {
      const { jeId } = await postJournalEntry(
        {
          entityId,
          date: txn.txnDate,
          description: txn.description.slice(0, 200),
          reference: "Bank import",
          sourceModule: "bank",
          lines,
        },
        userId
      );
      await db
        .update(bankTransactions)
        .set({ status: "posted", jeId, categoryAccountId: categoryId })
        .where(eq(bankTransactions.id, txn.id));
      posted++;
    } catch (err) {
      failed.push({ id: txn.id, error: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  await writeAudit(db, {
    entityId,
    userId,
    action: "BANK_TXN_POSTED",
    tableName: "bank_transactions",
    afterState: { posted, toSuspense, failed: failed.length },
  });

  return { posted, toSuspense, failed };
}

/** Bank accounts available for import (cash & bank COA accounts). */
export async function listBankAccounts(entityId: string) {
  return db
    .select({
      id: chartOfAccounts.id,
      number: chartOfAccounts.accountNumber,
      name: chartOfAccounts.name,
    })
    .from(chartOfAccounts)
    .where(
      and(
        eq(chartOfAccounts.entityId, entityId),
        eq(chartOfAccounts.isActive, true),
        sql`(${chartOfAccounts.subType} = 'cash_and_bank'
             OR (${chartOfAccounts.type} = 'asset'
                 AND ${chartOfAccounts.accountNumber} ~ '^10[0-9][0-9]$'))`
      )
    )
    .orderBy(asc(chartOfAccounts.accountNumber));
}

export async function listImportBatches(entityId: string) {
  return db
    .select({
      id: bankImportBatches.id,
      filename: bankImportBatches.filename,
      rowCount: bankImportBatches.rowCount,
      importedCount: bankImportBatches.importedCount,
      duplicateCount: bankImportBatches.duplicateCount,
      rejectedCount: bankImportBatches.rejectedCount,
      createdAt: bankImportBatches.createdAt,
      bankNumber: chartOfAccounts.accountNumber,
      bankName: chartOfAccounts.name,
    })
    .from(bankImportBatches)
    .innerJoin(chartOfAccounts, eq(bankImportBatches.bankAccountId, chartOfAccounts.id))
    .where(eq(bankImportBatches.entityId, entityId))
    .orderBy(desc(bankImportBatches.createdAt))
    .limit(25);
}

/** Count of journal entries sourced from bank import (for the hub summary). */
export async function countPostedFromBank(entityId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(journalEntries)
    .where(and(eq(journalEntries.entityId, entityId), eq(journalEntries.sourceModule, "bank")));
  return row?.n ?? 0;
}
