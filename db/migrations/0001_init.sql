-- Euron Open LMS: initial schema.
--
-- Conventions
--   * Primary keys are ULIDs stored as text (sortable by creation time).
--   * Timestamps are timestamptz(3), the API runs with TZ=UTC. Millisecond precision is
--     exactly what a JS Date holds, so a keyset cursor built from a Date round-trips
--     without skipping or repeating rows (microsecond columns would break that).
--   * Money is an integer count of the currency's minor unit (cents, paise) next to an
--     ISO 4217 code. Never a float, never a bare number without its currency.
--   * Denormalised counters (enrollment_count, rating_avg, ...) are maintained in the
--     same transaction as the row they count, and a reconciliation job corrects drift.
--   * Lists page with keyset cursors, never OFFSET.
--   * Who may see course content is decided in one place: domain/entitlements.ts. Video
--     references, PDF keys and answer keys never leave the API without passing it.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Enums ──────────────────────────────────────────────────────────────────

-- LEARNER: everyone. INSTRUCTOR: may author courses they own or were added to.
-- SUPPORT: learners, enrollments and moderation. FINANCE: orders, refunds, coupons and
-- plans. ADMIN: everything, including settings and role changes.
CREATE TYPE user_role AS ENUM ('LEARNER', 'INSTRUCTOR', 'SUPPORT', 'FINANCE', 'ADMIN');
CREATE TYPE user_status AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'BANNED', 'DEACTIVATED');
CREATE TYPE auth_token_type AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

CREATE TYPE upload_purpose AS ENUM (
  'AVATAR', 'COURSE_COVER', 'LECTURE_PDF', 'LECTURE_RESOURCE', 'SUBMISSION', 'BRANDING'
);
CREATE TYPE upload_kind AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'PDF', 'DOCUMENT', 'ARCHIVE', 'OTHER');
CREATE TYPE upload_status AS ENUM ('PENDING', 'COMPLETE', 'READY', 'REJECTED', 'DELETED');

CREATE TYPE course_status AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE course_level AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'ALL_LEVELS');
-- FREE: anyone signed in may enroll. PAID: a purchase (or a grant). SUBSCRIPTION_ONLY:
-- only through an active plan (or a grant); never sold on its own.
CREATE TYPE access_mode AS ENUM ('FREE', 'PAID', 'SUBSCRIPTION_ONLY');
-- OWNER: full control including staff. EDITOR: content. GRADER: assignment reviews only.
CREATE TYPE course_staff_role AS ENUM ('OWNER', 'EDITOR', 'GRADER');

CREATE TYPE item_kind AS ENUM ('LECTURE', 'QUIZ', 'ASSIGNMENT');
CREATE TYPE lecture_kind AS ENUM ('VIDEO', 'ARTICLE', 'PDF');
-- EVS: a video id in a euron-video-system deployment, played through a playback session
-- minted server-side. HLS / MP4: a URL you host. YOUTUBE: a video id, embedded no-cookie.
CREATE TYPE video_provider AS ENUM ('EVS', 'HLS', 'MP4', 'YOUTUBE');
CREATE TYPE video_status AS ENUM ('PROCESSING', 'READY', 'FAILED');

CREATE TYPE question_kind AS ENUM ('SINGLE', 'MULTI', 'TRUE_FALSE', 'SHORT_TEXT');
CREATE TYPE text_match AS ENUM ('EXACT', 'CASE_INSENSITIVE', 'REGEX');
CREATE TYPE quiz_selection AS ENUM ('FIXED', 'RANDOM');
CREATE TYPE reveal_policy AS ENUM ('AFTER_SUBMIT', 'AFTER_PASS', 'NEVER');
CREATE TYPE attempt_status AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED');

CREATE TYPE submission_status AS ENUM ('SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED');

-- Why an enrollment exists. Access for SUBSCRIPTION rows is re-checked against the
-- learner's subscription on every request (domain/entitlements.ts).
CREATE TYPE enrollment_source AS ENUM ('FREE', 'PURCHASE', 'BUNDLE', 'SUBSCRIPTION', 'GRANT');
CREATE TYPE enrollment_status AS ENUM ('ACTIVE', 'REVOKED');

CREATE TYPE content_status AS ENUM ('PUBLISHED', 'HIDDEN', 'DELETED');
CREATE TYPE report_target AS ENUM ('REVIEW', 'QA_THREAD', 'QA_REPLY');
CREATE TYPE report_reason AS ENUM ('SPAM', 'HARASSMENT', 'OFF_TOPIC', 'SPOILER', 'INAPPROPRIATE', 'OTHER');
CREATE TYPE report_status AS ENUM ('OPEN', 'RESOLVED');

CREATE TYPE sellable_type AS ENUM ('COURSE', 'BUNDLE', 'PLAN');
CREATE TYPE billing_interval AS ENUM ('MONTH', 'YEAR');
CREATE TYPE catalog_status AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE gateway AS ENUM ('STRIPE', 'RAZORPAY', 'FREE');
CREATE TYPE order_kind AS ENUM ('ONE_TIME', 'SUBSCRIPTION');
-- PENDING -> PAID | FAILED | EXPIRED | CANCELED. PAID -> PARTIALLY_REFUNDED -> REFUNDED.
-- Every move is a conditional UPDATE on the expected current status (domain/orders.ts).
CREATE TYPE order_status AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELED', 'PARTIALLY_REFUNDED', 'REFUNDED');
CREATE TYPE refund_status AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
CREATE TYPE coupon_kind AS ENUM ('PERCENT', 'FIXED');
CREATE TYPE coupon_scope AS ENUM ('ALL', 'COURSES', 'BUNDLES', 'PLANS', 'SPECIFIC');
CREATE TYPE subscription_status AS ENUM ('INCOMPLETE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');
CREATE TYPE invoice_kind AS ENUM ('INVOICE', 'CREDIT_NOTE');

CREATE TYPE notification_type AS ENUM (
  'ORDER_PAID', 'ORDER_FAILED', 'REFUND_ISSUED', 'ENROLLMENT_GRANTED', 'ENROLLMENT_REVOKED',
  'SUBMISSION_REVIEWED', 'CERTIFICATE_ISSUED', 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_PAYMENT_FAILED',
  'SUBSCRIPTION_CANCELED', 'QA_REPLY', 'QA_ACCEPTED', 'REVIEW_REPLY', 'COURSE_UPDATED'
);

-- ─── Identity ───────────────────────────────────────────────────────────────

CREATE TABLE media_uploads (
  id               text PRIMARY KEY,
  owner_id         text NOT NULL,            -- FK added after users exists
  purpose          upload_purpose NOT NULL,
  kind             upload_kind NOT NULL,
  mime_type        text NOT NULL,
  file_name        text NOT NULL,
  declared_size    bigint NOT NULL,
  size_bytes       bigint,
  storage_key      text NOT NULL UNIQUE,
  thumb_key        text,
  width            integer,
  height           integer,
  duration_seconds integer,
  status           upload_status NOT NULL DEFAULT 'PENDING',
  rejected_reason  text,
  created_at       timestamptz(3) NOT NULL DEFAULT now(),
  completed_at     timestamptz(3)
);
CREATE INDEX media_uploads_owner_idx ON media_uploads (owner_id, created_at DESC);
CREATE INDEX media_uploads_pending_idx ON media_uploads (created_at) WHERE status = 'PENDING';

CREATE TABLE users (
  id                    text PRIMARY KEY,
  email                 citext NOT NULL UNIQUE,
  username              citext NOT NULL UNIQUE CHECK (username ~ '^[a-zA-Z0-9][a-zA-Z0-9-]{1,38}[a-zA-Z0-9]$'),
  -- Cleaned at write time (domain/display-name.ts): never an email address or a phone number.
  display_name          text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  -- The name printed on certificates. Defaults to display_name; learners may set a
  -- legal name here without changing how they appear in Q&A.
  certificate_name      text CHECK (length(certificate_name) BETWEEN 1 AND 120),
  headline              text CHECK (length(headline) <= 120),
  bio                   text CHECK (length(bio) <= 2000),
  website               text CHECK (length(website) <= 300),
  password_hash         text NOT NULL,
  role                  user_role NOT NULL DEFAULT 'LEARNER',
  status                user_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  email_verified_at     timestamptz(3),
  totp_secret           text,                    -- AES-256-GCM ciphertext (security/totp.ts), never the raw secret
  totp_enabled          boolean NOT NULL DEFAULT false,
  totp_last_step        bigint,                  -- last accepted TOTP time step: a code works once
  suspended_until       timestamptz(3),
  token_version         integer NOT NULL DEFAULT 0,
  avatar_upload_id      text REFERENCES media_uploads (id) ON DELETE SET NULL,
  -- Per-category email switches, e.g. {"QA_REPLY": false}. Missing keys mean on.
  -- Receipts and security mail are always sent.
  email_preferences     jsonb NOT NULL DEFAULT '{}',
  preferred_currency    char(3),
  -- Set when the learner asks to delete the account; the purge job erases it after the
  -- grace period unless they sign in and cancel.
  deletion_requested_at timestamptz(3),
  last_seen_at          timestamptz(3),
  created_at            timestamptz(3) NOT NULL DEFAULT now(),
  updated_at            timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX users_name_trgm_idx ON users USING gin ((display_name || ' ' || username::text || ' ' || email::text) gin_trgm_ops);
CREATE INDEX users_staff_idx ON users (role) WHERE role <> 'LEARNER';

ALTER TABLE media_uploads ADD CONSTRAINT media_uploads_owner_fk FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE;

CREATE TABLE sessions (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id    text NOT NULL,                  -- every rotation of one login shares a family
  token_hash   text NOT NULL UNIQUE,           -- sha256 of the refresh token
  user_agent   text,
  ip           inet,
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  last_used_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at   timestamptz(3) NOT NULL,
  revoked_at   timestamptz(3),
  replaced_by  text
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_family_idx ON sessions (family_id);

CREATE TABLE auth_tokens (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       auth_token_type NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz(3) NOT NULL,
  used_at    timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id, type);

-- Single-use two-factor recovery codes, issued ten at a time when TOTP is turned on.
-- Only an HMAC of each code is stored (keyed from TOTP_ENCRYPTION_KEY).
CREATE TABLE totp_recovery_codes (
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code_hash)
);

-- ─── Catalog ────────────────────────────────────────────────────────────────

CREATE TABLE categories (
  id          text PRIMARY KEY,
  slug        citext NOT NULL UNIQUE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  description text CHECK (length(description) <= 300),
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE courses (
  id                       text PRIMARY KEY,
  slug                     citext NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title                    text NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  subtitle                 text CHECK (length(subtitle) <= 200),
  -- Markdown. Rendered to sanitized HTML on the server (domain/markdown.ts).
  description              text NOT NULL DEFAULT '' CHECK (length(description) <= 20000),
  outcomes                 text[] NOT NULL DEFAULT '{}' CHECK (cardinality(outcomes) <= 20),
  prerequisites            text[] NOT NULL DEFAULT '{}' CHECK (cardinality(prerequisites) <= 20),
  level                    course_level NOT NULL DEFAULT 'ALL_LEVELS',
  language                 text NOT NULL DEFAULT 'en' CHECK (language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  cover_upload_id          text REFERENCES media_uploads (id) ON DELETE SET NULL,
  status                   course_status NOT NULL DEFAULT 'DRAFT',
  access_mode              access_mode NOT NULL DEFAULT 'PAID',
  -- An active subscription unlocks the course (always true for SUBSCRIPTION_ONLY).
  included_in_subscription boolean NOT NULL DEFAULT true,
  certificate_enabled      boolean NOT NULL DEFAULT true,
  featured                 boolean NOT NULL DEFAULT false,
  -- Maintained by the curriculum service in the same transaction as each item change.
  item_count               integer NOT NULL DEFAULT 0,
  duration_seconds         integer NOT NULL DEFAULT 0,
  -- Maintained by enrollment and review writes.
  enrollment_count         integer NOT NULL DEFAULT 0,
  rating_count             integer NOT NULL DEFAULT 0,
  rating_sum               integer NOT NULL DEFAULT 0,
  search                   tsvector GENERATED ALWAYS AS (
                             setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
                             setweight(to_tsvector('simple', coalesce(subtitle, '')), 'B') ||
                             setweight(to_tsvector('simple', coalesce(description, '')), 'C')
                           ) STORED,
  created_by               text REFERENCES users (id) ON DELETE SET NULL,
  published_at             timestamptz(3),
  created_at               timestamptz(3) NOT NULL DEFAULT now(),
  updated_at               timestamptz(3) NOT NULL DEFAULT now(),
  CHECK (access_mode <> 'SUBSCRIPTION_ONLY' OR included_in_subscription)
);
CREATE INDEX courses_search_idx ON courses USING gin (search);
CREATE INDEX courses_title_trgm_idx ON courses USING gin (title gin_trgm_ops);
CREATE INDEX courses_catalog_idx ON courses (published_at DESC, id DESC) WHERE status = 'PUBLISHED';
CREATE INDEX courses_popular_idx ON courses (enrollment_count DESC, id DESC) WHERE status = 'PUBLISHED';

CREATE TABLE course_categories (
  course_id   text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  category_id text NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, category_id)
);
CREATE INDEX course_categories_category_idx ON course_categories (category_id);

-- Who teaches and who may edit. `listed` staff appear as instructors on the course page.
CREATE TABLE course_staff (
  course_id  text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       course_staff_role NOT NULL,
  listed     boolean NOT NULL DEFAULT true,
  position   integer NOT NULL DEFAULT 0,
  added_by   text REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, user_id)
);
CREATE INDEX course_staff_user_idx ON course_staff (user_id);

-- ─── Curriculum ─────────────────────────────────────────────────────────────

-- Positions are dense (0..n-1) and unique per parent. The UNIQUE constraints are
-- DEFERRABLE so a move can renumber every sibling in one transaction
-- (repositories/curriculum.repository.ts: move).
CREATE TABLE course_sections (
  id         text PRIMARY KEY,
  course_id  text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  title      text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  position   integer NOT NULL CHECK (position >= 0),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT course_sections_position_key UNIQUE (course_id, position) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE course_items (
  id               text PRIMARY KEY,
  course_id        text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  section_id       text NOT NULL REFERENCES course_sections (id) ON DELETE CASCADE,
  kind             item_kind NOT NULL,
  title            text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  position         integer NOT NULL CHECK (position >= 0),
  -- Anyone may open a preview item from the course page, enrolled or not.
  is_preview       boolean NOT NULL DEFAULT false,
  -- Video length, or an estimated reading / working time.
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  created_at       timestamptz(3) NOT NULL DEFAULT now(),
  updated_at       timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT course_items_position_key UNIQUE (section_id, position) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX course_items_course_idx ON course_items (course_id);

CREATE TABLE lectures (
  item_id       text PRIMARY KEY REFERENCES course_items (id) ON DELETE CASCADE,
  lecture_kind  lecture_kind NOT NULL,
  video_provider video_provider,
  -- EVS video id, an https URL (HLS / MP4) or a YouTube id. Never sent to a client:
  -- playback goes through POST /api/learn/items/:id/playback.
  video_ref     text CHECK (length(video_ref) <= 500),
  video_status  video_status NOT NULL DEFAULT 'READY',
  body          text CHECK (length(body) <= 100000),   -- ARTICLE markdown, or notes under a video
  pdf_upload_id text REFERENCES media_uploads (id) ON DELETE SET NULL,
  CHECK ((lecture_kind = 'VIDEO') = (video_provider IS NOT NULL))
);
CREATE INDEX lectures_evs_idx ON lectures (video_ref) WHERE video_provider = 'EVS';

CREATE TABLE lecture_resources (
  id         text PRIMARY KEY,
  item_id    text NOT NULL REFERENCES course_items (id) ON DELETE CASCADE,
  title      text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  upload_id  text REFERENCES media_uploads (id) ON DELETE CASCADE,
  url        text CHECK (length(url) <= 500),
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CHECK ((upload_id IS NULL) <> (url IS NULL))
);
CREATE INDEX lecture_resources_item_idx ON lecture_resources (item_id, position);

-- ─── Assessments ────────────────────────────────────────────────────────────

-- The course's question bank. Quizzes pick from it (FIXED) or draw from it by tag
-- (RANDOM). `options` is [{ "id": "a", "text": "...", "correct": true }]; the correct
-- flags never reach a learner except through the quiz's reveal policy.
CREATE TABLE questions (
  id               text PRIMARY KEY,
  course_id        text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  kind             question_kind NOT NULL,
  prompt           text NOT NULL CHECK (length(prompt) BETWEEN 1 AND 5000),
  explanation      text CHECK (length(explanation) <= 5000),
  points           integer NOT NULL DEFAULT 1 CHECK (points BETWEEN 1 AND 100),
  options          jsonb NOT NULL DEFAULT '[]',
  accepted_answers text[] NOT NULL DEFAULT '{}',
  match_mode       text_match NOT NULL DEFAULT 'CASE_INSENSITIVE',
  tags             text[] NOT NULL DEFAULT '{}',
  archived_at      timestamptz(3),
  created_by       text REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz(3) NOT NULL DEFAULT now(),
  updated_at       timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX questions_course_idx ON questions (course_id, created_at DESC) WHERE archived_at IS NULL;
CREATE INDEX questions_tags_idx ON questions USING gin (tags);

CREATE TABLE quizzes (
  item_id            text PRIMARY KEY REFERENCES course_items (id) ON DELETE CASCADE,
  instructions       text CHECK (length(instructions) <= 5000),
  selection          quiz_selection NOT NULL DEFAULT 'FIXED',
  -- RANDOM: how many to draw, and from which tags (empty = the whole bank).
  draw_count         integer CHECK (draw_count BETWEEN 1 AND 200),
  draw_tags          text[] NOT NULL DEFAULT '{}',
  pass_percent       integer NOT NULL DEFAULT 70 CHECK (pass_percent BETWEEN 0 AND 100),
  time_limit_seconds integer CHECK (time_limit_seconds BETWEEN 30 AND 86400),
  max_attempts       integer CHECK (max_attempts BETWEEN 1 AND 100),   -- NULL = unlimited
  shuffle_questions  boolean NOT NULL DEFAULT false,
  shuffle_options    boolean NOT NULL DEFAULT true,
  reveal             reveal_policy NOT NULL DEFAULT 'AFTER_SUBMIT',
  CHECK (selection = 'FIXED' OR draw_count IS NOT NULL)
);

CREATE TABLE quiz_questions (
  quiz_item_id text NOT NULL REFERENCES quizzes (item_id) ON DELETE CASCADE,
  question_id  text NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  position     integer NOT NULL,
  PRIMARY KEY (quiz_item_id, question_id)
);

-- One row per attempt. `snapshot` freezes the questions exactly as presented (order,
-- option order, points and the answer key) so later bank edits never regrade history,
-- and grading checks submitted ids against it.
CREATE TABLE quiz_attempts (
  id            text PRIMARY KEY,
  quiz_item_id  text NOT NULL REFERENCES quizzes (item_id) ON DELETE CASCADE,
  course_id     text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  user_id       text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  number        integer NOT NULL CHECK (number >= 1),
  status        attempt_status NOT NULL DEFAULT 'IN_PROGRESS',
  snapshot      jsonb NOT NULL,
  answers       jsonb NOT NULL DEFAULT '{}',
  score_points  integer,
  max_points    integer NOT NULL,
  percent       integer CHECK (percent BETWEEN 0 AND 100),
  passed        boolean,
  started_at    timestamptz(3) NOT NULL DEFAULT now(),
  deadline_at   timestamptz(3),
  submitted_at  timestamptz(3),
  UNIQUE (quiz_item_id, user_id, number)
);
CREATE UNIQUE INDEX quiz_attempts_one_open_idx ON quiz_attempts (quiz_item_id, user_id) WHERE status = 'IN_PROGRESS';
CREATE INDEX quiz_attempts_user_idx ON quiz_attempts (user_id, started_at DESC);

CREATE TABLE assignments (
  item_id          text PRIMARY KEY REFERENCES course_items (id) ON DELETE CASCADE,
  instructions     text NOT NULL DEFAULT '' CHECK (length(instructions) <= 20000),
  -- [{ "id": "c1", "title": "Correctness", "description": "...", "maxPoints": 10 }]
  rubric           jsonb NOT NULL DEFAULT '[]',
  pass_points      integer CHECK (pass_points >= 0),
  -- Days after enrolling; NULL = no due date.
  due_days         integer CHECK (due_days BETWEEN 1 AND 365),
  allow_late       boolean NOT NULL DEFAULT true,
  accept_text      boolean NOT NULL DEFAULT true,
  accept_files     boolean NOT NULL DEFAULT true,
  accept_url       boolean NOT NULL DEFAULT false,
  max_files        integer NOT NULL DEFAULT 5 CHECK (max_files BETWEEN 0 AND 20)
);

-- Every (re)submission is a new version; reviews attach to the version they judged.
CREATE TABLE assignment_submissions (
  id            text PRIMARY KEY,
  item_id       text NOT NULL REFERENCES assignments (item_id) ON DELETE CASCADE,
  course_id     text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  user_id       text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  version       integer NOT NULL CHECK (version >= 1),
  body          text CHECK (length(body) <= 50000),
  url           text CHECK (length(url) <= 500),
  status        submission_status NOT NULL DEFAULT 'SUBMITTED',
  is_late       boolean NOT NULL DEFAULT false,
  -- { "c1": 8, "c2": 5 } keyed by rubric criterion id, clamped to each maxPoints.
  scores        jsonb,
  total_points  integer,
  feedback      text CHECK (length(feedback) <= 20000),
  -- What the AI proposed, kept next to what the human decided (never applied by itself).
  ai_suggestion jsonb,
  reviewed_by   text REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at   timestamptz(3),
  submitted_at  timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (item_id, user_id, version)
);
CREATE INDEX assignment_submissions_queue_idx ON assignment_submissions (submitted_at, id) WHERE status = 'SUBMITTED';
CREATE INDEX assignment_submissions_user_idx ON assignment_submissions (user_id, item_id, version DESC);

CREATE TABLE submission_files (
  submission_id text NOT NULL REFERENCES assignment_submissions (id) ON DELETE CASCADE,
  upload_id     text NOT NULL REFERENCES media_uploads (id) ON DELETE CASCADE,
  position      integer NOT NULL,
  PRIMARY KEY (submission_id, upload_id)
);

-- ─── Commerce ───────────────────────────────────────────────────────────────

CREATE TABLE bundles (
  id              text PRIMARY KEY,
  slug            citext NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title           text NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  description     text NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
  cover_upload_id text REFERENCES media_uploads (id) ON DELETE SET NULL,
  status          catalog_status NOT NULL DEFAULT 'DRAFT',
  created_at      timestamptz(3) NOT NULL DEFAULT now(),
  updated_at      timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE bundle_courses (
  bundle_id text NOT NULL REFERENCES bundles (id) ON DELETE CASCADE,
  course_id text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  position  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bundle_id, course_id)
);
CREATE INDEX bundle_courses_course_idx ON bundle_courses (course_id);

-- The all-access subscription plans. A plan unlocks every course with
-- included_in_subscription while the learner's subscription is in good standing.
CREATE TABLE plans (
  id          text PRIMARY KEY,
  slug        citext NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  features    text[] NOT NULL DEFAULT '{}' CHECK (cardinality(features) <= 20),
  trial_days  integer NOT NULL DEFAULT 0 CHECK (trial_days BETWEEN 0 AND 90),
  status      catalog_status NOT NULL DEFAULT 'DRAFT',
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz(3) NOT NULL DEFAULT now(),
  updated_at  timestamptz(3) NOT NULL DEFAULT now()
);

-- The price book. One active price per thing, currency and interval. The server prices
-- every checkout from here; a client never sends an amount.
-- `gateway_refs`: {"stripe": "price_...", "razorpay": "plan_..."} for recurring prices,
-- created on first use and reused after.
CREATE TABLE prices (
  id               text PRIMARY KEY,
  sellable_type    sellable_type NOT NULL,
  sellable_id      text NOT NULL,
  currency         char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor     bigint NOT NULL CHECK (amount_minor >= 0),
  -- A struck-through "was" price on the course page. Display only.
  compare_at_minor bigint CHECK (compare_at_minor >= 0),
  interval         billing_interval,
  gateway_refs     jsonb NOT NULL DEFAULT '{}',
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz(3) NOT NULL DEFAULT now(),
  updated_at       timestamptz(3) NOT NULL DEFAULT now(),
  CHECK ((sellable_type = 'PLAN') = (interval IS NOT NULL))
);
CREATE UNIQUE INDEX prices_one_time_key ON prices (sellable_type, sellable_id, currency) WHERE active AND interval IS NULL;
CREATE UNIQUE INDEX prices_recurring_key ON prices (sellable_type, sellable_id, currency, interval) WHERE active AND interval IS NOT NULL;

CREATE TABLE coupons (
  id               text PRIMARY KEY,
  code             citext NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9_-]{3,40}$'),
  description      text CHECK (length(description) <= 200),
  kind             coupon_kind NOT NULL,
  percent_off      integer CHECK (percent_off BETWEEN 1 AND 100),
  amount_off_minor bigint CHECK (amount_off_minor > 0),
  currency         char(3),
  scope            coupon_scope NOT NULL DEFAULT 'ALL',
  max_redemptions  integer CHECK (max_redemptions >= 1),
  redemption_count integer NOT NULL DEFAULT 0,
  per_user_limit   integer NOT NULL DEFAULT 1 CHECK (per_user_limit >= 1),
  -- First-payment-only for subscriptions: renewals are charged in full.
  starts_at        timestamptz(3),
  expires_at       timestamptz(3),
  active           boolean NOT NULL DEFAULT true,
  created_by       text REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz(3) NOT NULL DEFAULT now(),
  updated_at       timestamptz(3) NOT NULL DEFAULT now(),
  CHECK ((kind = 'PERCENT') = (percent_off IS NOT NULL)),
  CHECK ((kind = 'FIXED') = (amount_off_minor IS NOT NULL AND currency IS NOT NULL)),
  CHECK (max_redemptions IS NULL OR redemption_count <= max_redemptions)
);

CREATE TABLE coupon_targets (
  coupon_id     text NOT NULL REFERENCES coupons (id) ON DELETE CASCADE,
  sellable_type sellable_type NOT NULL,
  sellable_id   text NOT NULL,
  PRIMARY KEY (coupon_id, sellable_type, sellable_id)
);

CREATE TABLE orders (
  id                  text PRIMARY KEY,
  -- Human-facing, shown on receipts: "ORD-7K2M9QX4".
  number              text NOT NULL UNIQUE,
  user_id             text NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  kind                order_kind NOT NULL,
  status              order_status NOT NULL DEFAULT 'PENDING',
  currency            char(3) NOT NULL,
  subtotal_minor      bigint NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor      bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor           bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor         bigint NOT NULL CHECK (total_minor >= 0),
  refunded_minor      bigint NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
  coupon_id           text REFERENCES coupons (id) ON DELETE SET NULL,
  coupon_code         citext,
  gateway             gateway NOT NULL,
  -- Stripe Checkout Session id / Razorpay order or subscription id. Unique per gateway,
  -- so a webhook resolves to exactly one order.
  gateway_ref         text,
  gateway_payment_ref text,
  -- The rate, label and mode the order was taxed with, frozen at checkout.
  tax                 jsonb NOT NULL DEFAULT '{}',
  -- Name, country, region, tax id the buyer entered at checkout (for the invoice).
  billing             jsonb NOT NULL DEFAULT '{}',
  plan_id             text REFERENCES plans (id) ON DELETE SET NULL,
  price_id            text REFERENCES prices (id) ON DELETE SET NULL,
  idempotency_key     text NOT NULL,
  failure_reason      text,
  paid_at             timestamptz(3),
  expires_at          timestamptz(3) NOT NULL,
  created_at          timestamptz(3) NOT NULL DEFAULT now(),
  updated_at          timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  -- Exclusive tax is added on top; inclusive tax is already inside the prices.
  CHECK (total_minor = subtotal_minor - discount_minor + CASE WHEN tax ->> 'mode' = 'INCLUSIVE' THEN 0 ELSE tax_minor END),
  CHECK (refunded_minor <= total_minor)
);
CREATE UNIQUE INDEX orders_gateway_ref_key ON orders (gateway, gateway_ref) WHERE gateway_ref IS NOT NULL;
CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC, id DESC);
CREATE INDEX orders_recent_idx ON orders (created_at DESC, id DESC);
CREATE INDEX orders_pending_idx ON orders (expires_at) WHERE status = 'PENDING';

CREATE TABLE order_items (
  id             text PRIMARY KEY,
  order_id       text NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  sellable_type  sellable_type NOT NULL,
  sellable_id    text NOT NULL,
  title          text NOT NULL,
  price_id       text REFERENCES prices (id) ON DELETE SET NULL,
  unit_minor     bigint NOT NULL CHECK (unit_minor >= 0),
  discount_minor bigint NOT NULL DEFAULT 0,
  tax_minor      bigint NOT NULL DEFAULT 0,
  total_minor    bigint NOT NULL CHECK (total_minor >= 0)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

-- Every gateway webhook, verified, stored once. The UNIQUE key is the deduplication:
-- a redelivered event inserts nothing and is acknowledged without being processed again.
CREATE TABLE payment_events (
  id           text PRIMARY KEY,
  gateway      gateway NOT NULL,
  event_id     text NOT NULL,
  type         text NOT NULL,
  order_id     text REFERENCES orders (id) ON DELETE SET NULL,
  subscription_id text,
  -- The event body with card and contact details removed (services/payments/redact.ts).
  payload      jsonb NOT NULL,
  outcome      text,
  received_at  timestamptz(3) NOT NULL DEFAULT now(),
  processed_at timestamptz(3),
  UNIQUE (gateway, event_id)
);
CREATE INDEX payment_events_order_idx ON payment_events (order_id, received_at);

CREATE TABLE refunds (
  id                 text PRIMARY KEY,
  order_id           text NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  reason             text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  revoke_access      boolean NOT NULL DEFAULT false,
  status             refund_status NOT NULL DEFAULT 'PENDING',
  gateway_refund_ref text,
  failure_reason     text,
  requested_by       text REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz(3) NOT NULL DEFAULT now(),
  settled_at         timestamptz(3)
);
CREATE UNIQUE INDEX refunds_gateway_ref_key ON refunds (gateway_refund_ref) WHERE gateway_refund_ref IS NOT NULL;
CREATE INDEX refunds_order_idx ON refunds (order_id);

CREATE TABLE coupon_redemptions (
  id         text PRIMARY KEY,
  coupon_id  text NOT NULL REFERENCES coupons (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  order_id   text NOT NULL UNIQUE REFERENCES orders (id) ON DELETE CASCADE,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX coupon_redemptions_user_idx ON coupon_redemptions (coupon_id, user_id);

-- The gateway's customer object for a learner (Stripe Customer), so saved cards and
-- subscriptions attach to one customer.
CREATE TABLE gateway_customers (
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  gateway      gateway NOT NULL,
  customer_ref text NOT NULL,
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, gateway),
  UNIQUE (gateway, customer_ref)
);

CREATE TABLE subscriptions (
  id                       text PRIMARY KEY,
  user_id                  text NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  plan_id                  text NOT NULL REFERENCES plans (id) ON DELETE RESTRICT,
  price_id                 text REFERENCES prices (id) ON DELETE SET NULL,
  gateway                  gateway NOT NULL,
  gateway_subscription_ref text NOT NULL,
  status                   subscription_status NOT NULL DEFAULT 'INCOMPLETE',
  currency                 char(3) NOT NULL,
  amount_minor             bigint NOT NULL,
  interval                 billing_interval NOT NULL,
  current_period_start     timestamptz(3),
  current_period_end       timestamptz(3),
  trial_end                timestamptz(3),
  cancel_at_period_end     boolean NOT NULL DEFAULT false,
  canceled_at              timestamptz(3),
  first_order_id           text REFERENCES orders (id) ON DELETE SET NULL,
  created_at               timestamptz(3) NOT NULL DEFAULT now(),
  updated_at               timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (gateway, gateway_subscription_ref)
);
-- At most one live subscription per learner.
CREATE UNIQUE INDEX subscriptions_one_live_idx ON subscriptions (user_id) WHERE status IN ('INCOMPLETE', 'TRIALING', 'ACTIVE', 'PAST_DUE');
CREATE INDEX subscriptions_expiring_idx ON subscriptions (current_period_end) WHERE status IN ('TRIALING', 'ACTIVE', 'PAST_DUE');

-- Gap-free invoice numbers per year: the counter row is locked and bumped in the same
-- transaction that inserts the invoice, so a rolled-back fulfilment burns no number.
CREATE TABLE invoice_sequences (
  series text PRIMARY KEY,     -- e.g. "INV-2026", "CN-2026"
  next   integer NOT NULL DEFAULT 1
);

CREATE TABLE invoices (
  id              text PRIMARY KEY,
  number          text NOT NULL UNIQUE,
  kind            invoice_kind NOT NULL DEFAULT 'INVOICE',
  order_id        text REFERENCES orders (id) ON DELETE SET NULL,
  refund_id       text REFERENCES refunds (id) ON DELETE SET NULL,
  subscription_id text REFERENCES subscriptions (id) ON DELETE SET NULL,
  user_id         text NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  currency        char(3) NOT NULL,
  subtotal_minor  bigint NOT NULL,
  discount_minor  bigint NOT NULL DEFAULT 0,
  tax_minor       bigint NOT NULL DEFAULT 0,
  total_minor     bigint NOT NULL,
  -- Frozen copies: the seller's legal details from settings, the buyer's billing
  -- details from the order, and the lines.
  seller          jsonb NOT NULL,
  buyer           jsonb NOT NULL,
  lines           jsonb NOT NULL,
  tax             jsonb NOT NULL DEFAULT '{}',
  -- Rendered by the invoices job; NULL until it has run. Private object, presigned on download.
  pdf_key         text,
  issued_at       timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX invoices_user_idx ON invoices (user_id, issued_at DESC);
CREATE UNIQUE INDEX invoices_order_key ON invoices (order_id) WHERE kind = 'INVOICE' AND order_id IS NOT NULL;
CREATE UNIQUE INDEX invoices_refund_key ON invoices (refund_id) WHERE refund_id IS NOT NULL;

-- ─── Learning ───────────────────────────────────────────────────────────────

-- The learner-course relationship: where progress lives. Whether it still grants access
-- is decided by domain/entitlements.ts from source, status, valid_until and, for
-- SUBSCRIPTION rows, the learner's subscription.
CREATE TABLE enrollments (
  id                text PRIMARY KEY,
  user_id           text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id         text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  source            enrollment_source NOT NULL,
  status            enrollment_status NOT NULL DEFAULT 'ACTIVE',
  order_id          text REFERENCES orders (id) ON DELETE SET NULL,
  bundle_id         text REFERENCES bundles (id) ON DELETE SET NULL,
  granted_by        text REFERENCES users (id) ON DELETE SET NULL,
  grant_note        text CHECK (length(grant_note) <= 300),
  valid_until       timestamptz(3),
  revoked_at        timestamptz(3),
  revoked_reason    text CHECK (length(revoked_reason) <= 300),
  -- Progress rollup, recomputed in SQL whenever an item completes (progress.repository).
  completed_items   integer NOT NULL DEFAULT 0,
  progress_percent  integer NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  completed_at      timestamptz(3),
  last_item_id      text REFERENCES course_items (id) ON DELETE SET NULL,
  last_activity_at  timestamptz(3),
  created_at        timestamptz(3) NOT NULL DEFAULT now(),
  updated_at        timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id)
);
CREATE INDEX enrollments_user_idx ON enrollments (user_id, last_activity_at DESC NULLS LAST, id DESC);
CREATE INDEX enrollments_course_idx ON enrollments (course_id, created_at DESC);
CREATE INDEX enrollments_order_idx ON enrollments (order_id) WHERE order_id IS NOT NULL;

CREATE TABLE item_progress (
  user_id          text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  item_id          text NOT NULL REFERENCES course_items (id) ON DELETE CASCADE,
  course_id        text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  -- Videos: where to resume, and the furthest point reached (seeking ahead does not
  -- count as watching; see domain/progress.ts).
  position_seconds integer NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
  furthest_seconds integer NOT NULL DEFAULT 0 CHECK (furthest_seconds >= 0),
  watched_seconds  integer NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0),
  completed_at     timestamptz(3),
  updated_at       timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX item_progress_course_idx ON item_progress (user_id, course_id);

CREATE TABLE notes (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id  text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  item_id    text NOT NULL REFERENCES course_items (id) ON DELETE CASCADE,
  at_seconds integer CHECK (at_seconds >= 0),
  body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX notes_user_course_idx ON notes (user_id, course_id, created_at DESC, id DESC);

CREATE TABLE bookmarks (
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  item_id    text NOT NULL REFERENCES course_items (id) ON DELETE CASCADE,
  course_id  text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);

-- The wishlist on course cards.
CREATE TABLE saved_courses (
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id  text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);
CREATE INDEX saved_courses_user_idx ON saved_courses (user_id, created_at DESC);

CREATE TABLE certificates (
  id             text PRIMARY KEY,
  -- Public, printed and in the verify URL: "LMS-3F9K-Q2ZD-7M".
  serial         text NOT NULL UNIQUE,
  user_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id      text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  enrollment_id  text REFERENCES enrollments (id) ON DELETE SET NULL,
  -- Frozen at issue: renaming a course or a learner never changes an issued certificate.
  learner_name   text NOT NULL,
  course_title   text NOT NULL,
  instructor_names text[] NOT NULL DEFAULT '{}',
  pdf_key        text,
  issued_at      timestamptz(3) NOT NULL DEFAULT now(),
  revoked_at     timestamptz(3),
  revoked_reason text CHECK (length(revoked_reason) <= 300),
  revoked_by     text REFERENCES users (id) ON DELETE SET NULL,
  UNIQUE (user_id, course_id)
);
CREATE INDEX certificates_recent_idx ON certificates (issued_at DESC, id DESC);

-- ─── Community ──────────────────────────────────────────────────────────────

CREATE TABLE reviews (
  id          text PRIMARY KEY,
  course_id   text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        text CHECK (length(body) <= 4000),
  status      content_status NOT NULL DEFAULT 'PUBLISHED',
  reply       text CHECK (length(reply) <= 2000),
  replied_by  text REFERENCES users (id) ON DELETE SET NULL,
  replied_at  timestamptz(3),
  created_at  timestamptz(3) NOT NULL DEFAULT now(),
  updated_at  timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (course_id, user_id)
);
CREATE INDEX reviews_course_idx ON reviews (course_id, created_at DESC, id DESC) WHERE status = 'PUBLISHED';

CREATE TABLE qa_threads (
  id                text PRIMARY KEY,
  course_id         text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  item_id           text REFERENCES course_items (id) ON DELETE SET NULL,
  author_id         text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title             text NOT NULL CHECK (length(title) BETWEEN 3 AND 160),
  body              text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  status            content_status NOT NULL DEFAULT 'PUBLISHED',
  reply_count       integer NOT NULL DEFAULT 0,
  accepted_reply_id text,
  last_activity_at  timestamptz(3) NOT NULL DEFAULT now(),
  created_at        timestamptz(3) NOT NULL DEFAULT now(),
  updated_at        timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX qa_threads_course_idx ON qa_threads (course_id, last_activity_at DESC, id DESC) WHERE status = 'PUBLISHED';
CREATE INDEX qa_threads_item_idx ON qa_threads (item_id, last_activity_at DESC, id DESC) WHERE status = 'PUBLISHED';

CREATE TABLE qa_replies (
  id            text PRIMARY KEY,
  thread_id     text NOT NULL REFERENCES qa_threads (id) ON DELETE CASCADE,
  author_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  -- The author was on the course staff when they replied: shown with an instructor mark.
  is_staff      boolean NOT NULL DEFAULT false,
  status        content_status NOT NULL DEFAULT 'PUBLISHED',
  created_at    timestamptz(3) NOT NULL DEFAULT now(),
  updated_at    timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX qa_replies_thread_idx ON qa_replies (thread_id, created_at, id);
ALTER TABLE qa_threads ADD CONSTRAINT qa_threads_accepted_fk FOREIGN KEY (accepted_reply_id) REFERENCES qa_replies (id) ON DELETE SET NULL;

CREATE TABLE reports (
  id          text PRIMARY KEY,
  target_type report_target NOT NULL,
  target_id   text NOT NULL,
  course_id   text REFERENCES courses (id) ON DELETE CASCADE,
  reporter_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason      report_reason NOT NULL,
  note        text CHECK (length(note) <= 500),
  status      report_status NOT NULL DEFAULT 'OPEN',
  resolution  text,
  resolved_by text REFERENCES users (id) ON DELETE SET NULL,
  resolved_at timestamptz(3),
  created_at  timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_id, reporter_id)
);
CREATE INDEX reports_open_idx ON reports (created_at, id) WHERE status = 'OPEN';

-- ─── Notifications ──────────────────────────────────────────────────────────

CREATE TABLE notifications (
  id           text PRIMARY KEY,
  recipient_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  actor_id     text REFERENCES users (id) ON DELETE CASCADE,
  type         notification_type NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  snippet      text CHECK (length(snippet) <= 200),
  data         jsonb NOT NULL DEFAULT '{}',
  read_at      timestamptz(3),
  emailed_at   timestamptz(3),
  created_at   timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX notifications_inbox_idx ON notifications (recipient_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread_idx ON notifications (recipient_id) WHERE read_at IS NULL;

-- ─── Platform ───────────────────────────────────────────────────────────────

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by text REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          text PRIMARY KEY,
  actor_id    text REFERENCES users (id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  ip          inet,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_recent_idx ON audit_log (created_at DESC, id DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, created_at DESC);
