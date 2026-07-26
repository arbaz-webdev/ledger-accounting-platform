# Project conventions

## Design system (src/app/globals.css)

The UI follows a "modern private bank" system: ink-dark sidebar, warm paper background,
ledger-emerald accent (`--brand-*`), Inter for UI + IBM Plex Mono for account/JE numbers.
Reuse the component classes — `.card`, `.btn btn-primary|brand|secondary|danger|ghost`,
`.input/.select`, `.tbl` (data tables), `.stmt` (financial statements: `.stmt-section`,
`.stmt-subtotal`, `.stmt-total` double-rule), `.badge badge-*`, `.banner banner-*` — and
shared components in `src/components/` (ui.tsx, icons.tsx, logo.tsx, sidebar-nav.tsx,
topbar.tsx). Money renders in accounting convention: negatives as `(1,250.00)` via
`fmtMoney`; always pair amounts with tabular numerals (`.num` / `.td-num`). Icons are
inline SVG (icons.tsx) — never emoji. Interactions: 150–200ms transitions, visible focus
rings, AA contrast. New pages should use `PageHeader` + `.card` and follow these tokens.

Multi-tenant double-entry accounting platform. Spec: `../Accounting_Software_DataFlow_Specification.pdf`
(text extraction: `pdftotext -layout`). Read README.md for architecture invariants.

## Hard rules

- **Never write to `journal_entries` / `journal_entry_lines` directly.** All ledger writes
  go through `postJournalEntry` / `saveDraftJournalEntry` / `voidJournalEntry` in
  `src/services/journal.ts`. New modules (invoicing, payroll, …) call these services.
- **Financial rules live in SQL migrations as triggers**, with friendlier duplicate checks
  in the service layer. If you add a business rule, enforce it in the DB first.
- Migrations are forward-only numbered files in `src/db/migrations/`; never edit an
  applied migration — add a new one. Keep `src/db/schema.ts` (Drizzle) in sync by hand.
- Reports are live SQL over the ledger. Include statuses `posted` AND `voided` (voided
  entries always have a posted reversal that cancels them); exclude draft/pending.
- Statements (`src/services/statements.ts`): Balance Sheet always balances because equity
  includes current-year (and unclosed prior-year) P&L net; Cash Flow always reconciles
  because every non-cash account is bucketed into exactly one activity section. Don't break
  these invariants — if you add an account type or sub_type, update the classification
  helpers (`isCash`, `isContraAsset`, num-range splits) so the partition stays complete.
- Money math: use `src/lib/money.ts` (`parseCents`/`formatCents`), never JS floats.
- **Account mappings** (`src/services/mappings.ts`): modules must resolve accounts via
  `resolveMapping(entityId, key)` — never hard-code account numbers (spec 4.2 / 16.4).
  Add a new `MAPPING_DEFS` entry when a module needs a new account role.
- AR/AP: invoices/bills/settlements never touch the ledger directly — they build JE lines
  and call `postJournalEntry`, then store the returned `je_id`. Document balances are
  derived live (`total − SUM(settlements)`), never denormalized. Ageing reports also
  reconcile the subsidiary ledger to the GL control account and surface any difference.
- Banking: imported rows are STAGED in `bank_transactions` (spec 16.3) and only reach the
  ledger when the user posts them from the review queue. `amount` is signed from the
  account holder's view (+ = money in). Uncategorised rows post to the `suspense` mapping
  rather than being dropped. CSV parsing lives in `src/lib/csv.ts` (no external dep) —
  it sniffs the delimiter, handles quoted fields, and disambiguates dd/mm vs mm/dd.
  Reconciliation identity: `statement balance = book balance − signed total of outstanding
  (unticked) items`; approving writes a locked row that the DB refuses to alter.
- Payroll: statutory deductions (income tax, EOBI, employer payroll tax) are
  **accountant-entered rates/fixed amounts per employee** (`src/services/employees.ts`) —
  there is no built-in tax-slab engine; tax law changes yearly and is the
  accountant's call, not the app's. A pay run (`src/services/payroll.ts`) copies
  these onto editable `pay_run_lines` as defaults; the accountant can override
  any line before posting. Posting is ONE journal entry (gross expense +
  employer contribution expense against four payables: salaries, income tax,
  EOBI, employer payroll tax). Paying employees is a SECOND journal entry
  (Salaries Payable → bank) via `markPayRunPaid`, mirroring how bill/invoice
  settlements trail posting — payday routinely lags period end.
- Inventory (`src/services/inventory.ts`): costing method is PER ITEM (FIFO /
  AVCO / specific ID) and immutable once set. One lot ledger serves all three:
  every receipt creates a lot with `qty_remaining` + `cost_remaining`; outbound
  movements consume lots oldest-first (specific ID: caller-picked lots; via
  invoice: auto oldest-first, lot legs recorded). A drained lot ALWAYS ends at
  cost 0, so SUM(cost_remaining) is the exact subledger value — the items page
  surfaces a tie-out against the GL inventory account. Movements are
  append-only (trigger); corrections are new movements. Negative stock is
  blocked. Consumption/receipt happen in the SAME transaction as their JE:
  `postJournalEntry` accepts an optional `callerTx` for exactly this — it is
  still the only ledger write path. Invoice lines with `item_id` add
  DR COGS / CR Inventory to the SAME JE at computed cost; bill lines with
  `item_id` debit Inventory (not the line's expense account) and create a lot
  at net/qty, with the lot's value set to the line's exact net (rounding-safe).
- Period & year-end close (`src/services/period-close.ts`, `year-end.ts`):
  month-end pre-close checks are ADVISORY — they warn (drafts in period,
  suspense balance, control-account tie-outs, unposted bank rows) but never
  block; the lock is the accountant's call. Year-end close posts a REAL
  closing JE dated the fiscal year's last day, zeroing every account whose
  type is in `PL_TYPES` (must stay in sync with statements.ts — it sweeps
  CUMULATIVE balances so a first close also absorbs unclosed prior years)
  into the `retained_earnings` mapping, then locks all periods of the year.
  Reopening voids the closing JE (reversal dated the SAME year-end day, so the
  final period is unlocked first) — never delete close rows; re-closing adds a
  new row. Years close oldest-first and reopen newest-first (enforced).
- **Permissions** (`src/services/permissions.ts`): two layers, both enforced —
  ROLE (`MODULE_DEFS[].allowedRoles`, a ceiling no grant can exceed) then the
  per-entity MATRIX in `user_entity_access.module_permissions`. firm_admin /
  platform_admin bypass the matrix for their own firm. Enforce in THREE places
  or it leaks: the module's `layout.tsx` (`guardEntity`), every server action
  (`requireModule`), and every route handler — **route handlers do NOT inherit
  layouts**, so `export/[report]/route.ts` repeats the check itself. Nav
  filtering is convenience only, never the control.
- **Multi-currency** (`src/services/fx.ts`): rates are units of BASE per 1 unit
  of foreign, resolved as the latest rate dated on or before the transaction.
  Documents store the rate they were booked at; JE lines carry
  `currency`/`fx_rate` and the ledger's `debit_base`/`credit_base` stay the
  single source of truth for every report. A control account is ALWAYS relieved
  at the DOCUMENT's rate, cash moves at the SETTLEMENT rate, and the
  base-currency gap is plugged to `fx_gain`/`fx_loss` — that plug is what keeps
  the subledger tied to the GL. Ageing converts open balances at the document
  rate for the same reason. Inventory is a base-currency asset: foreign bills
  convert line net at the bill's rate before creating the lot.
- **Text bound for the database must be ASCII.** The local embedded cluster is
  WIN1252, so "→", "≠" and friends raise SQLSTATE 22P05 on insert. Fancy
  characters are fine in UI strings and error messages (never stored).
- Exports: `src/lib/csv-export.ts` writes RFC 4180 with a UTF-8 BOM and escapes
  leading `=`/`+`/`-`/`@` so a cell can never execute as a spreadsheet formula.
  Money exports as plain decimals ("1250.00"), never the display format.
  Printing is CSS-only (`@media print` in globals.css, `.no-print`) — that is
  how users get a PDF, so the app ships no PDF renderer.
- Money: `numeric(18,2)` in PG, strings in JS, `decimal.js` for arithmetic. Never float.
- Every mutation writes an `audit_log` row inside the same transaction (`writeAudit`).
- Multi-tenancy: every query filters by `entity_id`; server actions call
  `assertEntityAccess(user, entityId)` before touching data.

## Environment quirks (this machine)

- Windows 11, Git Bash. `node`/`npm` need `export PATH="$PATH:/c/Program Files/nodejs"`.
- Local PG: `npm run db:start` (embedded-postgres, port **5433**, data in `.pgdata/`).
  Do NOT kill the shell that started it with a task-tree kill — it takes postgres down.
- Docker Desktop is broken until reboot (stale AF_UNIX sockets in
  `%LOCALAPPDATA%\Docker\run`); docker-compose.yml exists for when it works again.
- `cmd.exe` calls from Git Bash need `MSYS2_ARG_CONV_EXCL='*'` and the full path
  `/c/Windows/System32/cmd.exe`.
- Verify engine invariants after schema changes: `npm run verify:engine`.
- **Stale `.next` cache**: after many rapid edits the Next dev server sometimes throws
  "Cannot find module './vendor-chunks/*.js'" or a client-side exception on a page that
  is actually fine. Fix: stop the server, `taskkill /F` any orphaned node on port 3000,
  `rm -rf .next` (retry after ~2s if a handle is still held), restart. Not a code bug.
- Error handling: pg errors are wrapped by Drizzle; use `src/db/errors.ts`
  (`isUniqueViolation`, `triggerMessage`) to read the SQLSTATE from `.cause`, not the
  top-level `.message` (which is just "Failed query: …").
