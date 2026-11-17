package catalog

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shopship/shop/api/internal/httpx"
)

// Read-only entry points for internal/assistant (Wave 3, additive). They run
// the exact public queries behind GET /products?q= and GET /products/:slug, so
// the bot sees what the public sees (list price + public flash price only).

// SearchCards runs the public catalog search (Thai ILIKE + trigram, relevance
// order) and returns at most limit cards (1..12).
func SearchCards(ctx context.Context, db *pgxpool.Pool, q string, limit int, now time.Time) ([]ProductCard, error) {
	q = strings.ToLower(strings.TrimSpace(q))
	if q == "" || utf8.RuneCountInString(q) > 100 {
		return []ProductCard{}, nil
	}
	if limit < 1 || limit > 12 {
		limit = 6
	}
	lq := listQuery{q: q, sort: "relevance", page: 1, perPage: limit}
	var cards []ProductCard
	err := httpx.InTx(ctx, db, func(tx pgx.Tx) error {
		ids, _, err := searchProducts(ctx, tx, lq, now)
		if err != nil {
			return err
		}
		cards, err = LoadCards(ctx, tx, ids, now, true)
		return err
	})
	return cards, err
}

// PublicProduct loads the public detail of an active product by slug
// (pgx.ErrNoRows when it is not public).
func PublicProduct(ctx context.Context, q httpx.Querier, slug string, now time.Time) (Product, error) {
	id, err := productIDBySlug(ctx, q, slug)
	if err != nil {
		return Product{}, err
	}
	return loadProductDetail(ctx, q, id, now, true)
}
