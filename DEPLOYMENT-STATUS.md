# Deployment status — 28 September 2026

- Browser login verified for Neon and Vercel.
- Neon project: `square-morning-83315901` (Accounting Software).
- Production branch: `br-flat-meadow-aypnv8d5`.
- Production endpoint verified: `ep-weathered-dream-aywhribb`.
- Pre-release recovery branch created: `pre-audit-release-2026-09-28`, ID `br-purple-union-ayxrhjnv`, from production at LSN `0/2244D98`. No compute provisioned. Preserve this branch unchanged; provision compute if recovery inspection is needed.
- Production migration ledger remains at 0012. Migration 0013 has not been applied.
- Vercel project: `ledger-accounting-platform`, under `hearbaz-7841s-projects`.
- Vercel environment-variable UI lists only DATABASE_URL (Production and Development). AUTH_ENCRYPTION_KEY, APP_URL, RESEND_API_KEY and AUTH_EMAIL_FROM are absent.
- New authentication credentials must be entered by the user during browser handoff. The exposed database password also needs rotation with matching DATABASE_URL updates before release.
- No Git commit/push, app deployment, historical correction or production accounting mutation performed.

## Continuation verification — 28 September 2026

- GitHub main and Vercel's latest ready production deployment both remain at `6ea853fb28412a01433bdd0274a34555a713ce61`.
- Reconnected to the authenticated in-app Vercel browser. Environment variables still contain only DATABASE_URL; the Production entry was last updated July 27. Secret rotation and encryption-key setup are not confirmed.
- Neon connector access works. Vercel connector still returns 403; authenticated browser access works.
- Created a separate production-derived rehearsal branch: `audit-release-rehearsal-2026-09-28`, ID `br-aged-lab-ay83852m`, parent LSN `0/2269750`.
- Applied the exact migration 0013 DDL and its `_migrations` record transactionally on the rehearsal branch. Verified column types/defaults, primary keys, user foreign keys, and password-reset expiry index. No production schema or accounting records changed.
- Retained both the recovery and rehearsal branches. Recovery branch remains unchanged.
- Re-ran successfully: 8 unit tests, TypeScript checks, production build, and 23 database/web tests including four-role HTTP smoke and actual unauthorized server-action POST checks. Tests used disposable local PostgreSQL.
- Assembled the local release commit with the preserved accounting and security implementation. Push and production migration remain pending credential handoff. Local skill artifacts and .env are excluded from Git; staged credential-pattern scan returned no matches.

Next: user completes the credential handoff (rotate Neon production password, update matching Vercel Production DATABASE_URL and local .env, and save AUTH_ENCRYPTION_KEY). Verify database access, apply the rehearsed production migration, push/deploy, verify the exact deployed commit, and run authenticated live smoke checks. Configure APP_URL and provider/sender settings for recovery email; do not claim delivery without an actual delivery test. Historical corrections remain review-only.
