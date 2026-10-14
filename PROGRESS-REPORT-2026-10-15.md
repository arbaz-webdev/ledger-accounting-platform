# Ledger Accounting Platform progress report

- **Date:** 15 October 2026
- **Sources:** `SaaS Customer Portal Specification & Developer Guide (1).pdf` and `Req.pdf`
- **Live site:** https://ledger-accounting-platform.vercel.app/login
- **GitHub:** https://github.com/arbaz-webdev/ledger-accounting-platform
- **Latest verified code commit:** `8b2a466`

## Overall position

The latest verified features are on the live site and GitHub. The two documents are **not fully complete**. Some accounting correction workflows and advanced exports still need development. External integrations need provider accounts that are not yet available.

## Completed and available

| Area | Delivered |
| --- | --- |
| Business owner portal | Dashboard; business profile, tax default and foreign exchange rates; customer and supplier contacts; product and service catalog; employees; invoices and bills; payments, credits and bad debt write-offs; bank transfers, deposits, expenses, other income receipts and balanced manual journals; activity log. |
| Business reports | Profit and loss, balance sheet, cash flow, AR/AP ageing, trial balance, journal, sales by customer and item, purchases by supplier, expenses by category, inventory valuation and movements, and bank reconciliation history. Tables offer CSV and browser printing, including Save as PDF. |
| Firm owner module | Separate USD books for B&B Accounting Firm LLC and Meridian Accounting; firm dashboard, team and client administration, firm financial and activity reports, subscription fee recording, and 30-day renewal reminders. Firm-managed subscriptions record and remind; they do not create monthly invoices automatically, as requested. |
| Firm planning | Link a client to a customer in the firm's own books; enter staff hourly cost and weekly capacity; record client work time; set monthly revenue and expense targets. Reports calculate estimated client contribution, utilization, and budget against posted actuals. |
| Branding drafts | Transparent draft logos and upload-sized PNGs for both firms are saved in `assets/firm-logo-drafts/`. They have not been installed as live firm branding. |
| Security and access | Business staff and view-only users stay read-only. Firm and client data have tenant checks and audit records. The new business activity screen is scoped to one business. |

## Not yet implemented

| Item | Current position | Needs user input? |
| --- | --- | --- |
| Unapply or reallocate a payment | No live control. Requires balanced cash and AR/AP correction entries plus regression tests. | No account needed; accounting design and development remain. |
| Void a document after payment or stock movement | No live control. Reversal must preserve the cash, AR/AP and inventory subledgers. | No account needed; accounting design and development remain. |
| Full debit note workflow | Not built. Existing supplier credits and customer credit notes are available. | **Yes:** clarify which debit note meaning is required. |
| Native downloadable PDF reports and credit notes | Browser print/Save as PDF works; a dedicated PDF download is not built. | No. |
| Advanced inventory analytics and invoice template customization | Basic valuation, movement and branded settings exist; the full requested depth is outstanding. | Details or examples would help, but are not mandatory to start. |
| Deeper business role controls and lock-date screen | Existing firm permissions and period controls work; owner-facing controls remain limited. | No. |

## External setup still needed

| Feature | Please provide when ready |
| --- | --- |
| Stripe and PayPal payment links | Active provider accounts and approved credentials. |
| Automated invoice and reminder emails | An email sending service and a verified sender address/domain. Templates can already be saved. |
| Direct bank feeds | Bank/provider connection access. CSV bank import already works. |
| Scheduled off-site backups | A destination account and credentials. The database provider's existing recovery facilities are separate from an independent off-site copy. |

## Business information needed to populate the new reports

For each firm, link each client to the corresponding customer in the firm's books; enter staff hourly costs and weekly capacity; record time; and enter monthly budget targets. Client contribution is **an estimate** of linked firm invoice revenue less recorded staff time cost. It excludes indirect overhead. Actual subscription revenue appears in the firm books only when the firm posts an invoice.

## Decisions to confirm

1. Should either draft logo be installed for its firm, or should it be revised first?
2. Does “debit note” mean an additional charge to a customer, a reduction of a supplier bill, or both?

## Verification

- Production database migration `0016_firm_planning.sql` was rehearsed on a Neon branch and applied to the live branch.
- The latest code passed TypeScript checks, a production build, 8 unit tests, and 30 isolated database and portal HTTP checks on 14 October 2026.
- The production deployment was marked Ready; the live login page returned HTTP 200 on 15 October 2026.
- GitHub `main` and the local release checkout both resolved to `8b2a466` before this report was written.
