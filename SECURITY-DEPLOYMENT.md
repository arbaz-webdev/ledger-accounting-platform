# Security deployment checklist

The hardening changes are local until deployed. Do not deploy the new login code
before applying migration 0013: it needs the new authentication tables.

## Required hosting configuration

1. In Neon, reset the database-role password previously shared in chat.
   Update DATABASE_URL in Vercel and your local .env without committing it.
   Prefer the pooled production URL and verified TLS. Redeploy after changing it.
2. Apply migrations to the intended production database with npm run db:migrate.
   The runner applies each migration transactionally; back up the database first.
3. Generate a 32-byte encryption key locally:
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   Set AUTH_ENCRYPTION_KEY in Vercel. Keep it private, back it up securely,
   and do not replace it without re-encrypting existing MFA secrets.
4. For password recovery, set APP_URL to your canonical HTTPS deployment URL,
   RESEND_API_KEY to your Resend key, and AUTH_EMAIL_FROM to a verified sender.
   Missing mail configuration intentionally sends no recovery email and never
   reveals whether an account exists. Test actual email delivery after deployment.
5. Deploy, then open /security to change passwords and enroll an authenticator.
   MFA setup uses a copyable manual key and a confirmation code. Keep the
   authenticator's own backup secure: self-service recovery does not bypass MFA.
   Lost authenticators currently require an administrator-assisted recovery process.
6. Before sharing the site, create and test a real platform owner account with
   a real email address and a unique password. Retire the seeded demo accounts:
   Set PLATFORM_OWNER_EMAIL, PLATFORM_OWNER_NAME and PLATFORM_OWNER_PASSWORD
   privately in your local process environment, then run
   node scripts/create-platform-owner.mjs
   Clear the password environment variable immediately afterward.
   Test that account before running the retirement command:
   node scripts/retire-demo.mjs --confirm
   This deactivates @demo.test accounts, randomizes passwords and revokes sessions,
   but preserves accounting and audit records. It refuses to run without another
   active non-demo platform owner. Do not share credentials through source code.

## Verification

- npm test: pure money, export and authentication-security tests.
- npm run test:integration: provisions a separate local PostgreSQL cluster in a
  temporary directory, applies all migrations and exercises the real services.
  It never loads .env or uses the production database. Clusters are stopped,
  with files retained for diagnosis; tests are not browser end-to-end tests.
- npm run build: production compilation and route generation.
- npm audit: dependency advisory check; not a guarantee that the app is secure.
- After deployment: verify login/logout, MFA, real recovery email delivery,
  each role's portal and suspended-firm actions/exports.

Authentication is throttled per account and, on Vercel, trusted client IP.
Eight attempts per account per 15 minutes are allowed. MFA codes cannot be
reused after successful verification. Reset links are hashed, expire after
30 minutes and are single-use; resetting revokes all sessions.

Subscription checks cover every authenticated role guard. Expired trials,
suspended/cancelled subscriptions and inactive firms deny access. Archived
clients deny normal users; platform owners retain support access. Capacity
checks and mutations share a transaction and serialize on the firm's row.
Accounting mutations now also commit their audit records transactionally.
Payroll payments, settlements and bank posting pass the caller's transaction
to the journal engine; posting locks prevent competing requests from duplicating
the same document. Fiscal-year reopening commits its period unlock and reversal
together. The local tests exercise these concurrency and failure paths.

MFA is opt-in, not mandated across the installation. Email address verification,
automated billing and a full browser regression suite are not part of this patch.
