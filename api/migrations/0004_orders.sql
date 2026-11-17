-- 0004_orders: carts, orders (+ items, adjustments, status history),
-- stock reservations, promotion redemptions, payments (+ webhook events),
-- shipments (+ events).

-- +goose Up

-- Guest carts: id in an httpOnly cookie (shopship_cart). On login the guest
-- cart is merged into the user's active cart and marked 'merged'.
CREATE TABLE carts (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     bigint      REFERENCES users (id) ON DELETE CASCADE,
    status      text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'converted', 'abandoned')),
    coupon_code text        NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX carts_one_active_per_user ON carts (user_id) WHERE status = 'active' AND user_id IS NOT NULL;
CREATE INDEX carts_updated_at_idx ON carts (updated_at) WHERE status = 'active';
CREATE TRIGGER carts_set_updated_at BEFORE UPDATE ON carts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cart_items (
    id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cart_id    uuid        NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
    variant_id bigint      NOT NULL REFERENCES product_variants (id) ON DELETE CASCADE,
    qty        integer     NOT NULL CHECK (qty BETWEEN 1 AND 999),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cart_items_cart_variant_key ON cart_items (cart_id, variant_id);
CREATE TRIGGER cart_items_set_updated_at BEFORE UPDATE ON cart_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Checkout requires login. Address and prices are snapshots; pricing_snapshot
-- holds the full Quote JSON the order was created from.
CREATE TABLE orders (
    id                       bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_no                 text        NOT NULL CHECK (order_no ~ '^SS[0-9]{6}[0-9A-Z]{4,8}$'),
    user_id                  bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    status                   text        NOT NULL DEFAULT 'pending_payment'
                                         CHECK (status IN ('pending_payment', 'paid', 'packing', 'shipped',
                                                           'delivered', 'completed', 'cancelled', 'refunded')),
    email                    text        NOT NULL,
    ship_name                text        NOT NULL,
    ship_phone               text        NOT NULL,
    ship_line1               text        NOT NULL,
    ship_line2               text        NOT NULL DEFAULT '',
    ship_subdistrict         text        NOT NULL,
    ship_district            text        NOT NULL,
    ship_province            text        NOT NULL,
    ship_postal_code         text        NOT NULL CHECK (ship_postal_code ~ '^[1-9][0-9]{4}$'),
    subtotal_satang          bigint      NOT NULL CHECK (subtotal_satang >= 0),       -- sum of line_total after layers 1-2
    discount_satang          bigint      NOT NULL DEFAULT 0 CHECK (discount_satang >= 0), -- cart-level (layers 3-4)
    shipping_fee_satang      bigint      NOT NULL DEFAULT 0 CHECK (shipping_fee_satang >= 0),
    shipping_discount_satang bigint      NOT NULL DEFAULT 0 CHECK (shipping_discount_satang BETWEEN 0 AND shipping_fee_satang),
    savings_satang           bigint      NOT NULL DEFAULT 0 CHECK (savings_satang >= 0),  -- everything vs list price
    grand_total_satang       bigint      NOT NULL CHECK (grand_total_satang >= 0),
    coupon_code              text        NOT NULL DEFAULT '',
    quote_hash               text        NOT NULL,
    pricing_snapshot         jsonb       NOT NULL,
    customer_note            text        NOT NULL DEFAULT '' CHECK (length(customer_note) <= 500),
    payment_method           text        NOT NULL CHECK (payment_method IN ('promptpay', 'card')),
    idempotency_key          text        NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
    payment_due_at           timestamptz NOT NULL,            -- = reservation expiry (15 min)
    paid_at                  timestamptz,
    cancelled_at             timestamptz,
    cancel_reason            text        NOT NULL DEFAULT '',
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    CHECK (grand_total_satang = subtotal_satang - discount_satang + shipping_fee_satang - shipping_discount_satang)
);
CREATE UNIQUE INDEX orders_order_no_key ON orders (order_no);
CREATE UNIQUE INDEX orders_user_idempotency_key ON orders (user_id, idempotency_key);
CREATE INDEX orders_user_id_created_idx ON orders (user_id, created_at DESC);
CREATE INDEX orders_status_created_idx ON orders (status, created_at DESC);
CREATE INDEX orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX orders_pending_due_idx ON orders (payment_due_at) WHERE status = 'pending_payment';
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE order_items (
    id                     bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id               bigint  NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    variant_id             bigint  REFERENCES product_variants (id) ON DELETE SET NULL,
    product_id             bigint  REFERENCES products (id) ON DELETE SET NULL,
    flash_sale_item_id     bigint  REFERENCES flash_sale_items (id) ON DELETE SET NULL,
    sku                    text    NOT NULL,
    product_name           text    NOT NULL,
    variant_name           text    NOT NULL DEFAULT '',
    image_url              text    NOT NULL DEFAULT '',
    qty                    integer NOT NULL CHECK (qty >= 1),
    list_unit_price_satang bigint  NOT NULL CHECK (list_unit_price_satang > 0),
    unit_price_satang      bigint  NOT NULL CHECK (unit_price_satang >= 0),          -- after layer 1
    price_source_kind      text    NOT NULL DEFAULT 'list'
                                   CHECK (price_source_kind IN ('list', 'flash_sale', 'quantity_break', 'group_price', 'tier_price')),
    price_source_label     text    NOT NULL DEFAULT '',
    line_discount_satang   bigint  NOT NULL DEFAULT 0 CHECK (line_discount_satang >= 0), -- layer 2
    line_total_satang      bigint  NOT NULL CHECK (line_total_satang >= 0),          -- qty*unit - line_discount
    allocated_discount_satang bigint NOT NULL DEFAULT 0 CHECK (allocated_discount_satang >= 0), -- layers 3-4 share (largest remainder)
    lowest_30d_satang      bigint  CHECK (lowest_30d_satang > 0),
    CHECK (line_total_satang = qty * unit_price_satang - line_discount_satang)
);
CREATE INDEX order_items_order_id_idx ON order_items (order_id);
CREATE INDEX order_items_variant_id_idx ON order_items (variant_id);
CREATE INDEX order_items_flash_sale_item_id_idx ON order_items (flash_sale_item_id) WHERE flash_sale_item_id IS NOT NULL;

-- One row per applied rule (labelled line items on the receipt).
CREATE TABLE order_adjustments (
    id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id      bigint      NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    order_item_id bigint      REFERENCES order_items (id) ON DELETE CASCADE,  -- set for layer-2 line adjustments
    promotion_id  bigint      REFERENCES promotions (id) ON DELETE SET NULL,
    layer         smallint    NOT NULL CHECK (layer BETWEEN 2 AND 5),
    coupon_code   text        NOT NULL DEFAULT '',
    label         text        NOT NULL,
    amount_satang bigint      NOT NULL CHECK (amount_satang > 0),             -- discount amount (positive)
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_adjustments_order_id_idx ON order_adjustments (order_id);
CREATE INDEX order_adjustments_promotion_id_idx ON order_adjustments (promotion_id);

CREATE TABLE order_status_history (
    id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id      bigint      NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    from_status   text        NOT NULL DEFAULT '',
    to_status     text        NOT NULL,
    actor_user_id bigint      REFERENCES users (id) ON DELETE SET NULL,   -- NULL = system (webhook, expiry job)
    note          text        NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_status_history_order_id_idx ON order_status_history (order_id, created_at);

-- Stock is decremented when the order is created (UPDATE ... WHERE stock >= qty)
-- and a 'held' reservation recorded. Payment -> 'committed'. Expiry/cancel ->
-- 'released' via UPDATE ... WHERE status = 'held' RETURNING (idempotent), and
-- only a returned row adds the stock (and flash sold_qty) back.
CREATE TABLE stock_reservations (
    id                 bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id           bigint      NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    variant_id         bigint      NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
    flash_sale_item_id bigint      REFERENCES flash_sale_items (id) ON DELETE RESTRICT,
    qty                integer     NOT NULL CHECK (qty >= 1),
    status             text        NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'committed', 'released')),
    expires_at         timestamptz NOT NULL,
    released_at        timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_reservations_order_id_idx ON stock_reservations (order_id);
CREATE INDEX stock_reservations_held_expiry_idx ON stock_reservations (expires_at) WHERE status = 'held';

-- Usage of a promotion by an order. used_count on promotions is bumped with
-- UPDATE ... SET used_count = used_count + 1 WHERE id = $1 AND
-- (usage_limit IS NULL OR used_count < usage_limit); 0 rows -> limit reached.
-- per_customer_limit counts rows WHERE status <> 'released'.
CREATE TABLE promotion_redemptions (
    id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    promotion_id   bigint      NOT NULL REFERENCES promotions (id) ON DELETE RESTRICT,
    coupon_code_id bigint      REFERENCES coupon_codes (id) ON DELETE SET NULL,
    order_id       bigint      NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    user_id        bigint      NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    amount_satang  bigint      NOT NULL DEFAULT 0 CHECK (amount_satang >= 0),
    status         text        NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'confirmed', 'released')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX promotion_redemptions_promo_order_key ON promotion_redemptions (promotion_id, order_id);
CREATE INDEX promotion_redemptions_promo_user_idx ON promotion_redemptions (promotion_id, user_id) WHERE status <> 'released';
CREATE TRIGGER promotion_redemptions_set_updated_at BEFORE UPDATE ON promotion_redemptions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Provider-agnostic charge (mock now, Omise later; same flow).
CREATE TABLE payments (
    id                 bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id           bigint      NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
    provider           text        NOT NULL CHECK (provider IN ('mock', 'omise')),
    method             text        NOT NULL CHECK (method IN ('promptpay', 'card')),
    provider_charge_id text        NOT NULL,
    status             text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'requires_action', 'successful', 'failed', 'expired', 'refunded')),
    amount_satang      bigint      NOT NULL CHECK (amount_satang > 0),
    currency           text        NOT NULL DEFAULT 'THB' CHECK (currency = 'THB'),
    qr_payload         text        NOT NULL DEFAULT '',   -- PromptPay EMVCo payload (render as QR)
    qr_image_url       text        NOT NULL DEFAULT '',
    authorize_uri      text        NOT NULL DEFAULT '',   -- card 3-D Secure step
    failure_code       text        NOT NULL DEFAULT '',
    failure_message    text        NOT NULL DEFAULT '',
    raw                jsonb       NOT NULL DEFAULT '{}',
    expires_at         timestamptz,
    paid_at            timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_provider_charge_key ON payments (provider, provider_charge_id);
CREATE INDEX payments_order_id_idx ON payments (order_id, created_at DESC);
CREATE UNIQUE INDEX payments_one_successful_per_order ON payments (order_id) WHERE status = 'successful';
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Webhook inbox: dedupe by (provider, event_id); processing is idempotent by
-- charge id (a charge already 'successful' is a no-op).
CREATE TABLE payment_webhook_events (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider     text        NOT NULL,
    event_id     text        NOT NULL,
    event_type   text        NOT NULL DEFAULT '',
    charge_id    text        NOT NULL DEFAULT '',
    payload      jsonb       NOT NULL,
    received_at  timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    error        text        NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX payment_webhook_events_key ON payment_webhook_events (provider, event_id);
CREATE INDEX payment_webhook_events_charge_idx ON payment_webhook_events (charge_id);

CREATE TABLE shipments (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id     bigint      NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
    carrier      text        NOT NULL CHECK (carrier IN ('flash_mock', 'flash')),
    tracking_no  text        NOT NULL,
    status       text        NOT NULL DEFAULT 'created'
                             CHECK (status IN ('created', 'picked_up', 'in_transit', 'out_for_delivery',
                                               'delivered', 'returned', 'cancelled')),
    label_url    text        NOT NULL DEFAULT '',
    fee_satang   bigint      NOT NULL DEFAULT 0 CHECK (fee_satang >= 0),
    weight_grams integer     NOT NULL DEFAULT 0 CHECK (weight_grams >= 0),
    raw          jsonb       NOT NULL DEFAULT '{}',
    created_by   bigint      REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX shipments_carrier_tracking_key ON shipments (carrier, tracking_no);
CREATE INDEX shipments_order_id_idx ON shipments (order_id);
CREATE TRIGGER shipments_set_updated_at BEFORE UPDATE ON shipments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE shipment_events (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shipment_id bigint      NOT NULL REFERENCES shipments (id) ON DELETE CASCADE,
    status      text        NOT NULL,
    description text        NOT NULL DEFAULT '',
    location    text        NOT NULL DEFAULT '',
    occurred_at timestamptz NOT NULL,
    raw         jsonb       NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX shipment_events_dedupe_key ON shipment_events (shipment_id, status, occurred_at);

-- +goose Down
DROP TABLE IF EXISTS shipment_events;
DROP TABLE IF EXISTS shipments;
DROP TABLE IF EXISTS payment_webhook_events;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS promotion_redemptions;
DROP TABLE IF EXISTS stock_reservations;
DROP TABLE IF EXISTS order_status_history;
DROP TABLE IF EXISTS order_adjustments;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS cart_items;
DROP TABLE IF EXISTS carts;
