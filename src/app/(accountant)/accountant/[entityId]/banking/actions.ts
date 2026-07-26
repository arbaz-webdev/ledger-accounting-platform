"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccountant, assertEntityAccess } from "@/lib/auth";
import { requireModule } from "@/services/permissions";
import {
  buildPreview,
  importTransactions,
  categoriseTransactions,
  ignoreTransactions,
  postBankTransactions,
  BankImportError,
  type ImportPreview,
  type ImportResult,
} from "@/services/bank-import";
import { createRule, setRuleActive, deleteRule, type RuleMatch, type RuleDirection } from "@/services/bank-rules";
import { approveReconciliation, ReconciliationError } from "@/services/bank-recon";
import { detectColumns, parseCsv, type ColumnMapping } from "@/lib/csv";
import { MappingError } from "@/services/mappings";
import { JournalValidationError } from "@/services/journal";
import { triggerMessage } from "@/db/errors";

function readable(err: unknown, fallback: string): string {
  if (
    err instanceof BankImportError ||
    err instanceof ReconciliationError ||
    err instanceof MappingError ||
    err instanceof JournalValidationError
  ) {
    return err.message;
  }
  return triggerMessage(err) ?? (err instanceof Error ? err.message : fallback);
}

export type PreviewState = {
  error?: string;
  preview?: ImportPreview;
  csvText?: string;
  filename?: string;
};

/** Step 1: read the uploaded file and auto-detect its columns. */
export async function analyseCsvAction(
  _prev: PreviewState,
  formData: FormData
): Promise<PreviewState> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "banking");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file to upload" };
  }
  if (file.size > 5_000_000) {
    return { error: "File is larger than 5 MB — split the statement and try again" };
  }

  const csvText = await file.text();
  const { headers } = parseCsv(csvText);
  if (headers.length === 0) return { error: "That file has no readable rows" };

  const mapping = detectColumns(headers);
  const preview = buildPreview(csvText, mapping);
  return { preview, csvText, filename: file.name };
}

/** Step 2: re-run the preview with a mapping the user adjusted. */
export async function repreviewAction(
  csvText: string,
  mapping: ColumnMapping
): Promise<ImportPreview> {
  await requireAccountant();
  return buildPreview(csvText, mapping);
}

/** Step 3: stage the rows. */
export async function importCsvAction(payload: {
  entityId: string;
  bankAccountId: string;
  filename: string;
  csvText: string;
  mapping: ColumnMapping;
}): Promise<{ error?: string; result?: ImportResult }> {
  const user = await requireAccountant();
  await assertEntityAccess(user, payload.entityId);
  await requireModule(user, payload.entityId, "banking");

  try {
    const result = await importTransactions(payload, user.id);
    revalidatePath(`/accountant/${payload.entityId}/banking`);
    return { result };
  } catch (err) {
    return { error: readable(err, "Import failed") };
  }
}

// --- Review queue -----------------------------------------------------------

export async function categoriseAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "banking");

  const ids = formData.getAll("txnIds").map(String).filter(Boolean);
  const accountId = String(formData.get("accountId"));
  const base = `/accountant/${entityId}/banking/review`;
  if (ids.length === 0 || !accountId) {
    redirect(`${base}?error=${encodeURIComponent("Select transactions and an account first")}`);
  }

  await categoriseTransactions(entityId, ids, accountId, user.id);
  revalidatePath(base);
  redirect(base);
}

export async function ignoreAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "banking");

  const ids = formData.getAll("txnIds").map(String).filter(Boolean);
  const base = `/accountant/${entityId}/banking/review`;
  if (ids.length > 0) await ignoreTransactions(entityId, ids, user.id);
  revalidatePath(base);
  redirect(base);
}

export async function postAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "banking");

  const ids = formData.getAll("txnIds").map(String).filter(Boolean);
  const base = `/accountant/${entityId}/banking/review`;
  if (ids.length === 0) {
    redirect(`${base}?error=${encodeURIComponent("Select at least one transaction to post")}`);
  }

  let msg: string;
  try {
    const result = await postBankTransactions(entityId, ids, user.id);
    msg =
      `Posted ${result.posted} transaction(s)` +
      (result.toSuspense > 0 ? `, ${result.toSuspense} to suspense` : "") +
      (result.failed.length > 0 ? `. ${result.failed.length} failed: ${result.failed[0].error}` : ".");
  } catch (err) {
    redirect(`${base}?error=${encodeURIComponent(readable(err, "Posting failed"))}`);
  }
  revalidatePath(base);
  redirect(`${base}?posted=${encodeURIComponent(msg)}`);
}

// --- Rules ------------------------------------------------------------------

export async function createRuleAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "banking");

  const matchText = String(formData.get("matchText") ?? "").trim();
  const accountId = String(formData.get("accountId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? `/accountant/${entityId}/banking/rules`);
  if (!matchText || !accountId) {
    redirect(`${returnTo}?error=${encodeURIComponent("Match text and account are required")}`);
  }

  await createRule(
    {
      entityId,
      matchText,
      matchType: (String(formData.get("matchType")) || "contains") as RuleMatch,
      direction: (String(formData.get("direction")) || "any") as RuleDirection,
      accountId,
      priority: Number(formData.get("priority")) || 100,
    },
    user.id
  );
  revalidatePath(returnTo);
  redirect(returnTo);
}

export async function toggleRuleAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "banking");

  await setRuleActive(
    String(formData.get("ruleId")),
    entityId,
    String(formData.get("makeActive")) === "true",
    user.id
  );
  revalidatePath(`/accountant/${entityId}/banking/rules`);
}

export async function deleteRuleAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "banking");

  await deleteRule(String(formData.get("ruleId")), entityId, user.id);
  revalidatePath(`/accountant/${entityId}/banking/rules`);
}

// --- Reconciliation ---------------------------------------------------------

export async function approveReconciliationAction(formData: FormData): Promise<void> {
  const user = await requireAccountant();
  const entityId = String(formData.get("entityId"));
  await assertEntityAccess(user, entityId);
  await requireModule(user, entityId, "banking");

  const bankAccountId = String(formData.get("bankAccountId"));
  const statementDate = String(formData.get("statementDate"));
  const statementBalance = String(formData.get("statementBalance"));
  const clearedTxnIds = formData.getAll("clearedTxnIds").map(String).filter(Boolean);

  const base = `/accountant/${entityId}/banking/reconcile?account=${bankAccountId}&date=${statementDate}`;
  try {
    await approveReconciliation(
      { entityId, bankAccountId, statementDate, statementBalance, clearedTxnIds },
      user.id
    );
  } catch (err) {
    redirect(`${base}&error=${encodeURIComponent(readable(err, "Could not reconcile"))}`);
  }
  revalidatePath(base);
  redirect(`${base}&done=1`);
}
