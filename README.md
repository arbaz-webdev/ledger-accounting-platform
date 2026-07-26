# Ledger Platform

Multi-tenant, double-entry accounting platform for accounting firms and their client
businesses. Built from `../Accounting_Software_DataFlow_Specification.pdf`.

## Stack

- **Next.js 15** (App Router, server components + server actions), TypeScript, Tailwind 4
- **PostgreSQL 17** — embedded binaries for local dev (`embedded-postgres`), any PG 15+ in production
- **Drizzle ORM** for queries + hand-written SQL migrations (DB triggers need raw SQL)

## Getting started

```bash
npm install
npm run db:start     # starts local PostgreSQL on port 5433 (data in .pgdata/)
npm run db:migrate   # applies src/db/migrations/*.sql
npm run db:seed      # demo firm, users, entity, default COA, current-year periods
npm run dev          # http://localhost:3000
```

Demo logins (password `demo1234`):

| Login | Role | Interface |
|---|---|---|
| `accountant@demo.test` | firm_admin | Accountant — full control |
| `owner@demo.test` | business_admin | Business — scoped to Acme Trading Ltd |

Stop the database with `npm run db:stop`. To use a different PostgreSQL (Docker, native,
cloud), point `DATABASE_URL` in `.env` at it and skip `db:start`.

## Deploying (Vercel + a cloud Postgres)

The local `embedded-postgres` is a **devDependency** and is never installed in
production — the app only needs a `DATABASE_URL` pointing at any PostgreSQL 15+.

1. **Create a Postgres database** (e.g. [Neon](https://neon.tech) free tier) and copy its
   **pooled** connection string. Pooling matters: serverless functions open many short
   connections.
2. **Migrate + seed it once**, from your machine:
   ```bash
   DATABASE_URL="<cloud-url>" npm run db:migrate
   DATABASE_URL="<cloud-url>" npm run db:seed
   ```
3. **Deploy on [Vercel](https://vercel.com)**: import this repo, add the `DATABASE_URL`
   environment variable, deploy. Vercel builds `npm run build` and serves it.

Demo credentials work on the live URL exactly as locally. This is a **demo deployment** —
it has no email verification, MFA, rate limiting, or password reset, so don't use it for
real financial data as-is.

## Architecture invariants

These come from the spec and are **enforced in the database**, not just the app:

1. **Double entry** — `SUM(debit) = SUM(credit)` per journal entry, checked by a deferred
   constraint trigger at commit. Unbalanced entries cannot exist, period.
2. **Period locks** — postings dated in a locked period are rejected by trigger on both
   the JE header and every line insert.
3. **Immutability** — posted entries and their lines reject all UPDATE/DELETE. The only
   allowed transition is `posted → voided`, and voiding auto-creates a posted reversal
   entry (debits/credits swapped). Both stay in the ledger and cancel to zero.
4. **Append-only audit log** — UPDATE/DELETE on `audit_log` raise, even for admins.
5. **Account validation** — JE lines must reference an active account of the same entity.

Run `npm run verify:engine` to adversarially test all of the above with raw SQL that
bypasses the application layer entirely.

**The single most important code rule:** `postJournalEntry` / `saveDraftJournalEntry` /
`voidJournalEntry` in [src/services/journal.ts](src/services/journal.ts) are the ONLY
write path to the ledger. Every future module (invoicing, bills, payroll, bank import,
inventory) calls these — nothing writes to `journal_entries` / `journal_entry_lines`
directly.

Reports (trial balance, general ledger, and all future statements) are live SQL over the
ledger — never cached snapshots.

## Layout

```
scripts/            db lifecycle, migration runner, seed, engine verification
src/db/migrations/  numbered SQL migrations (schema + triggers)
src/db/schema.ts    Drizzle table definitions (mirrors the SQL)
src/services/       journal engine, COA, periods, reports, audit — all business logic
src/lib/auth.ts     sessions, roles, entity access guards
src/app/(accountant)/  accountant interface (multi-client)
src/app/(business)/    business interface (single entity, restricted)
```

## Build phases

- [x] Phase 0 — environment, auth, multi-tenancy scaffold
- [x] Phase 1 — core engine: COA, JE engine, periods, trial balance, GL, audit trail
- [x] Phase 2 — P&L, Balance Sheet (always balances), Cash Flow (indirect, always reconciles)
- [x] Phase 3 — Invoicing (AR) & Bills (AP), account mapping engine, AR/AP ageing
- [x] Phase 4 — Bank CSV import, rules engine, review queue, reconciliation
- [x] Phase 5 — Payroll (employees, pay runs, statutory deductions, GL posting)
- [x] Phase 6 — Inventory (FIFO / AVCO / specific ID per item, invoice/bill integration, GL tie-out)
- [x] Phase 7 — Period close checklist, year-end close (real closing JE), tax summary, comparative P&L, changes in equity, day book
- [x] Phase 8 — Hardening: multi-currency + realised FX, permissions matrix & user admin, CSV exports + print views, client portal
