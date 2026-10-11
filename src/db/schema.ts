import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  bigint,
  date,
  numeric,
  char,
  jsonb,
  primaryKey,
  unique,
  customType,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", [
  "platform_admin",
  "firm_owner",
  "firm_admin",
  "accountant_staff",
  "business_admin",
  "business_staff",
  "view_only",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trial",
  "active",
  "past_due",
  "suspended",
  "cancelled",
]);

export const accountTypeEnum = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "revenue",
  "cogs",
  "expense",
  "other_income",
  "other_expense",
  "tax",
]);

export const jeStatusEnum = pgEnum("je_status", [
  "draft",
  "pending_approval",
  "posted",
  "voided",
]);

export const sourceModuleEnum = pgEnum("source_module", [
  "manual",
  "invoice",
  "bill",
  "payroll",
  "bank",
  "inventory",
  "system",
]);

// ---------------------------------------------------------------------------
// Tenancy & auth
// ---------------------------------------------------------------------------

export const firms = pgTable("firms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  fax: text("fax"),
  contactPerson: text("contact_person"),
  logoData: bytea("logo_data"),
  logoMime: text("logo_mime"),
  /** platform kill switch — false locks every user of the firm out */
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Phase 9 — Plans & subscriptions (the commercial layer above tenancy)
// ---------------------------------------------------------------------------

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  monthlyPrice: numeric("monthly_price", { precision: 18, scale: 2 }).notNull().default("0"),
  currency: char("currency", { length: 3 }).notNull().default("USD"),
  /** null = unlimited */
  maxEntities: integer("max_entities"),
  maxUsers: integer("max_users"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(100),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  firmId: uuid("firm_id")
    .notNull()
    .references(() => firms.id, { onDelete: "cascade" }),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id),
  status: subscriptionStatusEnum("status").notNull().default("trial"),
  startedOn: date("started_on").notNull(),
  trialEndsOn: date("trial_ends_on"),
  currentPeriodEnd: date("current_period_end"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  firmId: uuid("firm_id").references(() => firms.id),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull(),
  role: userRoleEnum("role").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const firmTeams = pgTable("firm_teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  firmId: uuid("firm_id").notNull().references(() => firms.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.firmId, t.id)]);

export const firmTeamMembers = pgTable("firm_team_members", {
  firmId: uuid("firm_id").notNull(),
  teamId: uuid("team_id").notNull(),
  userId: uuid("user_id").primaryKey(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

export const entities = pgTable("entities", {
  id: uuid("id").primaryKey().defaultRandom(),
  firmId: uuid("firm_id")
    .notNull()
    .references(() => firms.id),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  baseCurrency: char("base_currency", { length: 3 }).notNull().default("USD"),
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  isFirmBooks: boolean("is_firm_books").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const businessSettings = pgTable("business_settings", {
  entityId: uuid("entity_id").primaryKey().references(() => entities.id, { onDelete: "cascade" }),
  legalStructure: text("legal_structure"),
  taxIdentifiers: text("tax_identifiers"),
  registeredAddress: text("registered_address"),
  brandAccent: char("brand_accent", { length: 7 }).notNull().default("#0d9488"),
  invoiceHeader: text("invoice_header"),
  invoicePrefix: text("invoice_prefix").notNull().default("INV"),
  billPrefix: text("bill_prefix").notNull().default("BILL"),
  invoiceTerms: text("invoice_terms"),
  defaultTaxRate: numeric("default_tax_rate", { precision: 9, scale: 4 }).notNull().default("0"),
  invoiceEmailTemplate: text("invoice_email_template"),
  reminderEmailTemplate: text("reminder_email_template"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clientSubscriptionManagement = pgTable("client_subscription_management", {
  entityId: uuid("entity_id").primaryKey().references(() => entities.id, { onDelete: "cascade" }),
  managedBy: text("managed_by").notNull().default("client"),
  monthlyFee: numeric("monthly_fee", { precision: 18, scale: 2 }).notNull().default("0"),
  currency: char("currency", { length: 3 }).notNull().default("USD"),
  renewalOn: date("renewal_on"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userEntityAccess = pgTable(
  "user_entity_access",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    modulePermissions: jsonb("module_permissions").notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.userId, t.entityId] })]
);

export const sessions = pgTable("sessions", {
  token: text("token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Chart of Accounts
// ---------------------------------------------------------------------------

export const chartOfAccounts = pgTable(
  "chart_of_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    accountNumber: text("account_number").notNull(),
    name: text("name").notNull(),
    type: accountTypeEnum("type").notNull(),
    subType: text("sub_type"),
    parentId: uuid("parent_id"),
    currency: char("currency", { length: 3 }),
    taxCode: text("tax_code"),
    isActive: boolean("is_active").notNull().default(true),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.entityId, t.accountNumber)]
);

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export const periods = pgTable(
  "periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    isLocked: boolean("is_locked").notNull().default(false),
    lockedBy: uuid("locked_by").references(() => users.id),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
  },
  (t) => [unique().on(t.entityId, t.year, t.month)]
);

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    jeNumber: bigint("je_number", { mode: "number" }),
    date: date("date").notNull(),
    reference: text("reference"),
    description: text("description").notNull(),
    sourceModule: sourceModuleEnum("source_module").notNull().default("manual"),
    status: jeStatusEnum("status").notNull().default("draft"),
    voidedByJeId: uuid("voided_by_je_id"),
    reversesJeId: uuid("reverses_je_id"),
    autoReverseOn: date("auto_reverse_on"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    postedBy: uuid("posted_by").references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }),
  },
  (t) => [unique().on(t.entityId, t.jeNumber)]
);

export const journalEntryLines = pgTable(
  "journal_entry_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jeId: uuid("je_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => chartOfAccounts.id),
    description: text("description"),
    currency: char("currency", { length: 3 }).notNull(),
    fxRate: numeric("fx_rate", { precision: 18, scale: 8 }).notNull().default("1"),
    debit: numeric("debit", { precision: 18, scale: 2 }).notNull().default("0"),
    credit: numeric("credit", { precision: 18, scale: 2 }).notNull().default("0"),
    debitBase: numeric("debit_base", { precision: 18, scale: 2 }).notNull().default("0"),
    creditBase: numeric("credit_base", { precision: 18, scale: 2 }).notNull().default("0"),
  },
  (t) => [unique().on(t.jeId, t.lineNo)]
);

export const jeCounters = pgTable("je_counters", {
  entityId: uuid("entity_id")
    .primaryKey()
    .references(() => entities.id),
  nextNumber: bigint("next_number", { mode: "number" }).notNull().default(1),
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const auditLog = pgTable("audit_log", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  entityId: uuid("entity_id").references(() => entities.id),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(),
  tableName: text("table_name"),
  recordId: text("record_id"),
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Phase 3 — Accounts Receivable / Accounts Payable
// ---------------------------------------------------------------------------

export const contactTypeEnum = pgEnum("contact_type", ["customer", "supplier"]);
export const documentStatusEnum = pgEnum("document_status", ["draft", "posted", "paid", "void"]);
export const settlementKindEnum = pgEnum("settlement_kind", [
  "payment",
  "credit_note",
  "write_off",
]);

export const accountMappings = pgTable(
  "account_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    module: text("module").notNull(),
    key: text("key").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => chartOfAccounts.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.entityId, t.module, t.key)]
);

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityId: uuid("entity_id")
    .notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  type: contactTypeEnum("type").notNull(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  paymentTermsDays: integer("payment_terms_days").notNull().default(30),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentCounters = pgTable(
  "document_counters",
  {
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    docType: text("doc_type").notNull(),
    nextNumber: bigint("next_number", { mode: "number" }).notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.docType] })]
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => contacts.id),
    invoiceNumber: text("invoice_number").notNull(),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date").notNull(),
    status: documentStatusEnum("status").notNull().default("draft"),
    notes: text("notes"),
    purchaseOrderReference: text("purchase_order_reference"),
    currency: char("currency", { length: 3 }).notNull(),
    fxRate: numeric("fx_rate", { precision: 18, scale: 8 }).notNull().default("1"),
    subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull().default("0"),
    taxTotal: numeric("tax_total", { precision: 18, scale: 2 }).notNull().default("0"),
    total: numeric("total", { precision: 18, scale: 2 }).notNull().default("0"),
    jeId: uuid("je_id").references(() => journalEntries.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
  },
  (t) => [unique().on(t.entityId, t.invoiceNumber)]
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull().default("1"),
    unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).notNull().default("0"),
    revenueAccountId: uuid("revenue_account_id")
      .notNull()
      .references(() => chartOfAccounts.id),
    taxRate: numeric("tax_rate", { precision: 9, scale: 4 }).notNull().default("0"),
    netAmount: numeric("net_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    taxAmount: numeric("tax_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    itemId: uuid("item_id").references(() => inventoryItems.id),
  },
  (t) => [unique().on(t.invoiceId, t.lineNo)]
);

export const bills = pgTable(
  "bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => contacts.id),
    billNumber: text("bill_number").notNull(),
    supplierReference: text("supplier_reference"),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date").notNull(),
    status: documentStatusEnum("status").notNull().default("draft"),
    notes: text("notes"),
    currency: char("currency", { length: 3 }).notNull(),
    fxRate: numeric("fx_rate", { precision: 18, scale: 8 }).notNull().default("1"),
    subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull().default("0"),
    taxTotal: numeric("tax_total", { precision: 18, scale: 2 }).notNull().default("0"),
    total: numeric("total", { precision: 18, scale: 2 }).notNull().default("0"),
    jeId: uuid("je_id").references(() => journalEntries.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
  },
  (t) => [unique().on(t.entityId, t.billNumber)]
);

export const billLines = pgTable(
  "bill_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    billId: uuid("bill_id")
      .notNull()
      .references(() => bills.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull().default("1"),
    unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).notNull().default("0"),
    expenseAccountId: uuid("expense_account_id")
      .notNull()
      .references(() => chartOfAccounts.id),
    taxRate: numeric("tax_rate", { precision: 9, scale: 4 }).notNull().default("0"),
    netAmount: numeric("net_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    taxAmount: numeric("tax_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    itemId: uuid("item_id").references(() => inventoryItems.id),
  },
  (t) => [unique().on(t.billId, t.lineNo)]
);

export const settlements = pgTable("settlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityId: uuid("entity_id")
    .notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  kind: settlementKindEnum("kind").notNull(),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "cascade" }),
  billId: uuid("bill_id").references(() => bills.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  bankAccountId: uuid("bank_account_id").references(() => chartOfAccounts.id),
  reference: text("reference"),
  fxRate: numeric("fx_rate", { precision: 18, scale: 8 }).notNull().default("1"),
  fxDifference: numeric("fx_difference", { precision: 18, scale: 2 }).notNull().default("0"),
  jeId: uuid("je_id").references(() => journalEntries.id),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Phase 4 — Bank import & reconciliation
// ---------------------------------------------------------------------------

export const ruleMatchEnum = pgEnum("rule_match", ["contains", "starts_with", "equals"]);
export const ruleDirectionEnum = pgEnum("rule_direction", ["any", "money_in", "money_out"]);
export const bankTxnStatusEnum = pgEnum("bank_txn_status", [
  "pending",
  "categorised",
  "posted",
  "ignored",
]);

export const bankRules = pgTable("bank_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityId: uuid("entity_id")
    .notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  priority: integer("priority").notNull().default(100),
  matchType: ruleMatchEnum("match_type").notNull().default("contains"),
  matchText: text("match_text").notNull(),
  direction: ruleDirectionEnum("direction").notNull().default("any"),
  accountId: uuid("account_id")
    .notNull()
    .references(() => chartOfAccounts.id),
  isActive: boolean("is_active").notNull().default(true),
  timesApplied: integer("times_applied").notNull().default(0),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bankReconciliations = pgTable("bank_reconciliations", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityId: uuid("entity_id")
    .notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id")
    .notNull()
    .references(() => chartOfAccounts.id),
  statementDate: date("statement_date").notNull(),
  statementBalance: numeric("statement_balance", { precision: 18, scale: 2 }).notNull(),
  bookBalance: numeric("book_balance", { precision: 18, scale: 2 }).notNull(),
  clearedTotal: numeric("cleared_total", { precision: 18, scale: 2 }).notNull().default("0"),
  isLocked: boolean("is_locked").notNull().default(true),
  approvedBy: uuid("approved_by")
    .notNull()
    .references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bankImportBatches = pgTable("bank_import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityId: uuid("entity_id")
    .notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id")
    .notNull()
    .references(() => chartOfAccounts.id),
  filename: text("filename").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  importedCount: integer("imported_count").notNull().default(0),
  duplicateCount: integer("duplicate_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bankImportTemplates = pgTable(
  "bank_import_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dateColumn: text("date_column").notNull(),
    descriptionColumn: text("description_column").notNull(),
    amountColumn: text("amount_column"),
    debitColumn: text("debit_column"),
    creditColumn: text("credit_column"),
    balanceColumn: text("balance_column"),
    dateFormat: text("date_format").notNull().default("auto"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.entityId, t.name)]
);

// ---------------------------------------------------------------------------
// Phase 8 — Multi-currency
// ---------------------------------------------------------------------------

export const fxRates = pgTable(
  "fx_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    currency: char("currency", { length: 3 }).notNull(),
    asOfDate: date("as_of_date").notNull(),
    /** units of BASE currency per 1 unit of `currency` */
    rate: numeric("rate", { precision: 18, scale: 8 }).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.entityId, t.currency, t.asOfDate)]
);

// ---------------------------------------------------------------------------
// Phase 7 — Year-end close
// ---------------------------------------------------------------------------

export const fiscalYearCloses = pgTable("fiscal_year_closes", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityId: uuid("entity_id")
    .notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  netProfit: numeric("net_profit", { precision: 18, scale: 2 }).notNull(),
  jeId: uuid("je_id").references(() => journalEntries.id),
  closedBy: uuid("closed_by")
    .notNull()
    .references(() => users.id),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  reopenedBy: uuid("reopened_by").references(() => users.id),
});

// ---------------------------------------------------------------------------
// Phase 6 — Inventory
// ---------------------------------------------------------------------------

export const costingMethodEnum = pgEnum("costing_method", ["fifo", "avco", "specific"]);
export const inventoryMovementKindEnum = pgEnum("inventory_movement_kind", [
  "receipt",
  "issue",
  "adjust_in",
  "adjust_out",
  "write_down",
]);

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    costingMethod: costingMethodEnum("costing_method").notNull().default("fifo"),
    unit: text("unit").notNull().default("unit"),
    salesPrice: numeric("sales_price", { precision: 18, scale: 4 }).notNull().default("0"),
    isService: boolean("is_service").notNull().default(false),
    reorderLevel: numeric("reorder_level", { precision: 18, scale: 4 }).notNull().default("0"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.entityId, t.sku)]
);

export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityId: uuid("entity_id")
    .notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  itemId: uuid("item_id")
    .notNull()
    .references(() => inventoryItems.id),
  kind: inventoryMovementKindEnum("kind").notNull(),
  date: date("date").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  totalCost: numeric("total_cost", { precision: 18, scale: 2 }).notNull(),
  jeId: uuid("je_id")
    .notNull()
    .references(() => journalEntries.id),
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  billId: uuid("bill_id").references(() => bills.id),
  reference: text("reference"),
  notes: text("notes"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryLots = pgTable("inventory_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityId: uuid("entity_id")
    .notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  itemId: uuid("item_id")
    .notNull()
    .references(() => inventoryItems.id),
  lotRef: text("lot_ref"),
  receivedDate: date("received_date").notNull(),
  qtyReceived: numeric("qty_received", { precision: 18, scale: 4 }).notNull(),
  qtyRemaining: numeric("qty_remaining", { precision: 18, scale: 4 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 18, scale: 6 }).notNull(),
  costRemaining: numeric("cost_remaining", { precision: 18, scale: 2 }).notNull(),
  sourceMovementId: uuid("source_movement_id")
    .notNull()
    .references(() => inventoryMovements.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryMovementLots = pgTable("inventory_movement_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  movementId: uuid("movement_id")
    .notNull()
    .references(() => inventoryMovements.id, { onDelete: "cascade" }),
  lotId: uuid("lot_id")
    .notNull()
    .references(() => inventoryLots.id),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  cost: numeric("cost", { precision: 18, scale: 2 }).notNull(),
});

// ---------------------------------------------------------------------------
// Phase 5 — Payroll
// ---------------------------------------------------------------------------

export const payrollFrequencyEnum = pgEnum("payroll_frequency", [
  "monthly",
  "biweekly",
  "weekly",
]);
export const payRunStatusEnum = pgEnum("pay_run_status", ["draft", "posted", "paid"]);

export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    employeeNumber: text("employee_number").notNull(),
    fullName: text("full_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    hireDate: date("hire_date").notNull(),
    terminationDate: date("termination_date"),
    isActive: boolean("is_active").notNull().default(true),
    payFrequency: payrollFrequencyEnum("pay_frequency").notNull().default("monthly"),
    basicSalary: numeric("basic_salary", { precision: 18, scale: 2 }).notNull().default("0"),
    allowances: numeric("allowances", { precision: 18, scale: 2 }).notNull().default("0"),
    incomeTaxRate: numeric("income_tax_rate", { precision: 9, scale: 4 }).notNull().default("0"),
    eobiEmployeeAmount: numeric("eobi_employee_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    eobiEmployerAmount: numeric("eobi_employer_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    payrollTaxEmployerRate: numeric("payroll_tax_employer_rate", { precision: 9, scale: 4 })
      .notNull()
      .default("0"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.entityId, t.employeeNumber)]
);

export const payRuns = pgTable(
  "pay_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    runNumber: text("run_number").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    payDate: date("pay_date").notNull(),
    status: payRunStatusEnum("status").notNull().default("draft"),
    grossTotal: numeric("gross_total", { precision: 18, scale: 2 }).notNull().default("0"),
    incomeTaxTotal: numeric("income_tax_total", { precision: 18, scale: 2 }).notNull().default("0"),
    eobiEmployeeTotal: numeric("eobi_employee_total", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    eobiEmployerTotal: numeric("eobi_employer_total", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    payrollTaxEmployerTotal: numeric("payroll_tax_employer_total", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    netTotal: numeric("net_total", { precision: 18, scale: 2 }).notNull().default("0"),
    jeId: uuid("je_id").references(() => journalEntries.id),
    paymentJeId: uuid("payment_je_id").references(() => journalEntries.id),
    bankAccountId: uuid("bank_account_id").references(() => chartOfAccounts.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [unique().on(t.entityId, t.runNumber)]
);

export const payRunLines = pgTable(
  "pay_run_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payRunId: uuid("pay_run_id")
      .notNull()
      .references(() => payRuns.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    basicSalary: numeric("basic_salary", { precision: 18, scale: 2 }).notNull().default("0"),
    allowances: numeric("allowances", { precision: 18, scale: 2 }).notNull().default("0"),
    grossPay: numeric("gross_pay", { precision: 18, scale: 2 }).notNull().default("0"),
    incomeTaxAmount: numeric("income_tax_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    eobiEmployeeAmount: numeric("eobi_employee_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    eobiEmployerAmount: numeric("eobi_employer_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    payrollTaxEmployerAmount: numeric("payroll_tax_employer_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    netPay: numeric("net_pay", { precision: 18, scale: 2 }).notNull().default("0"),
  },
  (t) => [unique().on(t.payRunId, t.employeeId)]
);

export const bankTransactions = pgTable("bank_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityId: uuid("entity_id")
    .notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  batchId: uuid("batch_id").references(() => bankImportBatches.id, { onDelete: "set null" }),
  bankAccountId: uuid("bank_account_id")
    .notNull()
    .references(() => chartOfAccounts.id),
  txnDate: date("txn_date").notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  statementBalance: numeric("statement_balance", { precision: 18, scale: 2 }),
  status: bankTxnStatusEnum("status").notNull().default("pending"),
  categoryAccountId: uuid("category_account_id").references(() => chartOfAccounts.id),
  matchedRuleId: uuid("matched_rule_id").references(() => bankRules.id, { onDelete: "set null" }),
  dedupeHash: text("dedupe_hash").notNull(),
  possibleDuplicate: boolean("possible_duplicate").notNull().default(false),
  jeId: uuid("je_id").references(() => journalEntries.id),
  reconciliationId: uuid("reconciliation_id").references(() => bankReconciliations.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authRateLimits = pgTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull().default(1),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
});
export const userSecurity = pgTable("user_security", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  mfaSecret: text("mfa_secret"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  lastTotpStep: bigint("last_totp_step", { mode: "number" }).notNull().default(-1),
});
export const passwordResetTokens = pgTable("password_reset_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
