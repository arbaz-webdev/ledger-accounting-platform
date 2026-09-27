import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, type Db, type Tx } from "@/db";
import { bankRules, chartOfAccounts } from "@/db/schema";
import { writeAudit } from "@/services/audit";
import { assertPostingAccount } from "@/services/account-policy";

/**
 * Categorisation rules engine (spec 5.1 "Auto-Categorise").
 * Deterministic and user-configurable: lowest priority number wins, and a rule
 * can be limited to money-in or money-out so "TRANSFER" can mean different
 * accounts in each direction.
 */

export type RuleMatch = "contains" | "starts_with" | "equals";
export type RuleDirection = "any" | "money_in" | "money_out";

export type BankRule = {
  id: string;
  priority: number;
  matchType: RuleMatch;
  matchText: string;
  direction: RuleDirection;
  accountId: string;
  isActive: boolean;
  timesApplied: number;
};

export async function listRules(entityId: string) {
  return db
    .select({
      id: bankRules.id,
      priority: bankRules.priority,
      matchType: bankRules.matchType,
      matchText: bankRules.matchText,
      direction: bankRules.direction,
      accountId: bankRules.accountId,
      isActive: bankRules.isActive,
      timesApplied: bankRules.timesApplied,
      accountNumber: chartOfAccounts.accountNumber,
      accountName: chartOfAccounts.name,
    })
    .from(bankRules)
    .innerJoin(chartOfAccounts, eq(bankRules.accountId, chartOfAccounts.id))
    .where(eq(bankRules.entityId, entityId))
    .orderBy(asc(bankRules.priority), asc(bankRules.matchText));
}

/** Active rules in priority order, for the matcher. */
export async function loadActiveRules(entityId: string): Promise<BankRule[]> {
  const rows = await db
    .select()
    .from(bankRules)
    .where(and(eq(bankRules.entityId, entityId), eq(bankRules.isActive, true)))
    .orderBy(asc(bankRules.priority));
  return rows.map((r) => ({
    id: r.id,
    priority: r.priority,
    matchType: r.matchType as RuleMatch,
    matchText: r.matchText,
    direction: r.direction as RuleDirection,
    accountId: r.accountId,
    isActive: r.isActive,
    timesApplied: r.timesApplied,
  }));
}

/** First rule that matches this description/direction, or null. */
export function matchRule(
  rules: BankRule[],
  description: string,
  amount: number
): BankRule | null {
  const haystack = description.toLowerCase();
  const direction: RuleDirection = amount >= 0 ? "money_in" : "money_out";

  for (const rule of rules) {
    if (rule.direction !== "any" && rule.direction !== direction) continue;
    const needle = rule.matchText.toLowerCase();
    const hit =
      rule.matchType === "equals"
        ? haystack === needle
        : rule.matchType === "starts_with"
          ? haystack.startsWith(needle)
          : haystack.includes(needle);
    if (hit) return rule;
  }
  return null;
}

export async function createRule(
  input: {
    entityId: string;
    matchText: string;
    matchType?: RuleMatch;
    direction?: RuleDirection;
    accountId: string;
    priority?: number;
  },
  userId: string
) {
  return db.transaction(async (tx) => {
    await assertPostingAccount(input.entityId, input.accountId, "category", tx);
    const [rule] = await tx
      .insert(bankRules)
      .values({
        entityId: input.entityId,
        matchText: input.matchText.trim(),
        matchType: input.matchType ?? "contains",
        direction: input.direction ?? "any",
        accountId: input.accountId,
        priority: input.priority ?? 100,
        createdBy: userId,
      })
      .returning();

    await writeAudit(tx, {
      entityId: input.entityId,
      userId,
      action: "BANK_RULE_CREATED",
      tableName: "bank_rules",
      recordId: rule.id,
      afterState: { matchText: rule.matchText, direction: rule.direction },
    });
    return rule;
  });
}

export async function setRuleActive(
  ruleId: string,
  entityId: string,
  isActive: boolean,
  userId: string
) {
  return db.transaction(async (tx) => {
    await tx
      .update(bankRules)
      .set({ isActive })
      .where(and(eq(bankRules.id, ruleId), eq(bankRules.entityId, entityId)));
    await writeAudit(tx, {
      entityId,
      userId,
      action: "BANK_RULE_UPDATED",
      tableName: "bank_rules",
      recordId: ruleId,
      afterState: { isActive },
    });
  });
}

export async function deleteRule(ruleId: string, entityId: string, userId: string) {
  return db.transaction(async (tx) => {
    await tx.delete(bankRules).where(and(eq(bankRules.id, ruleId), eq(bankRules.entityId, entityId)));
    await writeAudit(tx, {
      entityId,
      userId,
      action: "BANK_RULE_DELETED",
      tableName: "bank_rules",
      recordId: ruleId,
    });
  });
}

export async function bumpRuleUsage(ruleIds: string[], executor: Db | Tx = db) {
  const unique = [...new Set(ruleIds)];
  for (const id of unique) {
    const count = ruleIds.filter((r) => r === id).length;
    await executor
      .update(bankRules)
      .set({ timesApplied: sql`${bankRules.timesApplied} + ${count}` })
      .where(eq(bankRules.id, id));
  }
}
