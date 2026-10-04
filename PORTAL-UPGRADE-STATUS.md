# SaaS customer portal upgrade status

Source: `C:\Users\ARBAZ\Downloads\SaaS Customer Portal Specification & Developer Guide (1).pdf`

## Implemented in this branch

- Business dashboard with recent revenue and cost trend, major expenses, cash and bank balance.
- Business navigation for posting, adding contacts, documents, and reports.
- Business owner invoice and bill drafting, posting, payment or credit recording, and invoice bad debt write-offs. Existing posting services create journal entries and audit records.
- Customer and supplier creation; owner write permission is limited to sales and purchases. Business staff and view-only roles remain read-only.
- Reports hub with profit and loss, balance sheet, cash flow, AR and AP ageing, plus CSV exports.
- Platform users cannot enter tenant books; the old support entry point has been removed.
- Production build, 8 unit tests, and 23 isolated database and HTTP checks pass.

## Remaining PDF scope

- Post Transaction options for debit notes, transfers, deposits, expenses, manual journals, and other receipt flows.
- Add New options for employees, products, and services.
- Posted invoice or bill void with reversing journal entries and dependent stock or settlement handling.
- Payment unapplication, reallocation, and safe metadata corrections.
- Posted document nonfinancial edits and linked credit note documents or PDFs.
- Inventory status dashboard panel, wider report catalog, and settings or granular role controls.

These items need their own ledger rules, audit coverage, permission checks, and regression tests before production deployment.
