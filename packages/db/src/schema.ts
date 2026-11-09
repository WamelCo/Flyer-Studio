/**
 * The whole database in one schema: Better Auth's tables (user, session, account,
 * verification) and the app's. Plain Postgres — no vendor extensions, roles or RLS:
 * every query is scoped to the signed-in user in application code.
 *
 * Credits change ONLY through the SQL functions in the migrations (deduct_credits,
 * add_credits, fulfil_payment) — see src/credits.ts. After editing this file run
 * `pnpm db:generate` to write the next migration.
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const tz = { withTimezone: true } as const;
const createdAt = () => timestamp("created_at", tz).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", tz).notNull().defaultNow();

export const planTier = pgEnum("plan_tier", ["free", "pro", "max"]);
export const billingInterval = pgEnum("billing_interval", ["month", "year"]);

export const FLYER_FORMATS = ["poster", "square", "story", "landscape"] as const;
export const EXPORT_FORMATS = ["png", "pdf", "png-2k", "png-4k", "psd", "svg"] as const;
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

// ── Better Auth ──────────────────────────────────────────────────────────────
// Field names are Better Auth's (camelCase in code, snake_case columns). Ids are UUIDs
// so the app tables can reference them.

export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /** E.164, e.g. +263771234567 — set when the person verifies a WhatsApp code. */
  phoneNumber: text("phone_number").unique(),
  phoneNumberVerified: boolean("phone_number_verified").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", tz),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", tz),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", tz).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ── Profiles & credits ───────────────────────────────────────────────────────

/** One per user, created by the `user` insert trigger with 0 credits on Free. */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    email: text("email").notNull().default(""),
    plan: planTier("plan").notNull().default("free"),
    credits: integer("credits").notNull().default(0),
    /** Free (watermarked, engine-only) flyers left — 3 for every new WhatsApp number. */
    freeFlyers: integer("free_flyers").notNull().default(0),
    billingInterval: billingInterval("billing_interval"),
    /** End of the current Pro/Max pass; the plan lapses to free after it. */
    currentPeriodEnd: timestamp("current_period_end", tz),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("credits_non_negative", sql`${t.credits} >= 0`), check("free_flyers_non_negative", sql`${t.freeFlyers} >= 0`)],
);

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    reason: text("reason").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [index("credit_ledger_user_created_idx").on(t.userId, t.createdAt.desc())],
);

// ── Projects, generation, exports ────────────────────────────────────────────

export const flyerProjects = pgTable(
  "flyer_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Untitled flyer"),
    format: text("format").notNull(),
    canvas: jsonb("canvas").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    generationId: uuid("generation_id").references((): AnyPgColumn => generationJobs.id, { onDelete: "set null" }),
    revision: integer("revision").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("flyer_projects_user_updated_idx").on(t.userId, t.updatedAt.desc()),
    check("flyer_projects_title_check", sql`char_length(${t.title}) between 1 and 120`),
    check("flyer_projects_format_check", sql`${t.format} in (${inList(FLYER_FORMATS)})`),
  ],
);

export const generationJobs = pgTable(
  "generation_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    intent: text("intent").notNull(),
    format: text("format").notNull(),
    /** web | whatsapp — where the request came from. */
    channel: text("channel").notNull().default("web"),
    /** pending → running → succeeded | failed */
    status: text("status").notNull().default("pending"),
    stage: text("stage"),
    variations: jsonb("variations").notNull().default([]),
    result: jsonb("result"),
    projectId: uuid("project_id").references(() => flyerProjects.id, { onDelete: "set null" }),
    creditsSpent: integer("credits_spent").notNull().default(0),
    /** Paid with a free flyer (returned if the job fails). */
    freeFlyer: boolean("free_flyer").notNull().default(false),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", tz),
    heartbeatAt: timestamp("heartbeat_at", tz),
    completedAt: timestamp("completed_at", tz),
  },
  (t) => [
    index("generation_jobs_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("generation_jobs_active_idx").on(t.heartbeatAt).where(sql`${t.status} in ('pending', 'running')`),
    check("generation_jobs_prompt_check", sql`char_length(${t.prompt}) between 1 and 500`),
    check("generation_jobs_intent_check", sql`${t.intent} in ('event', 'sale', 'real_estate', 'party')`),
    check("generation_jobs_format_check", sql`${t.format} in (${inList(FLYER_FORMATS)})`),
    check("generation_jobs_channel_check", sql`${t.channel} in ('web', 'whatsapp')`),
    check("generation_jobs_status_check", sql`${t.status} in ('pending', 'running', 'succeeded', 'failed')`),
  ],
);

export const aiGenerationLogs = pgTable("ai_generation_logs", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid("user_id").references(() => profiles.id, { onDelete: "set null" }),
  jobId: uuid("job_id").references(() => generationJobs.id, { onDelete: "set null" }),
  prompt: text("prompt"),
  errorCode: text("error_code").notNull(),
  message: text("message"),
  details: jsonb("details"),
  createdAt: createdAt(),
});

export const exports = pgTable(
  "exports",
  {
    /** Client-generated so retries are idempotent. */
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => flyerProjects.id, { onDelete: "cascade" }),
    format: text("format").notNull(),
    creditsSpent: integer("credits_spent").notNull(),
    watermarked: boolean("watermarked").notNull(),
    status: text("status").notNull().default("pending"),
    /** Object key in the private (exports) bucket. */
    storagePath: text("storage_path").notNull(),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", tz),
  },
  (t) => [
    index("exports_user_created_idx").on(t.userId, t.createdAt.desc()),
    check("exports_format_check", sql`${t.format} in (${inList(EXPORT_FORMATS)})`),
    check("exports_credits_check", sql`${t.creditsSpent} >= 0`),
    check("exports_status_check", sql`${t.status} in ('pending', 'complete', 'failed')`),
  ],
);

// ── Payments (Paynow prepaid passes) ─────────────────────────────────────────

export const payments = pgTable(
  "payments",
  {
    /** Our reference, sent to Paynow. */
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    plan: planTier("plan").notNull(),
    billingInterval: billingInterval("billing_interval").notNull(),
    amount: numeric("amount", { precision: 10, scale: 2, mode: "number" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    credits: integer("credits").notNull(),
    status: text("status").notNull().default("created"),
    paynowReference: text("paynow_reference"),
    pollUrl: text("poll_url"),
    createdAt: createdAt(),
    paidAt: timestamp("paid_at", tz),
  },
  (t) => [
    index("payments_user_created_idx").on(t.userId, t.createdAt.desc()),
    check("payments_plan_check", sql`${t.plan} <> 'free'`),
    check("payments_amount_check", sql`${t.amount} > 0`),
    check("payments_credits_check", sql`${t.credits} > 0`),
    check("payments_status_check", sql`${t.status} in ('created', 'sent', 'paid', 'cancelled', 'failed')`),
  ],
);

// ── Rate limits (fixed windows, see src/rate-limit.ts) ───────────────────────

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", tz).notNull(),
    hits: integer("hits").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

// ── WhatsApp (apps/whatsapp) ─────────────────────────────────────────────────

/** Every incoming message id, so a redelivered message is handled once. */
export const whatsappMessages = pgTable("whatsapp_messages", {
  id: text("id").primaryKey(),
  phone: text("phone").notNull(),
  receivedAt: timestamp("received_at", tz).notNull().defaultNow(),
});

/**
 * Welcome flyers, granted once per phone number ever (the database trigger on "user" grants
 * them when a number is first verified). Kept when an account is deleted, so a number can't
 * collect them twice.
 */
export const freeFlyerGrants = pgTable("free_flyer_grants", {
  phone: text("phone").primaryKey(),
  userId: uuid("user_id").references(() => profiles.id, { onDelete: "set null" }),
  flyers: integer("flyers").notNull(),
  grantedAt: timestamp("granted_at", tz).notNull().defaultNow(),
});

/** The conversation's last flyer, so "2" can mean "open the second design". */
export const whatsappChats = pgTable("whatsapp_chats", {
  phone: text("phone").primaryKey(),
  userId: uuid("user_id").references(() => profiles.id, { onDelete: "cascade" }),
  lastJobId: uuid("last_job_id"),
  updatedAt: updatedAt(),
});

export type Plan = (typeof planTier.enumValues)[number];
export type Interval = (typeof billingInterval.enumValues)[number];

