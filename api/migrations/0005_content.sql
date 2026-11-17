-- 0005_content: reviews (+ images, rating rollup), banners, audit log.

-- +goose Up

-- Only buyers of a delivered/completed order item may review it (enforced by
-- the API; order_item_id is unique so one review per purchased line).
CREATE TABLE reviews (
    id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id    bigint      NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    variant_id    bigint      REFERENCES product_variants (id) ON DELETE SET NULL,
    order_item_id bigint      REFERENCES order_items (id) ON DELETE SET NULL,
    user_id       bigint      REFERENCES users (id) ON DELETE SET NULL,
    author_name   text        NOT NULL DEFAULT '',              -- display snapshot, e.g. "ส***a"
    rating        smallint    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title         text        NOT NULL DEFAULT '' CHECK (length(title) <= 120),
    body          text        NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
    status        text        NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
    reply_body    text        NOT NULL DEFAULT '' CHECK (length(reply_body) <= 4000),
    replied_at    timestamptz,
    replied_by    bigint      REFERENCES users (id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX reviews_order_item_key ON reviews (order_item_id) WHERE order_item_id IS NOT NULL;
CREATE INDEX reviews_product_published_idx ON reviews (product_id, created_at DESC) WHERE status = 'published';
CREATE INDEX reviews_created_at_idx ON reviews (created_at DESC);
CREATE TRIGGER reviews_set_updated_at BEFORE UPDATE ON reviews
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- products.rating_avg / rating_count from published reviews.
-- +goose StatementBegin
CREATE FUNCTION reviews_refresh_product_rating() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    pid bigint;
BEGIN
    FOREACH pid IN ARRAY (CASE TG_OP
            WHEN 'INSERT' THEN ARRAY[NEW.product_id]
            WHEN 'DELETE' THEN ARRAY[OLD.product_id]
            ELSE ARRAY[OLD.product_id, NEW.product_id] END)
    LOOP
        UPDATE products p
           SET rating_avg = coalesce(r.avg, 0), rating_count = coalesce(r.cnt, 0)
          FROM (SELECT round(avg(rating)::numeric, 2) AS avg, count(*)::int AS cnt
                  FROM reviews WHERE product_id = pid AND status = 'published') r
         WHERE p.id = pid;
    END LOOP;
    RETURN NULL;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER reviews_refresh_product_rating AFTER INSERT OR DELETE OR UPDATE OF rating, status, product_id ON reviews
    FOR EACH ROW EXECUTE FUNCTION reviews_refresh_product_rating();

CREATE TABLE review_images (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    review_id   bigint      NOT NULL REFERENCES reviews (id) ON DELETE CASCADE,
    storage_key text        NOT NULL,
    url         text        NOT NULL,
    width       integer     NOT NULL DEFAULT 0,
    height      integer     NOT NULL DEFAULT 0,
    sort_order  integer     NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_images_review_id_idx ON review_images (review_id, sort_order);

CREATE TABLE banners (
    id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    placement        text        NOT NULL DEFAULT 'home_hero' CHECK (placement IN ('home_hero', 'home_strip', 'category_top')),
    title            text        NOT NULL DEFAULT '' CHECK (length(title) <= 120),
    subtitle         text        NOT NULL DEFAULT '' CHECK (length(subtitle) <= 240),
    cta_label        text        NOT NULL DEFAULT '' CHECK (length(cta_label) <= 40),
    link_url         text        NOT NULL DEFAULT '' CHECK (link_url = '' OR link_url ~ '^(/|https://)'),
    image_url        text        NOT NULL,
    image_mobile_url text        NOT NULL DEFAULT '',
    image_alt        text        NOT NULL DEFAULT '',
    campaign_id      bigint      REFERENCES campaigns (id) ON DELETE SET NULL,
    category_id      bigint      REFERENCES categories (id) ON DELETE CASCADE,
    starts_at        timestamptz,
    ends_at          timestamptz,
    is_active        boolean     NOT NULL DEFAULT true,
    sort_order       integer     NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX banners_placement_idx ON banners (placement, sort_order) WHERE is_active;
CREATE TRIGGER banners_set_updated_at BEFORE UPDATE ON banners
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Back-office audit trail. action = "area.verb" (e.g. product.update,
-- promotion.create, order.status_change). metadata must never hold secrets.
CREATE TABLE audit_logs (
    id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id bigint      REFERENCES users (id) ON DELETE SET NULL,
    actor_email   text        NOT NULL DEFAULT '',     -- snapshot; '' = system
    action        text        NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),
    target_type   text        NOT NULL DEFAULT '',
    target_id     text        NOT NULL DEFAULT '',
    metadata      jsonb       NOT NULL DEFAULT '{}',
    ip            text        NOT NULL DEFAULT '',
    user_agent    text        NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_at_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id);

-- +goose Down
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS banners;
DROP TABLE IF EXISTS review_images;
DROP TABLE IF EXISTS reviews;
DROP FUNCTION IF EXISTS reviews_refresh_product_rating();
