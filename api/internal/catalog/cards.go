package catalog

import (
	"context"
	"time"

	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/promotions"
)

// Image is the public image shape.
type Image struct {
	ID     int64  `json:"id"`
	URL    string `json:"url"`
	Alt    string `json:"alt"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type CategoryRef struct {
	ID   int64  `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type FlashBadge struct {
	FlashSaleID     int64     `json:"flash_sale_id"`
	SalePriceSatang int64     `json:"sale_price_satang"`
	ListPriceSatang int64     `json:"list_price_satang"`
	EndsAt          time.Time `json:"ends_at"`
	RemainingQty    int       `json:"remaining_qty"`
	Lowest30dSatang *int64    `json:"lowest_30d_satang"`
}

// ProductCard is the public list shape (PUBLIC list price only).
type ProductCard struct {
	ID             int64       `json:"id"`
	Slug           string      `json:"slug"`
	Name           string      `json:"name"`
	NameEN         string      `json:"name_en,omitempty"`
	Subtitle       string      `json:"subtitle"`
	Brand          string      `json:"brand"`
	Image          *Image      `json:"image"`
	MinPriceSatang int64       `json:"min_price_satang"`
	MaxPriceSatang int64       `json:"max_price_satang"`
	Flash          *FlashBadge `json:"flash"`
	RatingAvg      float64     `json:"rating_avg"`
	RatingCount    int         `json:"rating_count"`
	SoldCount      int         `json:"sold_count"`
	InStock        bool        `json:"in_stock"`
	Badges         []string    `json:"badges"`
}

// StockLevel maps exact stock to the public level.
func StockLevel(stock, lowThreshold int) string {
	switch {
	case stock <= 0:
		return "out"
	case stock <= lowThreshold:
		return "low"
	}
	return "in_stock"
}

// LoadCards returns cards for ids in the same order (missing ids skipped).
// publicOnly restricts to active, non-deleted products.
func LoadCards(ctx context.Context, q httpx.Querier, ids []int64, now time.Time, publicOnly bool) ([]ProductCard, error) {
	out := []ProductCard{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT p.id, p.slug, p.name, p.name_en, p.subtitle, p.brand, p.min_price_satang, p.max_price_satang,
			p.rating_avg::float8, p.rating_count, p.sold_count,
			EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active AND v.stock > 0),
			img.id, img.url, img.alt, img.width, img.height
		FROM products p
		LEFT JOIN LATERAL (SELECT id, url, alt, width, height FROM product_images i WHERE i.product_id = p.id
			ORDER BY sort_order, id LIMIT 1) img ON true
		WHERE p.id = ANY($1) AND p.deleted_at IS NULL AND (NOT $2 OR p.status = 'active')`, ids, publicOnly)
	if err != nil {
		return nil, err
	}
	byID := map[int64]*ProductCard{}
	for rows.Next() {
		pc := &ProductCard{Badges: []string{}}
		var iid *int64
		var iurl, ialt *string
		var iw, ih *int
		if err := rows.Scan(&pc.ID, &pc.Slug, &pc.Name, &pc.NameEN, &pc.Subtitle, &pc.Brand, &pc.MinPriceSatang, &pc.MaxPriceSatang,
			&pc.RatingAvg, &pc.RatingCount, &pc.SoldCount, &pc.InStock, &iid, &iurl, &ialt, &iw, &ih); err != nil {
			rows.Close()
			return nil, err
		}
		if iid != nil {
			pc.Image = &Image{ID: *iid, URL: *iurl, Alt: *ialt, Width: *iw, Height: *ih}
		}
		byID[pc.ID] = pc
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Public flash badge + automatic-promotion badges come from promotions
	// (single source of truth for "who can get it").
	flash, err := promotions.FlashBadges(ctx, q, ids, now)
	if err != nil {
		return nil, err
	}
	badges, err := promotions.ProductBadges(ctx, q, ids, now)
	if err != nil {
		return nil, err
	}
	for id, pc := range byID {
		if f, ok := flash[id]; ok {
			fb := FlashBadge(f)
			pc.Flash = &fb
		}
		if b := badges[id]; len(b) > 0 {
			pc.Badges = append([]string{}, b...)
		}
	}

	for _, id := range ids {
		if pc := byID[id]; pc != nil {
			out = append(out, *pc)
		}
	}
	return out, nil
}
