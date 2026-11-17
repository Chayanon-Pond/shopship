package testdb

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"os"
	"testing"

	"github.com/shopship/shop/api/migrations"
)

func TestMain(m *testing.M) { os.Exit(Main(m)) }

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// Every migration goes up on an empty DB, all the way down, and up again.
func TestMigrationsUpDownUp(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", DSN(t, false))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, dir := range []string{"up", "reset", "up"} {
		if err := migrations.Run(ctx, db, quiet(), dir); err != nil {
			t.Fatalf("migrate %s: %v", dir, err)
		}
	}
	var n int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name <> 'goose_db_version'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n < 30 {
		t.Fatalf("expected >= 30 tables, got %d", n)
	}
	t.Logf("%d tables after up/reset/up", n)
}

// Smoke-tests the triggers, guards and Thai trigram search on a migrated clone.
func TestSchemaSmoke(t *testing.T) {
	pool := New(t)
	ctx := context.Background()
	must := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	scalar := func(dst any, sql string, args ...any) {
		t.Helper()
		if err := pool.QueryRow(ctx, sql, args...).Scan(dst); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}

	must(`INSERT INTO categories (slug, name) VALUES ('fashion', 'แฟชั่น')`)
	must(`INSERT INTO categories (slug, name, parent_id) VALUES ('tshirts', 'เสื้อยืด', 1)`)
	if _, err := pool.Exec(ctx, `INSERT INTO categories (slug, name, parent_id) VALUES ('too-deep', 'x', 2)`); err == nil {
		t.Fatal("3rd category level must be rejected")
	}
	must(`INSERT INTO products (slug, name, category_id, status, tags) VALUES ('cotton-tee', 'เสื้อยืดคอตตอนสีขาว', 2, 'active', '{basic}')`)
	must(`INSERT INTO product_variants (product_id, sku, name, price_satang, stock) VALUES (1, 'TEE-W-M', 'ขาว / M', 39000, 3)`)
	must(`INSERT INTO product_variants (product_id, sku, name, price_satang, stock) VALUES (1, 'TEE-W-L', 'ขาว / L', 42000, 1)`)
	must(`UPDATE product_variants SET price_satang = 35000 WHERE id = 1`)

	var lo, hi int64
	if err := pool.QueryRow(ctx, `SELECT min_price_satang, max_price_satang FROM products WHERE id = 1`).Scan(&lo, &hi); err != nil {
		t.Fatal(err)
	}
	if lo != 35000 || hi != 42000 {
		t.Fatalf("price range = %d..%d", lo, hi)
	}
	var hist int
	scalar(&hist, `SELECT count(*) FROM price_history WHERE variant_id = 1`)
	if hist != 2 {
		t.Fatalf("price_history rows = %d, want 2", hist)
	}
	var lowest int64
	scalar(&lowest, `SELECT variant_lowest_price_30d(1, now() + interval '1 second')`)
	if lowest != 35000 {
		t.Fatalf("lowest_30d = %d", lowest)
	}

	// Thai fuzzy search (pg_trgm): substring and typo (ยืด -> ยึด).
	var hits int
	scalar(&hits, `SELECT count(*) FROM products WHERE search_text ILIKE '%' || $1 || '%'`, "คอตตอน")
	if hits != 1 {
		t.Fatalf("ILIKE Thai hits = %d", hits)
	}
	var ws float64
	scalar(&ws, `SELECT word_similarity($1, search_text) FROM products WHERE id = 1`, "เสื้อยึด")
	t.Logf("word_similarity(typo) = %.3f", ws)
	if ws < 0.3 {
		t.Fatalf("Thai typo word_similarity too low: %.3f", ws)
	}
	var skuHit int
	scalar(&skuHit, `SELECT count(*) FROM products WHERE search_text ILIKE '%tee-w-l%'`)
	if skuHit != 1 {
		t.Fatal("SKU not in search_text")
	}

	// Stock guard.
	tag, _ := pool.Exec(ctx, `UPDATE product_variants SET stock = stock - 5 WHERE id = 1 AND stock >= 5`)
	if tag.RowsAffected() != 0 {
		t.Fatal("stock oversell not guarded")
	}

	// Coupon usage limit guard.
	must(`INSERT INTO promotions (name, label, kind, layer, auto_apply, starts_at, percent_bp, usage_limit, status)
	      VALUES ('Songkran', 'โค้ดสงกรานต์ 10%', 'cart_percent', 4, false, now(), 1000, 1, 'active')`)
	must(`INSERT INTO coupon_codes (promotion_id, code) VALUES (1, 'SONGKRAN10')`)
	inc := `UPDATE promotions SET used_count = used_count + 1 WHERE id = 1 AND (usage_limit IS NULL OR used_count < usage_limit)`
	t1, _ := pool.Exec(ctx, inc)
	t2, _ := pool.Exec(ctx, inc)
	if t1.RowsAffected() != 1 || t2.RowsAffected() != 0 {
		t.Fatal("usage_limit guard failed")
	}
	if _, err := pool.Exec(ctx, `INSERT INTO promotions (name, label, kind, layer, auto_apply, starts_at, percent_bp)
	      VALUES ('bad', 'bad', 'cart_percent', 4, true, now(), 1000)`); err == nil {
		t.Fatal("layer-4 promotion with auto_apply must be rejected")
	}

	// Flash sale qty guard.
	must(`INSERT INTO flash_sales (name, starts_at, ends_at, status) VALUES ('11.11', now(), now() + interval '2 hours', 'active')`)
	must(`INSERT INTO flash_sale_items (flash_sale_id, variant_id, sale_price_satang, qty_limit) VALUES (1, 2, 29900, 2)`)
	f1, _ := pool.Exec(ctx, `UPDATE flash_sale_items SET sold_qty = sold_qty + 2 WHERE id = 1 AND sold_qty + 2 <= qty_limit`)
	f2, _ := pool.Exec(ctx, `UPDATE flash_sale_items SET sold_qty = sold_qty + 1 WHERE id = 1 AND sold_qty + 1 <= qty_limit`)
	if f1.RowsAffected() != 1 || f2.RowsAffected() != 0 {
		t.Fatal("flash sold_qty guard failed")
	}

	// Rating rollup.
	must(`INSERT INTO reviews (product_id, rating) VALUES (1, 5), (1, 4)`)
	var avg float64
	scalar(&avg, `SELECT rating_avg::float8 FROM products WHERE id = 1`)
	if avg != 4.5 {
		t.Fatalf("rating_avg = %v", avg)
	}
}
