package demo

import (
	"bytes"
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shopship/shop/api/internal/platform"
)

// RepairMedia (re)writes the generated demo product images into storage and points their product_images rows at the
// storage's public URL. Use it when the demo catalog was seeded from another machine (files written to that machine's
// disk, URLs pointing at its PUBLIC_BASE_URL): run it on the server so the files land on the server's volume and the
// URLs use the server's PUBLIC_BASE_URL. Idempotent; only touches rows whose storage_key is a demo key it generated.
func RepairMedia(ctx context.Context, db *pgxpool.Pool, storage platform.Storage) (int, error) {
	parentOf := map[string]string{}
	for _, c := range categories {
		for _, ch := range c.children {
			parentOf[ch.slug] = c.slug
		}
	}
	n := 0
	for _, p := range products {
		key := "seed/products/" + p.slug + ".svg"
		u, err := storage.Put(ctx, key, "image/svg+xml", bytes.NewReader(productSVG(p, palette[parentOf[p.cat]])))
		if err != nil {
			return n, fmt.Errorf("image %s: %w", p.slug, err)
		}
		tag, err := db.Exec(ctx, `UPDATE product_images SET url = $1 WHERE storage_key = $2 AND url <> $1`, u, key)
		if err != nil {
			return n, fmt.Errorf("update %s: %w", p.slug, err)
		}
		n += int(tag.RowsAffected())
	}
	return n, nil
}
