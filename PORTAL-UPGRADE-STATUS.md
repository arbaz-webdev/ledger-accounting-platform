# SaaS customer portal release status

Source: `C:\Users\ARBAZ\Downloads\SaaS Customer Portal Specification & Developer Guide (1).pdf`

## Verified for this release

- Owner dashboard with revenue and cost trend, expense breakdown, cash balance, inventory valuation, reorder alerts and fast moving items. Dashboard data refreshes every 30 seconds.
- Owner invoice and bill drafting, posting, settlement, credit recording, and overdue invoice bad debt write-off. Posted open documents without stock movements can be voided by an audited reversing journal entry; nonfinancial due dates, notes and references can be corrected.
- Customer and supplier creation, plus a product and service catalog. Service invoice lines do not consume stock.
- Linked printable credit note view. Business staff and view-only users remain read-only. Platform operators cannot access tenant books.
- Reports hub: financial statements, AR/AP ageing, trial balance, journal, sales by customer, purchases by supplier, expenses by category, and inventory valuation, with CSV export where listed.
- Owner company settings: profile, legal and tax details, address, fiscal start month, brand color, invoice header and terms, document prefixes, default tax rate, and saved email templates.
- Production build, TypeScript check, and 26 isolated database and HTTP checks pass.

## Still required to meet the full PDF

- Posting forms for transfers, deposits, expenses, receipts, manual journals and debit notes in the business portal; employee creation.
- Payment unapplication and reallocation, plus voiding documents that already have settlements or stock movements.
- Full inventory analytics, PDF exports for reports and native credit note PDFs, additional comparative and bank reports, complete invoice template/branding support.
- Automated invoice email, Stripe and PayPal payment links, bank feeds, and off-site backups. These need external provider accounts and credentials.
- Deeper role administration, tax/FX settings, lock dates, and security log surfaced in the business portal.

Pending flows are not exposed as active controls. Any future ledger correction must be audited and regression tested before release.
