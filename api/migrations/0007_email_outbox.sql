-- 0007_email_outbox: transactional email outbox (Wave 3).
--   * A row is written in the SAME transaction as the state change that
--     triggers it (order placed/paid/shipped/delivered/cancelled, refund,
--     registration). The worker (email.RunOutbox, started by `server serve`)
--     renders the mail from current data, sends it and marks the row.
--   * dedupe_key makes every event idempotent, e.g. 'order:42:payment_received'.
--   * next_attempt_at doubles as the worker's lease: a claimed row is pushed a
--     few minutes ahead, so a crashed worker's row is retried later.
--   * Password-reset mail is NOT stored here (it carries a raw token); it is
--     sent synchronously.

-- +goose Up
CREATE TABLE email_outbox (
    id                  bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind                text        NOT NULL CHECK (length(kind) BETWEEN 1 AND 50),
    dedupe_key          text        NOT NULL UNIQUE CHECK (length(dedupe_key) BETWEEN 1 AND 200),
    to_email            text        NOT NULL CHECK (length(to_email) BETWEEN 3 AND 254),
    user_id             bigint      REFERENCES users (id) ON DELETE SET NULL,
    order_id            bigint      REFERENCES orders (id) ON DELETE CASCADE,
    payload             jsonb       NOT NULL DEFAULT '{}',
    status              text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    attempts            integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts        integer     NOT NULL DEFAULT 8 CHECK (max_attempts >= 1),
    next_attempt_at     timestamptz NOT NULL DEFAULT now(),
    last_error          text        NOT NULL DEFAULT '',
    provider_message_id text        NOT NULL DEFAULT '',
    sent_at             timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_outbox_due ON email_outbox (next_attempt_at, id) WHERE status = 'pending';
CREATE INDEX email_outbox_order ON email_outbox (order_id) WHERE order_id IS NOT NULL;
CREATE TRIGGER email_outbox_set_updated_at BEFORE UPDATE ON email_outbox
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TABLE IF EXISTS email_outbox;
