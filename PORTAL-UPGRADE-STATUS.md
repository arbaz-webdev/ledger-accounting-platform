# Document implementation status

Sources: `SaaS Customer Portal Specification & Developer Guide (1).pdf` and `Req.pdf` in the user's Downloads folder. The PDFs are requirements, not instructions to operate credentials or external accounts.

## Implemented and verified in code

- Business owner dashboard, company settings, invoice and bill creation, posting and settlement, customer and supplier records, products and services, employee entry, transfers, bank deposits, expenses, other income receipts, and balanced manual journals. Existing staff and view-only roles remain read-only in the business portal.
- Financial statements, ageing, trial balance, journal, sales by customer and item, purchases by vendor, expenses by category, inventory valuation and movements, and bank reconciliation history. Portal tables have CSV export and printable views.
- Firm owner console, independent USD firm books, team administration, subscription arrangement recording and 30-day renewal reminder, cash flow and receivables, client activity, staff workload, and period close turnaround.
- Firm planning for linking an invoice customer to a client, staff hourly cost and weekly capacity, time entries, and monthly budget targets. Reports show estimated client contribution (firm invoice revenue less recorded staff time cost), staff utilization, and budget against posted firm book actuals. These figures populate as owners enter links, rates, time, and targets.
- Provider-free subscription management records fees and reminds owners; it does not create invoices automatically, as requested.
- Isolated PostgreSQL integration suite, role and tenant HTTP smoke, TypeScript check, production build, and migration rehearsal on a Neon copy of production passed on 2026-10-14.

## Still incomplete

- Payment unapplication and reallocation; voiding settled or stock-moving documents; full debit note workflow. These need a separate, audited subledger correction design and regression tests to preserve AR/AP, cash, and inventory tie-outs.
- Native PDF files for reports and credit notes, full inventory analytics beyond valuation/movements, invoice template customization, and business portal screens for deeper role administration, tax/FX settings, lock dates and security log. Printing from the browser can save current reports as PDF.
- Automated invoice email, Stripe and PayPal payment links, direct bank feeds, and off-site scheduled backups require service accounts, credentials, and a backup destination. Email templates and bank CSV import exist, but automatic sending and direct feeds are not active.
- Client contribution is an estimate. It omits indirect firm overhead, and firm subscription revenue appears in actuals only after a firm invoice is posted. The firm owner must supply client/customer links, staff cost/capacity, time entries, and budget targets for meaningful figures.
- Firm branding upload is available. Draft transparent logos for B&B Accounting Firm LLC and Meridian Accounting are in `assets/firm-logo-drafts/`, with upload-sized PNG copies. The owner needs to choose/approve a draft before it replaces either firm's live branding. The platform already has its own vector mark.

No pending external-service control is shown as an active feature. Ledger corrections should be added only after their accounting and audit behavior is fully verified.
