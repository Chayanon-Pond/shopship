-- 0002_catalog: categories (2 levels), products, variants, images,
-- price_history (+ trigger), wishlist.

-- +goose Up

CREATE TABLE categories (
    id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    parent_id       bigint      REFERENCES categories (id) ON DELETE RESTRICT,
    slug            text        NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80),
    name            text        NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    description     text        NOT NULL DEFAULT '',
    image_url       text        NOT NULL DEFAULT '',
    icon            text        NOT NULL DEFAULT '',
    sort_order      integer     NOT NULL DEFAULT 0,
    is_active       boolean     NOT NULL DEFAULT true,
    seo_title       text        NOT NULL DEFAULT '',
    seo_description text        NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX categories_slug_key ON categories (slug);
CREATE INDEX categories_parent_id_idx ON categories (parent_id, sort_order);
CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Max depth 2: a parent must itself be top level, and a category that has
-- children cannot be moved under another one.
-- +goose StatementBegin
CREATE FUNCTION categories_enforce_depth() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.parent_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM categories WHERE id = NEW.parent_id AND parent_id IS NOT NULL) THEN
            RAISE EXCEPTION 'category depth exceeds 2 levels' USING ERRCODE = 'check_violation';
        END IF;
        IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM categories WHERE parent_id = NEW.id) THEN
            RAISE EXCEPTION 'category with children cannot become a child' USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER categories_enforce_depth BEFORE INSERT OR UPDATE OF parent_id ON categories
    FOR EACH ROW EXECUTE FUNCTION categories_enforce_depth();

-- options: [{"name":"สี","values":["ขาว","ดำ"]},{"name":"ไซซ์","values":["S","M"]}]
-- min/max_price_satang: list price range over ACTIVE variants (trigger-maintained;
-- used for list sort/filter and the public card "from ฿x").
-- search_text: lower-cased name/subtitle/brand/tags/SKUs for pg_trgm (trigger).
CREATE TABLE products (
    id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug             text        NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 120),
    name             text        NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    subtitle         text        NOT NULL DEFAULT '' CHECK (length(subtitle) <= 300),
    description      text        NOT NULL DEFAULT '',     -- markdown
    category_id      bigint      NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
    brand            text        NOT NULL DEFAULT '' CHECK (length(brand) <= 100),
    status           text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'hidden', 'archived')),
    featured         boolean     NOT NULL DEFAULT false,
    tags             text[]      NOT NULL DEFAULT '{}',
    options          jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(options) = 'array'),
    min_price_satang bigint      NOT NULL DEFAULT 0 CHECK (min_price_satang >= 0),
    max_price_satang bigint      NOT NULL DEFAULT 0 CHECK (max_price_satang >= min_price_satang),
    rating_avg       numeric(3,2) NOT NULL DEFAULT 0 CHECK (rating_avg BETWEEN 0 AND 5),
    rating_count     integer     NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
    sold_count       integer     NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
    search_text      text        NOT NULL DEFAULT '',
    seo_title        text        NOT NULL DEFAULT '',
    seo_description  text        NOT NULL DEFAULT '',
    published_at     timestamptz,
    deleted_at       timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX products_slug_key ON products (slug) WHERE deleted_at IS NULL;
CREATE INDEX products_category_id_idx ON products (category_id) WHERE deleted_at IS NULL;
CREATE INDEX products_status_published_idx ON products (status, published_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX products_min_price_idx ON products (min_price_satang) WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX products_sold_count_idx ON products (sold_count DESC) WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX products_rating_idx ON products (rating_avg DESC) WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX products_tags_idx ON products USING gin (tags);
-- Thai/English fuzzy search: supports ILIKE '%q%', %, <%, similarity().
CREATE INDEX products_search_trgm_idx ON products USING gin (search_text gin_trgm_ops);
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_variants (
    id                  bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id          bigint      NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    sku                 text        NOT NULL CHECK (sku ~ '^[A-Za-z0-9._-]{1,64}$'),
    name                text        NOT NULL DEFAULT '' CHECK (length(name) <= 200),  -- "ขาว / M"
    option_values       jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(option_values) = 'object'),
    price_satang        bigint      NOT NULL CHECK (price_satang > 0),
    cost_satang         bigint      CHECK (cost_satang >= 0),
    stock               integer     NOT NULL DEFAULT 0 CHECK (stock >= 0),   -- sellable now (reservations already deducted)
    low_stock_threshold integer     NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
    weight_grams        integer     NOT NULL DEFAULT 0 CHECK (weight_grams >= 0),
    barcode             text        NOT NULL DEFAULT '',
    is_active           boolean     NOT NULL DEFAULT true,
    sort_order          integer     NOT NULL DEFAULT 0,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_variants_sku_key ON product_variants (lower(sku));
CREATE INDEX product_variants_product_id_idx ON product_variants (product_id, sort_order);
CREATE INDEX product_variants_low_stock_idx ON product_variants (stock) WHERE is_active AND stock <= low_stock_threshold;
CREATE TRIGGER product_variants_set_updated_at BEFORE UPDATE ON product_variants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_images (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id  bigint      NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    variant_id  bigint      REFERENCES product_variants (id) ON DELETE SET NULL,
    storage_key text        NOT NULL,
    url         text        NOT NULL,
    alt         text        NOT NULL DEFAULT '' CHECK (length(alt) <= 300),
    width       integer     NOT NULL DEFAULT 0 CHECK (width >= 0),
    height      integer     NOT NULL DEFAULT 0 CHECK (height >= 0),
    sort_order  integer     NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_images_product_id_idx ON product_images (product_id, sort_order);

-- Every list-price change of a variant (insert included). Source of the
-- "lowest price in the 30 days before the promotion start" strike-through.
CREATE TABLE price_history (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    variant_id   bigint      NOT NULL REFERENCES product_variants (id) ON DELETE CASCADE,
    price_satang bigint      NOT NULL CHECK (price_satang > 0),
    changed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX price_history_variant_changed_idx ON price_history (variant_id, changed_at DESC);

-- +goose StatementBegin
CREATE FUNCTION product_variants_record_price() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' OR NEW.price_satang IS DISTINCT FROM OLD.price_satang THEN
        INSERT INTO price_history (variant_id, price_satang) VALUES (NEW.id, NEW.price_satang);
    END IF;
    RETURN NULL;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER product_variants_record_price AFTER INSERT OR UPDATE OF price_satang ON product_variants
    FOR EACH ROW EXECUTE FUNCTION product_variants_record_price();

-- Lowest list price of a variant during the 30 days before p_before (the
-- price in effect at the window start counts). NULL when no history.
-- +goose StatementBegin
CREATE FUNCTION variant_lowest_price_30d(p_variant_id bigint, p_before timestamptz) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT min(price_satang) FROM (
        (SELECT price_satang FROM price_history
          WHERE variant_id = p_variant_id AND changed_at <= p_before - interval '30 days'
          ORDER BY changed_at DESC LIMIT 1)
        UNION ALL
        SELECT price_satang FROM price_history
         WHERE variant_id = p_variant_id
           AND changed_at > p_before - interval '30 days' AND changed_at < p_before
    ) s;
$$;
-- +goose StatementEnd

-- Keep products.min/max_price_satang in sync with active variants.
-- +goose StatementBegin
CREATE FUNCTION products_refresh_price_range(p_product_id bigint) RETURNS void
LANGUAGE sql AS $$
    UPDATE products p
       SET min_price_satang = coalesce(r.lo, 0), max_price_satang = coalesce(r.hi, 0)
      FROM (SELECT min(price_satang) AS lo, max(price_satang) AS hi
              FROM product_variants WHERE product_id = p_product_id AND is_active) r
     WHERE p.id = p_product_id
       AND (p.min_price_satang, p.max_price_satang) IS DISTINCT FROM (coalesce(r.lo, 0), coalesce(r.hi, 0));
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION product_variants_sync_product() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM products_refresh_price_range(OLD.product_id);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.product_id <> OLD.product_id
            OR NEW.price_satang <> OLD.price_satang OR NEW.is_active <> OLD.is_active OR NEW.sku <> OLD.sku) THEN
        PERFORM products_refresh_price_range(NEW.product_id);
        -- touch the product so its search_text trigger re-reads SKUs
        UPDATE products SET search_text = search_text WHERE id = NEW.product_id;
    END IF;
    RETURN NULL;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER product_variants_sync_product AFTER INSERT OR UPDATE OR DELETE ON product_variants
    FOR EACH ROW EXECUTE FUNCTION product_variants_sync_product();

-- +goose StatementBegin
CREATE FUNCTION products_build_search_text() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.search_text := lower(concat_ws(' ', NEW.name, NEW.subtitle, NEW.brand,
        array_to_string(NEW.tags, ' '),
        (SELECT string_agg(sku, ' ') FROM product_variants WHERE product_id = NEW.id)));
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER products_build_search_text BEFORE INSERT OR UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION products_build_search_text();

CREATE TABLE wishlist_items (
    user_id    bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    product_id bigint      NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, product_id)
);
CREATE INDEX wishlist_items_product_id_idx ON wishlist_items (product_id);

-- +goose Down
DROP TABLE IF EXISTS wishlist_items;
DROP TABLE IF EXISTS price_history;
DROP TABLE IF EXISTS product_images;
DROP TABLE IF EXISTS product_variants;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP FUNCTION IF EXISTS product_variants_sync_product();
DROP FUNCTION IF EXISTS products_refresh_price_range(bigint);
DROP FUNCTION IF EXISTS variant_lowest_price_30d(bigint, timestamptz);
DROP FUNCTION IF EXISTS product_variants_record_price();
DROP FUNCTION IF EXISTS products_build_search_text();
DROP FUNCTION IF EXISTS categories_enforce_depth();
