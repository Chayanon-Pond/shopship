-- 0001_init: extensions, shared helpers, identity (customer groups, users,
-- sessions, one-time tokens, addresses).
--
-- Conventions for the whole schema (Wave 0, frozen):
--   * Primary keys: bigint identity (carts use uuid because the id lives in a
--     guest cookie and must be unguessable).
--   * Money: bigint *_satang (1 THB = 100 satang). Never numeric/float.
--   * Percentages: integer *_bp basis points (1000 = 10.00 %).
--   * Timestamps: timestamptz, updated_at maintained by set_updated_at().
--   * Enumerations: text + CHECK (cheap to extend in a later migration).

-- +goose Up

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Thai search needs trigrams from Thai text. pg_trgm extracts none when the
-- database ctype is C/POSIX (or the PG17 builtin C.UTF-8 provider), which
-- would silently break search. Fail loudly instead.
-- +goose StatementBegin
DO $$
BEGIN
    IF coalesce(array_length(show_trgm('ไทย'), 1), 0) = 0 THEN
        RAISE EXCEPTION 'pg_trgm yields no trigrams for Thai text (datctype=%). Create the database with a UTF-8 locale such as en_US.UTF-8.',
            (SELECT datctype FROM pg_database WHERE datname = current_database());
    END IF;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- Customer groups (e.g. "trade", "wholesale", "staff"); admin-assigned.
CREATE TABLE customer_groups (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text        NOT NULL CHECK (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name        text        NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    description text        NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customer_groups_code_key ON customer_groups (code);
CREATE TRIGGER customer_groups_set_updated_at BEFORE UPDATE ON customer_groups
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One table for customers and back-office staff. role decides access:
-- customer (storefront only) | staff | admin | owner (RBAC, see docs/API.md).
-- tier is admin-assigned (no automatic upgrades in MVP).
CREATE TABLE users (
    id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email             text        NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
    password_hash     text,                                  -- argon2id PHC string; NULL for Google-only accounts (later)
    google_sub        text,                                  -- deferred: Google sign-in
    name              text        NOT NULL DEFAULT '' CHECK (length(name) <= 200),
    phone             text        NOT NULL DEFAULT '' CHECK (length(phone) <= 32),
    role              text        NOT NULL DEFAULT 'customer'
                                  CHECK (role IN ('customer', 'staff', 'admin', 'owner')),
    group_id          bigint      REFERENCES customer_groups (id) ON DELETE SET NULL,
    tier              text        NOT NULL DEFAULT 'standard'
                                  CHECK (tier IN ('standard', 'silver', 'gold', 'platinum')),
    is_active         boolean     NOT NULL DEFAULT true,
    marketing_consent boolean     NOT NULL DEFAULT false,
    email_verified_at timestamptz,
    last_login_at     timestamptz,
    deleted_at        timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);
CREATE UNIQUE INDEX users_google_sub_key ON users (google_sub) WHERE google_sub IS NOT NULL;
CREATE INDEX users_group_id_idx ON users (group_id);
CREATE INDEX users_role_idx ON users (role) WHERE role <> 'customer';
CREATE INDEX users_created_at_idx ON users (created_at DESC);
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Opaque session token in an httpOnly cookie; only its SHA-256 is stored.
-- csrf_token is echoed by the client in X-CSRF-Token on every non-GET.
CREATE TABLE sessions (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash   bytea       NOT NULL,
    csrf_token   text        NOT NULL,
    ip           text        NOT NULL DEFAULT '',
    user_agent   text        NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL
);
CREATE UNIQUE INDEX sessions_token_hash_key ON sessions (token_hash);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- Single-use tokens (password reset, email verification, staff invite).
CREATE TABLE user_tokens (
    id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    purpose    text        NOT NULL CHECK (purpose IN ('password_reset', 'email_verify', 'staff_invite')),
    token_hash bytea       NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_tokens_token_hash_key ON user_tokens (token_hash);
CREATE INDEX user_tokens_user_id_idx ON user_tokens (user_id);

-- Address book. Thai address parts; postal code is 5 digits.
CREATE TABLE addresses (
    id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id        bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    label          text        NOT NULL DEFAULT '' CHECK (length(label) <= 50),
    recipient_name text        NOT NULL CHECK (length(recipient_name) BETWEEN 1 AND 200),
    phone          text        NOT NULL CHECK (length(phone) BETWEEN 9 AND 32),
    line1          text        NOT NULL CHECK (length(line1) BETWEEN 1 AND 300),
    line2          text        NOT NULL DEFAULT '' CHECK (length(line2) <= 300),
    subdistrict    text        NOT NULL CHECK (length(subdistrict) BETWEEN 1 AND 100),
    district       text        NOT NULL CHECK (length(district) BETWEEN 1 AND 100),
    province       text        NOT NULL CHECK (length(province) BETWEEN 1 AND 100),
    postal_code    text        NOT NULL CHECK (postal_code ~ '^[1-9][0-9]{4}$'),
    country        text        NOT NULL DEFAULT 'TH' CHECK (country = 'TH'),
    is_default     boolean     NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX addresses_user_id_idx ON addresses (user_id);
CREATE UNIQUE INDEX addresses_one_default_per_user ON addresses (user_id) WHERE is_default;
CREATE TRIGGER addresses_set_updated_at BEFORE UPDATE ON addresses
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TABLE IF EXISTS addresses;
DROP TABLE IF EXISTS user_tokens;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS customer_groups;
DROP FUNCTION IF EXISTS set_updated_at();
DROP EXTENSION IF EXISTS pg_trgm;
