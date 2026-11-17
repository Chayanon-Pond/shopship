-- 0003_promotions: campaigns (seasonal theming), promotions + targets +
-- quantity-break tiers, coupon codes, flash sales.
--
-- Layers (see docs/API.md "Pricing"):
--   1 unit price  : quantity_break | group_price | tier_price  (+ flash_sale_items) — lowest wins, never stack
--   2 line promo  : buy_x_get_y  (one per line, flash lines excluded)
--   3 cart auto   : cart_percent | cart_amount with auto_apply  (single best)
--   4 code        : cart_percent | cart_amount | free_shipping with a coupon code (one per cart)
--   5 shipping    : free_shipping with auto_apply (one free-shipping rule)

-- +goose Up

CREATE TABLE campaigns (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug        text        NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name        text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    season_tag  text        NOT NULL DEFAULT '' CHECK (length(season_tag) <= 40),  -- songkran, 11-11, new-year
    -- theme: {"accent":"#0071E3","accent_contrast":"#FFFFFF","hero_image_url":"","badge_text":"","background":"#FFFFFF"}
    theme       jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(theme) = 'object'),
    starts_at   timestamptz NOT NULL,
    ends_at     timestamptz NOT NULL,
    priority    integer     NOT NULL DEFAULT 0,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);
CREATE UNIQUE INDEX campaigns_slug_key ON campaigns (slug);
CREATE INDEX campaigns_window_idx ON campaigns (starts_at, ends_at) WHERE is_active;
CREATE TRIGGER campaigns_set_updated_at BEFORE UPDATE ON campaigns
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE promotions (
    id                  bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),     -- admin name
    label               text        NOT NULL CHECK (length(label) BETWEEN 1 AND 120),    -- customer-facing line label (Thai)
    description         text        NOT NULL DEFAULT '',
    kind                text        NOT NULL CHECK (kind IN ('quantity_break', 'group_price', 'tier_price',
                                        'buy_x_get_y', 'cart_percent', 'cart_amount', 'free_shipping')),
    layer               smallint    NOT NULL CHECK (layer BETWEEN 1 AND 5),
    status              text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
    starts_at           timestamptz NOT NULL,
    ends_at             timestamptz,                         -- NULL = open-ended
    priority            integer     NOT NULL DEFAULT 0,      -- higher wins ties; then lower id
    exclusive           boolean     NOT NULL DEFAULT false,  -- layer-4 code that cannot combine with layer 3
    auto_apply          boolean     NOT NULL DEFAULT true,   -- false = needs a coupon code
    -- benefit parameters (which ones apply depends on kind; see CHECKs below)
    percent_bp          integer     CHECK (percent_bp BETWEEN 1 AND 10000),
    amount_satang       bigint      CHECK (amount_satang > 0),
    buy_qty             integer     CHECK (buy_qty >= 1),
    get_qty             integer     CHECK (get_qty >= 1),
    get_percent_bp      integer     CHECK (get_percent_bp BETWEEN 1 AND 10000),  -- 10000 = free
    -- conditions
    min_spend_satang    bigint      NOT NULL DEFAULT 0 CHECK (min_spend_satang >= 0),
    max_discount_satang bigint      CHECK (max_discount_satang > 0),
    usage_limit         integer     CHECK (usage_limit > 0),
    per_customer_limit  integer     CHECK (per_customer_limit > 0),
    used_count          integer     NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    -- audience: empty arrays = everyone (guests included unless requires_login)
    customer_group_ids  bigint[]    NOT NULL DEFAULT '{}',
    tiers               text[]      NOT NULL DEFAULT '{}' CHECK (tiers <@ ARRAY['standard','silver','gold','platinum']::text[]),
    -- seasonal campaign
    campaign_id         bigint      REFERENCES campaigns (id) ON DELETE SET NULL,
    season_tag          text        NOT NULL DEFAULT '',
    created_by          bigint      REFERENCES users (id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at IS NULL OR ends_at > starts_at),
    CHECK (usage_limit IS NULL OR used_count <= usage_limit),
    -- kind <-> layer <-> auto_apply
    CHECK (
        (kind IN ('quantity_break', 'group_price', 'tier_price') AND layer = 1 AND auto_apply)
     OR (kind = 'buy_x_get_y' AND layer = 2 AND auto_apply)
     OR (kind IN ('cart_percent', 'cart_amount') AND layer = 3 AND auto_apply)
     OR (kind IN ('cart_percent', 'cart_amount', 'free_shipping') AND layer = 4 AND NOT auto_apply)
     OR (kind = 'free_shipping' AND layer = 5 AND auto_apply)
    ),
    CHECK (exclusive = false OR layer = 4),
    -- required parameters per kind
    CHECK (kind <> 'group_price' OR (percent_bp IS NOT NULL AND cardinality(customer_group_ids) > 0)),
    CHECK (kind <> 'tier_price' OR (percent_bp IS NOT NULL AND cardinality(tiers) > 0)),
    CHECK (kind <> 'buy_x_get_y' OR (buy_qty IS NOT NULL AND get_qty IS NOT NULL AND get_percent_bp IS NOT NULL)),
    CHECK (kind <> 'cart_percent' OR percent_bp IS NOT NULL),
    CHECK (kind <> 'cart_amount' OR amount_satang IS NOT NULL)
);
CREATE INDEX promotions_active_window_idx ON promotions (layer, starts_at, ends_at) WHERE status = 'active';
CREATE INDEX promotions_campaign_id_idx ON promotions (campaign_id);
CREATE INDEX promotions_created_at_idx ON promotions (created_at DESC);
CREATE TRIGGER promotions_set_updated_at BEFORE UPDATE ON promotions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Trade tiers for kind = quantity_break: per-unit price by line quantity.
-- Exactly one of unit_price_satang / percent_bp.
CREATE TABLE promotion_qty_tiers (
    id                bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    promotion_id      bigint  NOT NULL REFERENCES promotions (id) ON DELETE CASCADE,
    min_qty           integer NOT NULL CHECK (min_qty >= 2),
    unit_price_satang bigint  CHECK (unit_price_satang > 0),
    percent_bp        integer CHECK (percent_bp BETWEEN 1 AND 10000),
    CHECK ((unit_price_satang IS NULL) <> (percent_bp IS NULL))
);
CREATE UNIQUE INDEX promotion_qty_tiers_key ON promotion_qty_tiers (promotion_id, min_qty);

-- Scope. No rows = the whole store. Exactly one of the ids matches target_type.
CREATE TABLE promotion_targets (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    promotion_id bigint NOT NULL REFERENCES promotions (id) ON DELETE CASCADE,
    target_type  text   NOT NULL CHECK (target_type IN ('category', 'product', 'variant')),
    category_id  bigint REFERENCES categories (id) ON DELETE CASCADE,
    product_id   bigint REFERENCES products (id) ON DELETE CASCADE,
    variant_id   bigint REFERENCES product_variants (id) ON DELETE CASCADE,
    CHECK (
        (target_type = 'category' AND category_id IS NOT NULL AND product_id IS NULL AND variant_id IS NULL)
     OR (target_type = 'product'  AND product_id  IS NOT NULL AND category_id IS NULL AND variant_id IS NULL)
     OR (target_type = 'variant'  AND variant_id  IS NOT NULL AND category_id IS NULL AND product_id IS NULL)
    )
);
CREATE INDEX promotion_targets_promotion_id_idx ON promotion_targets (promotion_id);
CREATE UNIQUE INDEX promotion_targets_uniq ON promotion_targets
    (promotion_id, target_type, coalesce(category_id, 0), coalesce(product_id, 0), coalesce(variant_id, 0));

-- Codes are stored upper-case; lookups upper() the input. A seasonal code is
-- simply a layer-4 promotion with a window (and usually a campaign_id).
CREATE TABLE coupon_codes (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    promotion_id bigint      NOT NULL REFERENCES promotions (id) ON DELETE CASCADE,
    code         text        NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
    is_active    boolean     NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX coupon_codes_code_key ON coupon_codes (code);
CREATE INDEX coupon_codes_promotion_id_idx ON coupon_codes (promotion_id);

CREATE TABLE flash_sales (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    label       text        NOT NULL DEFAULT 'Flash Sale' CHECK (length(label) BETWEEN 1 AND 120),
    status      text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
    starts_at   timestamptz NOT NULL,
    ends_at     timestamptz NOT NULL,
    campaign_id bigint      REFERENCES campaigns (id) ON DELETE SET NULL,
    created_by  bigint      REFERENCES users (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);
CREATE INDEX flash_sales_window_idx ON flash_sales (starts_at, ends_at) WHERE status = 'active';
CREATE TRIGGER flash_sales_set_updated_at BEFORE UPDATE ON flash_sales
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Oversell guard: UPDATE ... SET sold_qty = sold_qty + $q WHERE id = $id AND sold_qty + $q <= qty_limit.
-- The same variant must not be in two overlapping active flash sales (enforced by the admin API).
CREATE TABLE flash_sale_items (
    id                 bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    flash_sale_id      bigint      NOT NULL REFERENCES flash_sales (id) ON DELETE CASCADE,
    variant_id         bigint      NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
    sale_price_satang  bigint      NOT NULL CHECK (sale_price_satang > 0),
    qty_limit          integer     NOT NULL CHECK (qty_limit > 0),
    sold_qty           integer     NOT NULL DEFAULT 0 CHECK (sold_qty >= 0),
    per_customer_limit integer     CHECK (per_customer_limit > 0),
    sort_order         integer     NOT NULL DEFAULT 0,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CHECK (sold_qty <= qty_limit)
);
CREATE UNIQUE INDEX flash_sale_items_sale_variant_key ON flash_sale_items (flash_sale_id, variant_id);
CREATE INDEX flash_sale_items_variant_id_idx ON flash_sale_items (variant_id);

-- +goose Down
DROP TABLE IF EXISTS flash_sale_items;
DROP TABLE IF EXISTS flash_sales;
DROP TABLE IF EXISTS coupon_codes;
DROP TABLE IF EXISTS promotion_targets;
DROP TABLE IF EXISTS promotion_qty_tiers;
DROP TABLE IF EXISTS promotions;
DROP TABLE IF EXISTS campaigns;
