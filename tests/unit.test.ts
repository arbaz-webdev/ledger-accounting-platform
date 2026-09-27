import test from "node:test";
import assert from "node:assert/strict";
import { parseCents, formatCents, sumCents } from "../src/lib/money";
import { toCsv } from "../src/lib/csv-export";
import { tokenHash, validatePassword, encryptSecret, decryptSecret, authenticator, totpStep } from "../src/lib/security";
import { fmtMoney, fmtUnitPrice } from "../src/lib/format";
import { calculateDocumentLine, previewDocumentLine } from "../src/lib/document-math";
import { allowsBankCategory, allowsBillCoding } from "../src/lib/account-policy";

test("document math and display preserve unit precision and round per line", () => {
  const line = calculateDocumentLine({ quantity: "3", unitPrice: "33.333", taxRate: "15" });
  assert.equal(line.net.toFixed(2), "100.00");
  assert.equal(line.tax.toFixed(2), "15.00");
  assert.equal(fmtUnitPrice("33.333"), "33.3330");
  assert.equal(fmtMoney("9999999999999999.99"), "9,999,999,999,999,999.99");
  assert.equal(fmtMoney("-1.005"), "(1.01)");
  assert.equal(calculateDocumentLine({ quantity: "1", unitPrice: "0.005" }).net.toFixed(2), "0.01");
  assert.throws(() => calculateDocumentLine({ quantity: "1", unitPrice: "0.00001" }));
  assert.equal(previewDocumentLine({ quantity: "-", unitPrice: "3" }).net.toFixed(2), "0.00");
});

test("ordinary coding excludes protected accounts and contra asset balances", () => {
  for (const subType of ["receivable", "payable", "inventory", "tax", "payroll", "suspense", "cash_and_bank"]) {
    assert.equal(allowsBankCategory({ type: "asset", subType, isActive: true }), false);
    assert.equal(allowsBillCoding({ type: "asset", subType, isActive: true }), false);
  }
  assert.equal(allowsBillCoding({ type: "asset", subType: "contra_asset", isActive: true }), false);
  assert.equal(allowsBillCoding({ type: "asset", subType: "fixed_asset", isActive: true }), true);
  assert.equal(allowsBankCategory({ type: "equity", subType: null, isActive: true }), false);
});

test("money retains precision beyond JavaScript safe integers", () => {
  assert.equal(formatCents(parseCents("9999999999999999.99")), "9999999999999999.99");
  assert.equal(sumCents([parseCents("0.10"), parseCents("0.20")]), 30n);
  assert.equal(formatCents(parseCents("-12.5")), "-12.50");
});
test("CSV neutralizes spreadsheet formulas and preserves quoted text", () => {
  const csv = toCsv(["Name"], [["=HYPERLINK(1)"], ["+cmd"], ["@SUM(1)"], ['a,"b"']]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes("'=HYPERLINK(1)"));
  assert.ok(csv.includes("'@SUM(1)"));
  assert.ok(csv.includes('"a,""b"""'));
});
test("password policy rejects short passwords and bcrypt truncation", () => {
  assert.throws(() => validatePassword("demo1234"));
  assert.throws(() => validatePassword("a".repeat(73)));
  assert.throws(() => validatePassword("é".repeat(37)));
  validatePassword("a long unique passphrase");
});
test("tokens are hashed, deterministic and distinct", () => {
  assert.equal(tokenHash("secret").length, 64);
  assert.equal(tokenHash("secret"), tokenHash("secret"));
  assert.notEqual(tokenHash("secret"), tokenHash("other"));
});
test("MFA secret encryption is randomized and authenticated", () => {
  process.env.AUTH_ENCRYPTION_KEY = "ab".repeat(32);
  const a = encryptSecret("JBSWY3DPEHPK3PXP"), b = encryptSecret("JBSWY3DPEHPK3PXP");
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a), "JBSWY3DPEHPK3PXP");
  const pieces = a.split(".");
  pieces[1] = Buffer.alloc(16).toString("base64url");
  assert.throws(() => decryptSecret(pieces.join(".")));
  delete process.env.AUTH_ENCRYPTION_KEY;
  assert.throws(() => encryptSecret("secret"));
});
test("authenticator codes allow bounded clock drift but reject invalid input", () => {
  const secret = "JBSWY3DPEHPK3PXP", now = 1800000000000;
  const code = authenticator(secret, "test@example.com").generate({ timestamp: now });
  assert.equal(totpStep(secret, code, now), Math.floor(now / 30000));
  assert.equal(totpStep(secret, "bad", now), null);
  assert.equal(totpStep(secret, code, now + 120000), null);
});
