# Audited accounting fixes: local release handoff

Date: 27 September 2026. Local baseline: `6ea853fb28412a01433bdd0274a34555a713ce61`, plus preserved, uncommitted security changes and this accounting work. The deployed commit was not verified in this task. No Git commit, push, production migration, historical cleanup or deployment was performed.

## Agreed scope

Complete the audited fixes first. Additional product features remain deferred by the user's explicit choice: advance payments/refunds, deposit grouping, recurring entries, cash-basis reports and unrealized FX. Customer roles remain read-only. Suspense is a balance-sheet clearing account and nonzero suspense blocks closing. Other pre-close checks remain advisory, with visible results.

## Implemented or verified against the audit

- **01 / 05 / 12 — classification and presentation:** corrected new-chart suspense and input-tax defaults; purpose-aware current-asset presentation; existing contra accounting retained and tested; tax credits labelled distinctly. Existing misclassified default accounts have an explicit administrator review, reason and confirmation workflow. No posted history is silently rewritten. Accounts already included in an active closing sweep require affected closes to be reopened before correction.
- **02 / 04 / 10 — posting safeguards:** active entity-owned cash/bank selections, valid settlement dates, no pre-document settlement, protected control-account policies, bill coding restrictions, bank rule/category validation and mapping ownership/purpose checks. Manual AR/AP and retained-earnings posting is prohibited through the ordinary journal workflow. Uncategorised bank rows may deliberately use valid suspense; users cannot select protected accounts as ordinary categories.
- **03 — reversals:** originals and reversals stay in dated ledger totals. Visible status is “Reversed”; reversal-of-reversal is denied. Linked invoice, bill, stock and bank journals cannot be independently reversed through the generic journal page. Closing journals require the fiscal-year reopening workflow. Document-aware historical correction remains a separate release operation, not blanket deletion.
- **06 / 09 — reports:** confirmed the existing retained-earnings/capital/drawings support; fixed historical AR/AP control aggregation and dated inventory tie-out. Ageing uses actual base-currency control relief rather than floating-point conversions. Small FX instalments clear remaining control cents. Historical documents are assessed against their posting/reversal events. Operating P&L and cash flow exclude closing journals and their reversals; balance-sheet/equity ledger totals retain them.
- **07 / 15 — close governance:** close is transactional and serialised per entity; empty years are rejected, fiscal-year display uses twelve periods, suspense is rechecked server-side, unlock/reopen requires a recorded reason and confirmation, and periods belonging to an active closed year require the year reopening workflow. A recent actor/reason history is visible on the periods page. Other reconciliation warnings are not silently treated as blocking policy.
- **08 — permissions:** boolean grants remain backward compatible; view/edit/approve capability checks respect role ceilings. Write actions require edit capability; bank reconciliation approval requires administrator authority. Customer roles cannot be granted write access. Permission administration checks actor, target and firm/entity ownership rather than trusting submitted role fields. Firm-owner labels and user-management access are consistent. This does not introduce a new document approval queue or maker-checker workflow.
- **11 / 13 / 14 — accountant usability:** four-decimal unit-price display; shared Decimal-based line calculations for previews and server posting; precision-safe money formatting; safe account-name editing, explicit classification correction review and custom cash/bank purpose selection; payroll basic-salary and allowance footer totals.

The existing type/subtype model is retained for validated contra behaviour. A separate account-role/normal-balance/contra-of schema redesign is not part of this audited-fix release. Broader custom-account reclassification needs impact review rather than inference from account numbers.

## Verification

- `npm.cmd run lint`: TypeScript checks.
- `npm.cmd test`: 8 unit tests.
- `npm.cmd run test:integration`: isolated PostgreSQL migrations and accounting/security regressions; never uses the production `.env` database.
- `npm.cmd run build`: production compilation and route generation.
- `npm.cmd run test:web`: run after building; uses the same disposable PostgreSQL suite and a temporary local production server. Checks four-role portal accessibility, anonymous denial, unauthorised entity access and real server-action POSTs. A view-only accountant and customer cannot deactivate an account; an authorised firm owner can.

The temporary servers are stopped after tests. Temporary PostgreSQL diagnostic directories are retained. HTTP checks do not substitute for a human visual/accessibility pass or a production smoke test.

## Remaining release operations

1. Back up the intended production/staging database and inspect the actual deployed baseline. Preserve all existing security work when assembling the release.
2. Complete `SECURITY-DEPLOYMENT.md`, including rotation of the database password previously exposed in chat, required authentication migration 0013, encryption/mail configuration and real administrator access. No new accounting schema migration is required by this release.
3. Rehearse on staging. Review existing suspense/input-tax accounts in Chart of Accounts; make corrections only with a documented accounting review. Custom accounts and corrupted historical settlements must be investigated separately. Do not delete posted records or reverse only a settlement's GL entry while leaving its document allocation intact.
4. Resolve suspense and relevant reconciliation differences. If a classification is in an active closing sweep, reopen affected years newest-first, perform the reviewed correction and re-close in chronological order.
5. Push/deploy the reviewed release, verify all four roles and actual mail/MFA configuration, check financial tie-outs, and retain a rollback path. Do not represent local test success as proof that the live deployment is corrected.

Production record cleanup and posted-account corrections require exact current record identification and approval. The HTML's historical test identifiers are not reliable deletion targets. Deployment credentials and production access are not assumed to be available merely because they were connected in another assistant.
