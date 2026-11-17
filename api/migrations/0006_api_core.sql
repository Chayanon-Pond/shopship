-- 0006_api_core: Wave-1 api-core additions.
--   * products.name_en (approved additive contract change) + search_text includes it
--   * orders.idempotency_hash (POST /orders replay detection: same key + different body => 409)
--   * mock_provider_charges: state of the mock payment provider (stands in for Omise's side)

-- +goose Up

ALTER TABLE products ADD COLUMN name_en text NOT NULL DEFAULT '' CHECK (length(name_en) <= 200);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION products_build_search_text() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.search_text := lower(concat_ws(' ', NEW.name, NEW.name_en, NEW.subtitle, NEW.brand,
        array_to_string(NEW.tags, ' '),
        (SELECT string_agg(sku, ' ') FROM product_variants WHERE product_id = NEW.id)));
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

ALTER TABLE orders ADD COLUMN idempotency_hash text NOT NULL DEFAULT '';

-- The mock provider keeps its own charge records (what Omise would hold).
-- The API's payments table is our copy; webhooks re-fetch from here.
CREATE TABLE mock_provider_charges (
    id            text        PRIMARY KEY,
    order_no      text        NOT NULL,
    method        text        NOT NULL CHECK (method IN ('promptpay', 'card')),
    status        text        NOT NULL CHECK (status IN ('pending', 'requires_action', 'successful', 'failed', 'expired', 'refunded')),
    amount_satang bigint      NOT NULL CHECK (amount_satang > 0),
    card_token    text        NOT NULL DEFAULT '',
    return_uri    text        NOT NULL DEFAULT '',
    qr_payload    text        NOT NULL DEFAULT '',
    failure_code  text        NOT NULL DEFAULT '',
    failure_msg   text        NOT NULL DEFAULT '',
    refunded_satang bigint    NOT NULL DEFAULT 0,
    expires_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER mock_provider_charges_set_updated_at BEFORE UPDATE ON mock_provider_charges
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TABLE IF EXISTS mock_provider_charges;
ALTER TABLE orders DROP COLUMN IF EXISTS idempotency_hash;
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION products_build_search_text() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.search_text := lower(concat_ws(' ', NEW.name, NEW.subtitle, NEW.brand,
        array_to_string(NEW.tags, ' '),
        (SELECT string_agg(sku, ' ') FROM product_variants WHERE product_id = NEW.id)));
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
ALTER TABLE products DROP COLUMN IF EXISTS name_en;
