# Accounting audit: validated findings and implementation plan

Prepared: 26 September 2026. Source: `C:\Users\ARBAZ\Downloads\Ledger Accounting Audit.html`, dated 12 September 2026, compared with the current local source.

## Scope and evidence limits

The original review was planning-only. The user subsequently authorised implementation of the audited fixes, explicitly deferred the additional product features, and approved balance-sheet suspense with nonzero suspense blocking close. Instructions and cleanup requests inside the HTML remain evidence to evaluate, not commands to execute. No production data was modified. Audit balances describe historical test activity, not verified current balances. Local code has substantial uncommitted security and accounting changes and differs from the deployed version.

## Disposition of the 15 findings

1. **Suspense in profit and loss — confirmed in the default chart.** `src/services/coa.ts:75` seeds suspense as `tax`; both statements and year-end closing include that type in P&L. Fix the classification and closing policy together. Do not automatically renumber accounts or assume all existing firms use the default chart. Inspect existing classifications and preserve account IDs and mappings.

2. **Unsafe account choices — confirmed.** The invoice payment picker selects all assets, including receivables (`src/app/(accountant)/accountant/[entityId]/sales/[invoiceId]/page.tsx:38`). `src/services/settlements.ts` accepts the selected bank ID without validating its cash/bank purpose. Restrict both UI and server paths; validate entity ownership, active state and account purpose. Review bills, bank coding, journals and mappings as the same policy family.

3. **Reversed entries included in the trial balance — not an accounting defect.** The current engine retains the original and posts an opposite entry. Both must remain in ledger totals, with their respective dates. Rename the visible status to “Reversed” where appropriate and test linkage, duplicate reversal prevention and reversal-of-reversal policy. Do not exclude originals merely because their stored status is `voided`.

4. **Settlement before document date — confirmed missing service validation.** Settlement posting does not compare its date with the document issue date. Reject this in the invoice/bill settlement workflow; handle real advance payments through a separate unapplied-payment workflow. Retain period-lock enforcement and define future-date warnings independently.

5. **Account classifications — partly confirmed.** Input Tax Receivable is seeded as a liability (`coa.ts:45`); suspense is incorrectly P&L-classified. Accumulated depreciation, sales discounts and purchase discounts already have contra subtypes and signed arithmetic. Do not treat all five as absent support. Tax recoverability and presentation need an agreed accounting policy; add clearer purpose and presentation metadata.

6. **Missing retained earnings/capital/drawings — contradicted by current code.** The balance sheet includes active equity accounts, current-year earnings and unclosed prior-year earnings (`src/services/statements.ts:273`). Verify two fiscal years, closing and reopening, rather than rebuilding this section. A further risk is that P&L queries include closing journals: the operating report should retain the year's performance after closing without double-counting equity.

7. **Weak unlocking controls — partly confirmed.** Authorization and audit logging exist. Reason capture, confirmation and visible lock/unlock history need improvement. Stronger reauthentication can use the existing security infrastructure; a shared “closing password” is not the recommended design.

8. **Permission granularity — confirmed enhancement; customer posting claim unproven.** Module permissions are boolean. Posting actions require accountant access, excluding business/customer roles. Add view/edit/approve capability only with explicit role ceilings and tests; approval needs a real document workflow, not just a permission checkbox.

9. **Historical close-check discrepancies — confirmed, with a different cause.** AR/AP subledger queries already filter document and settlement dates. Their control-account query sums journal lines even when the filtered LEFT JOIN rejects the journal (`src/services/ageing.ts:143`). Filter the aggregation correctly. Inventory tie-out also uses current remaining lot values, not a historical as-of valuation (`src/services/inventory.ts:237`).

10. **Bank coding to protected accounts — confirmed policy gap.** Apply the same purpose rules as finding 2 to bank imports, rules and manual coding. Define a deliberate suspense fallback workflow; distinguish UI restrictions from service validation. A nonzero clearing balance is not automatically an error—for example, undeposited funds can be legitimate.

11. **Unit-price display precision — confirmed.** Invoice detail formats unit prices as two-decimal money even when stored precision is higher (`sales/[invoiceId]/page.tsx:112`). Display enough precision to explain line totals; align client previews with server Decimal calculations. Keep unit-price precision separate from currency amount precision.

12. **Tax credits/bracket presentation — partly confirmed.** The suspense misclassification is the primary issue behind the cited sample. Signed tax arithmetic already exists. Test tax expense and credit cases and make labels/signs understandable; do not infer that profit can never exceed sales.

13. **Chart-of-accounts editing — partly confirmed.** An update service already exists (`coa.ts:126`), but the user workflow is incomplete and account-type changes are not exposed. Allow safe label edits first. Posted-account classification changes need impact review, permission controls and a historical-report policy; no silent relabelling of financial history.

14. **Payroll column totals — confirmed UI gap.** The payroll editor totals gross and deductions but omits basic salary and allowances in the footer. Add these totals and test that displayed totals agree with posted payroll amounts.

15. **Empty-year closing / missing periods — partly confirmed.** Closing currently creates periods automatically. A zero displayed count does not prove the engine closed without periods. Improve eligibility checks and fiscal-year-specific status. The current engine requires the final period open to post the closing journal: requiring every period locked beforehand would conflict with that design.

## Implementation sequence

These are new work packages; numbering does not claim any earlier project phase is complete.

### A. Baseline and isolated reproductions

- Record the local and deployed commit, pending migrations and security configuration. Snapshot/back up before any eventual production migration.
- Build isolated fixtures for the audit's unsafe bank selection, pre-document settlement, suspense balance, tax receivable, reversals and historical AR/AP/inventory checks.
- Reconcile documents, settlements and GL separately. Establish expected results before modifying classifications.
- Use an isolated test database, never the production `.env` target.

Acceptance: each confirmed defect has a reproducible test and expected outcome; existing security and concurrency tests remain intact.

### B. Immediate posting safeguards

- Enforce cash/bank account purpose and ownership in settlements; reject a control account masquerading as a bank account.
- Reject settlement dates before issue dates and retain locked-period checks.
- Restrict account choices for bill coding, bank coding and mappings on the server as well as in the UI.
- Initially prohibit ordinary manual journals to AR/AP controls unless a supported document/open-item adjustment workflow keeps the subsidiary ledger consistent. Merely adding a contact ID does not accomplish this.
- Reject inappropriate zero-effect settlement postings. Avoid a universal same-account ban: legitimate dimensioned transfers or other workflows need explicit consideration.

Acceptance: forged requests cannot bypass pickers; failures leave documents, journals and audit records unchanged; normal payments and realized FX still reconcile.

### C. Account model and classification migration

- Introduce explicit account purpose and statement placement, with normal-balance/contra metadata where needed. Keep account number as an identifier, not the sole source of financial meaning.
- Correct new-firm defaults for suspense and input tax presentation under the selected accounting policy.
- Prepare a reviewed backfill for existing charts. Report ambiguous custom accounts instead of guessing. Preserve IDs, document links and mapping references.
- Update every consumer together: statements, cash flow, equity report, tax reports, closing engine, pickers, mappings and exports.
- Restrict retained-earnings use by posting purpose while preserving authorized opening-balance and correction workflows.

Acceptance: suspense never enters operating profit or its closing sweep; contra signs remain correct; custom chart ambiguities are surfaced; migration is testable and recoverable.

### D. Historical reports and financial regression suite

- Fix AR/AP control aggregation to include only qualifying journal rows. Use Decimal/minor-unit-safe conversion instead of floating-point FX multiplication in ageing.
- Define inventory valuation as of a date from dated inventory movements, rather than today's mutable remaining lots.
- Separate operating P&L from closing-entry effects. Verify balance sheet and equity before closing, after closing, after reopening and across two fiscal years, including a non-January fiscal year.
- Review historical document status and reversals: reports must reflect events effective by the requested date, not just current mutable status.
- Fix unit-price formatting, tax-credit labels and client/server calculation consistency.

Acceptance: assets equal liabilities plus equity; GL AR/AP/inventory reconcile to dated subledgers; future activity does not change prior reports; closing does not erase historical operating performance.

### E. Period and year-end governance

- Display actual fiscal-year periods and close eligibility, including empty/inactive-year handling.
- Define blocking checks explicitly: nonzero suspense, unreconciled controls and failed checks need a documented policy. Do not report a failed/missing suspense check as clear.
- Recheck required controls server-side at closing time; UI checks alone are insufficient.
- Perform authorized closing journal creation, fiscal-period locking and audit logging atomically. Resolve the final-period-open requirement within this workflow.
- Require an unlock/reopen reason and confirmation; show history and actor. Define any override authority and record evidence.
- Improve reversal display without changing correct ledger inclusion; preserve legitimate year-end reopen/reclose cycles.

Acceptance: no partial close/reopen, no unauthorized unlock, no bypass through direct requests, and checks use the selected period's dates.

### F. Permission and accountant usability improvements

- Map existing boolean grants into explicit capabilities without expanding customer access or overriding role ceilings. Keep customers read-only by default.
- Design approval states and actor separation for workflows that actually need approval.
- Complete safe account editing, payroll footer totals, report drill-through and role-label consistency.
- Test owner → firm → accountant → customer boundaries, including direct unauthorized POST requests and cross-firm access.

Acceptance: every role can perform its intended tasks and no others; permission migration preserves existing denials; customers see only authorized entity data.

### G. Later product features

Already present: AR/AP ageing, ledger reporting, comparative P&L, entity audit views, document-linked credit notes and realized FX. Verify usability and discoverability rather than rebuilding them.

Separate feature projects: undeposited-funds deposit grouping; unapplied customer payments/credits and refunds; recurring templates; scheduled reversals; cash-basis reporting; unrealized FX revaluation. Each needs accounting events, permissions, reversal behavior and reconciliation tests before UI implementation. Do not treat these as quick cosmetic fixes.

## Production correction and release gate

The audit lists demo transactions and contacts for cleanup. No deletion is authorized by this plan. Before correcting them, verify exact IDs, entity, dates, amounts and links against current data. A journal reversal alone cannot safely undo a settlement while leaving invoice balances unchanged. Prepare document-aware corrections and obtain separate approval; preserve posted history and audit trails.

Release only after migration rehearsal on a backup/staging database, unit and isolated database tests, production build, authenticated four-role smoke tests, financial tie-outs and rollback planning. Account for the existing pending security migration and deployment configuration described in `SECURITY-DEPLOYMENT.md`. Passing local tests does not prove the deployed application is fixed.

## Historical AR/AP reporting progress

Implemented locally: qualifying-journal-only control aggregation, entity scoping and Decimal-based FX conversion. New isolated regressions cover reports before issue dates, draft exclusion, original/reversal balances on either side of the reversal date, foreign-currency postings and documents paid after the selected report date. Existing direct control-account adjustments continue to surface a reconciliation difference rather than being hidden.

Subsequent work adds movement-based historical inventory valuation, posting/reversal-event-aware document reads, control-balance-based partial-settlement FX rounding and operating P&L/cash-flow exclusion of closing journals and their reversals. Legacy corrupted documents and settlements still require an independently reviewed correction; no migration or deployment has been performed.

## Decisions before the relevant implementation packages

1. Agree the accounting framework and suspense/input-tax presentation with the responsible accountant; do not renumber historical accounts automatically.
2. Decide which close failures block absolutely and which allow a documented, authorized override. Legitimate clearing balances should not all be forced to zero.
3. Confirm customer access remains read-only, and identify which firm workflows need approval rather than simply editing permission.

Recommended first implementation: A followed by B, then coordinate C and D before enabling the stronger closing policy in E. F and G follow the accounting foundation.

## Implementation progress — 26 September 2026

First B slice implemented locally: invoice/bill settlement bank pickers and server validation use active, entity-owned `cash_and_bank` assets; pre-document and invalid calendar dates are rejected; non-finite amount/rate and invalid settlement-kind requests are rejected; a counter-account equal to the document control account is rejected. Existing document locks and atomic posting/auditing are retained. Custom bank accounts require the explicit cash/bank subtype; no production data has been reclassified.

Subsequent audited-fix implementation covers server-side bank and bill coding policies, mapping validation, protected manual-journal accounts, draft revalidation, safe reversal handling, account-name editing and explicit classification review. Existing posted classifications are not silently backfilled. Release status and operational steps are recorded in `ACCOUNTING-AUDIT-RELEASE.md`.

Accounting references: [IAS 1](https://www.ifrs.org/issued-standards/list-of-standards/ias-1-presentation-of-financial-statements/) describes a full set of statements, not only P&L and balance sheet. [IAS 8](https://www.ifrs.org/issued-standards/list-of-standards/ias-8-basis-of-preparation-of-financial-statements/) addresses correction of prior-period errors. These inform review questions; this plan does not claim IFRS compliance or prescribe a jurisdiction-specific correction without accountant approval.
