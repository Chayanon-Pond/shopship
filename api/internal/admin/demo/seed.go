// Package demo seeds a realistic Thai demo shop (server seed-demo):
// 8 categories (2 levels), ~60 products with variants, locally generated SVG
// placeholder images (no downloads, no brand assets), reviews, demo users and
// addresses, then the promotions demo data when that seeder is available.
//
// Owner: Wave-1 "api-core".
package demo

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"log/slog"
	"math/rand/v2"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/platform"
)

// User is a demo login (passwords are documented in docs/DEMO.md).
type User struct {
	Email, Password, Name, Phone, Role, Tier, Group string
}

// Users are the demo accounts.
var Users = []User{
	{"owner@shopship.local", "Demo-Owner-2026", "สมหญิง เจ้าของร้าน", "0811111111", auth.RoleOwner, "standard", ""},
	{"admin@shopship.local", "Demo-Admin-2026", "อนันต์ ผู้ดูแล", "0822222222", auth.RoleAdmin, "standard", ""},
	{"staff@shopship.local", "Demo-Staff-2026", "วิภา แพ็กของ", "0833333333", auth.RoleStaff, "standard", ""},
	{"customer@shopship.local", "Demo-Customer-2026", "สมชาย ใจดี", "0812345678", auth.RoleCustomer, "standard", ""},
	{"wholesale@shopship.local", "Demo-Wholesale-2026", "ร้านมานะพาณิชย์", "0898765432", auth.RoleCustomer, "standard", "wholesale"},
	{"gold@shopship.local", "Demo-Gold-2026", "กานดา สมาชิกทอง", "0861234567", auth.RoleCustomer, "gold", ""},
}

// PromotionsSeeder is set to promotions.SeedDemo once the promotions
// package provides it (seam: api-core must not hard-depend on a symbol that
// may not exist yet). It runs after the catalog and users exist.
var PromotionsSeeder func(ctx context.Context, db *pgxpool.Pool, now time.Time) error

// Options for Seed.
type Options struct {
	Now     time.Time
	Storage platform.Storage
	Log     *slog.Logger
}

// Seed fills an empty database. It is a no-op (returns false) when the demo
// catalog already exists.
func Seed(ctx context.Context, db *pgxpool.Pool, opt Options) (bool, error) {
	if opt.Now.IsZero() {
		opt.Now = time.Now()
	}
	if opt.Log == nil {
		opt.Log = slog.Default()
	}
	var exists bool
	if err := db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM categories WHERE slug = 'fashion')`).Scan(&exists); err != nil {
		return false, err
	}
	if exists {
		opt.Log.Info("demo data already present; skipping")
		return false, nil
	}
	rng := rand.New(rand.NewPCG(2026, 1117))
	tx, err := db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	catIDs, err := seedCategories(ctx, tx)
	if err != nil {
		return false, fmt.Errorf("categories: %w", err)
	}
	userIDs, err := seedUsers(ctx, tx)
	if err != nil {
		return false, fmt.Errorf("users: %w", err)
	}
	if err := seedProducts(ctx, tx, opt, rng, catIDs, userIDs); err != nil {
		return false, fmt.Errorf("products: %w", err)
	}
	if err := seedBanners(ctx, tx); err != nil {
		return false, fmt.Errorf("banners: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	if PromotionsSeeder != nil {
		if err := PromotionsSeeder(ctx, db, opt.Now); err != nil {
			return true, fmt.Errorf("promotions demo: %w", err)
		}
	} else {
		opt.Log.Warn("promotions demo seeder not available yet; catalog and users seeded without promotions")
	}
	return true, nil
}

func seedCategories(ctx context.Context, tx pgx.Tx) (map[string]int64, error) {
	ids := map[string]int64{}
	for i, c := range categories {
		var id int64
		if err := tx.QueryRow(ctx, `INSERT INTO categories (slug, name, icon, sort_order, description, seo_title)
			VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, c.slug, c.name, c.icon, i+1, "รวมสินค้า"+c.name+"คัดสรรคุณภาพ",
			c.name+" | ShopShip").Scan(&id); err != nil {
			return nil, err
		}
		ids[c.slug] = id
		for j, ch := range c.children {
			var cid int64
			if err := tx.QueryRow(ctx, `INSERT INTO categories (slug, name, icon, sort_order, parent_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
				ch.slug, ch.name, ch.icon, j+1, id).Scan(&cid); err != nil {
				return nil, err
			}
			ids[ch.slug] = cid
		}
	}
	return ids, nil
}

func seedUsers(ctx context.Context, tx pgx.Tx) (map[string]int64, error) {
	var groupID int64
	if err := tx.QueryRow(ctx, `INSERT INTO customer_groups (code, name, description) VALUES ('wholesale', 'ลูกค้าขายส่ง', 'ร้านค้าที่ซื้อจำนวนมาก')
		ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`).Scan(&groupID); err != nil {
		return nil, err
	}
	ids := map[string]int64{}
	for _, u := range Users {
		hash, err := auth.HashPassword(u.Password)
		if err != nil {
			return nil, err
		}
		var gid *int64
		if u.Group == "wholesale" {
			gid = &groupID
		}
		var id int64
		if err := tx.QueryRow(ctx, `INSERT INTO users (email, password_hash, name, phone, role, tier, group_id, email_verified_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, now())
			ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role RETURNING id`,
			u.Email, hash, u.Name, u.Phone, u.Role, u.Tier, gid).Scan(&id); err != nil {
			return nil, err
		}
		ids[u.Email] = id
		if u.Role == auth.RoleCustomer {
			if _, err := tx.Exec(ctx, `INSERT INTO addresses (user_id, label, recipient_name, phone, line1, subdistrict, district, province, postal_code, is_default)
				VALUES ($1, 'บ้าน', $2, $3, '99/9 ซอยสุขุมวิท 50', 'พระโขนง', 'คลองเตย', 'กรุงเทพมหานคร', '10110', true)`, id, u.Name, u.Phone); err != nil {
				return nil, err
			}
		}
	}
	return ids, nil
}

type option struct {
	Name   string   `json:"name"`
	Values []string `json:"values"`
}

func parseOpts(s string) []option {
	out := []option{}
	if s == "" {
		return out
	}
	for _, part := range strings.Split(s, "|") {
		kv := strings.SplitN(part, "=", 2)
		out = append(out, option{Name: kv[0], Values: strings.Split(kv[1], ",")})
	}
	return out
}

// combos returns the cartesian product of option values.
func combos(opts []option) []map[string]string {
	res := []map[string]string{{}}
	for _, o := range opts {
		var next []map[string]string
		for _, r := range res {
			for _, v := range o.Values {
				m := map[string]string{}
				for k, x := range r {
					m[k] = x
				}
				m[o.Name] = v
				next = append(next, m)
			}
		}
		res = next
	}
	return res
}

func skuPart(s string, i int) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(s) {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return fmt.Sprintf("V%d", i+1)
	}
	out := b.String()
	if len(out) > 4 {
		out = out[:4]
	}
	return out
}

func skuBase(slug string) string {
	parts := strings.Split(slug, "-")
	var b strings.Builder
	for _, p := range parts {
		if len(p) > 3 {
			p = p[:3]
		}
		b.WriteString(strings.ToUpper(p))
	}
	s := b.String()
	if len(s) > 12 {
		s = s[:12]
	}
	return s
}

func seedProducts(ctx context.Context, tx pgx.Tx, opt Options, rng *rand.Rand, catIDs, userIDs map[string]int64) error {
	parentOf := map[string]string{}
	for _, c := range categories {
		for _, ch := range c.children {
			parentOf[ch.slug] = c.slug
		}
	}
	customerIDs := []int64{userIDs["customer@shopship.local"], userIDs["gold@shopship.local"], userIDs["wholesale@shopship.local"]}
	for pi, p := range products {
		opts := parseOpts(p.opts)
		optsB, _ := json.Marshal(opts)
		parent := parentOf[p.cat]
		desc := fmt.Sprintf("%s\n\n%s จากแบรนด์ %s คัดสรรคุณภาพโดยทีม ShopShip\n\n- %s\n- จัดส่งจากกรุงเทพฯ ภายใน 1-2 วันทำการ\n- เปลี่ยน/คืนสินค้าได้ภายใน 7 วัน",
			p.subtitle, p.name, p.brand, p.nameEN)
		tags := strings.Split(p.tags, ",")
		published := opt.Now.Add(-time.Duration(pi*9+3) * time.Hour)
		featured := pi%7 == 0
		var pid int64
		if err := tx.QueryRow(ctx, `INSERT INTO products (slug, name, name_en, subtitle, description, category_id, brand, status, featured,
				tags, options, sold_count, published_at, seo_description)
			VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $10, $11, $12, $13) RETURNING id`,
			p.slug, p.name, p.nameEN, p.subtitle, desc, catIDs[p.cat], p.brand, featured, tags, optsB,
			rng.IntN(3000), published, p.subtitle+" สั่งซื้อออนไลน์ที่ ShopShip").Scan(&pid); err != nil {
			return fmt.Errorf("%s: %w", p.slug, err)
		}
		// image (generated locally)
		pal := palette[parent]
		imgURL := "/mock/" + p.slug + ".svg"
		key := "seed/products/" + p.slug + ".svg"
		if opt.Storage != nil {
			u, err := opt.Storage.Put(ctx, key, "image/svg+xml", bytes.NewReader(productSVG(p, pal)))
			if err != nil {
				return fmt.Errorf("image %s: %w", p.slug, err)
			}
			imgURL = u
		}
		if _, err := tx.Exec(ctx, `INSERT INTO product_images (product_id, storage_key, url, alt, width, height, sort_order)
			VALUES ($1, $2, $3, $4, 800, 800, 0)`, pid, key, imgURL, p.name); err != nil {
			return err
		}
		// variants
		base := p.price * 100
		for vi, combo := range combos(opts) {
			names := []string{}
			skuParts := []string{skuBase(p.slug)}
			price := base
			for oi, o := range opts {
				v := combo[o.Name]
				names = append(names, v)
				skuParts = append(skuParts, skuPart(v, indexOf(o.Values, v)))
				// bigger sizes / packs cost a bit more
				if idx := indexOf(o.Values, v); oi == 0 && idx > 0 && isSizeLike(o.Name) {
					price += int64(idx) * base / 5 / 100 * 100
				}
			}
			stock := 5 + rng.IntN(120)
			if rng.IntN(10) == 0 {
				stock = rng.IntN(4) // a few low/out of stock
			}
			ov, _ := json.Marshal(combo)
			name := strings.Join(names, " / ")
			sku := strings.Join(skuParts, "-")
			if len(opts) == 0 {
				sku = skuBase(p.slug) + "-STD"
			}
			if _, err := tx.Exec(ctx, `INSERT INTO product_variants (product_id, sku, name, option_values, price_satang, cost_satang, stock,
					low_stock_threshold, weight_grams, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, 5, $8, $9)`,
				pid, sku, name, ov, price, price*55/100, stock, p.weight, vi); err != nil {
				return fmt.Errorf("variant %s: %w", sku, err)
			}
		}
		// reviews
		n := rng.IntN(9)
		for r := 0; r < n; r++ {
			rating := 5
			switch x := rng.IntN(20); {
			case x < 1:
				rating = 2
			case x < 3:
				rating = 3
			case x < 8:
				rating = 4
			}
			pool := reviewPool[rating]
			rv := pool[rng.IntN(len(pool))]
			var uid *int64
			if r < len(customerIDs) {
				uid = &customerIDs[r]
			}
			created := opt.Now.Add(-time.Duration(rng.IntN(60*24)+1) * time.Hour)
			reply, replied := "", (*time.Time)(nil)
			if rating <= 3 {
				reply = "ขออภัยในความไม่สะดวกค่ะ ทางร้านจะปรับปรุงให้ดีขึ้น ติดต่อแชทร้านได้ตลอดนะคะ"
				t := created.Add(3 * time.Hour)
				replied = &t
			}
			if _, err := tx.Exec(ctx, `INSERT INTO reviews (product_id, user_id, author_name, rating, title, body, created_at, reply_body, replied_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, pid, uid, reviewerNames[rng.IntN(len(reviewerNames))], rating,
				rv.title, rv.body, created, reply, replied); err != nil {
				return err
			}
		}
	}
	// Strike-through needs history: pretend list prices were set 45 days ago.
	_, err := tx.Exec(ctx, `UPDATE price_history SET changed_at = $1`, opt.Now.Add(-45*24*time.Hour))
	return err
}

func indexOf(vs []string, v string) int {
	for i, x := range vs {
		if x == v {
			return i
		}
	}
	return -1
}

func isSizeLike(name string) bool {
	return name == "ขนาด" || name == "ความยาว"
}

func seedBanners(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `INSERT INTO banners (placement, title, subtitle, cta_label, link_url, image_url, image_alt, sort_order) VALUES
		('home_hero', 'ของดีทั่วไทย ส่งไวถึงบ้าน', 'คัดสรรสินค้าคุณภาพจากแบรนด์ไทย', 'ช้อปเลย', '/c/fashion', '/mock/hero-1111.svg', 'ShopShip', 1),
		('home_hero', 'แกดเจ็ตใหม่ล่าสุด', 'หูฟัง ลำโพง สมาร์ทวอทช์ ราคาพิเศษ', 'ดูสินค้า', '/c/gadgets', '/mock/hero-songkran.svg', 'แกดเจ็ต', 2),
		('home_strip', 'ส่งฟรีเมื่อช้อปครบ ฿990', '', '', '/search', '/mock/hero-1111.svg', 'ส่งฟรี', 1)`)
	return err
}

func productSVG(p prodDef, pal [2]string) []byte {
	bg, fg := pal[0], pal[1]
	if bg == "" {
		bg, fg = "#F5F5F7", "#333333"
	}
	initials := ""
	for _, w := range strings.Fields(p.nameEN) {
		if len(initials) < 2 && w[0] >= 'A' && w[0] <= 'Z' {
			initials += w[:1]
		}
	}
	e := html.EscapeString
	svg := `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
<rect width="800" height="800" fill="` + bg + `"/>
<circle cx="400" cy="330" r="190" fill="` + fg + `" opacity="0.14"/>
<circle cx="400" cy="330" r="130" fill="` + fg + `" opacity="0.22"/>
<text x="400" y="372" font-family="Inter, Arial, sans-serif" font-size="120" font-weight="700" fill="` + fg + `" text-anchor="middle">` + e(initials) + `</text>
<text x="400" y="600" font-family="'IBM Plex Sans Thai', Tahoma, sans-serif" font-size="42" font-weight="600" fill="` + fg + `" text-anchor="middle">` + e(p.name) + `</text>
<text x="400" y="655" font-family="Inter, Arial, sans-serif" font-size="30" fill="` + fg + `" opacity="0.75" text-anchor="middle">` + e(p.nameEN) + `</text>
<text x="400" y="740" font-family="Inter, Arial, sans-serif" font-size="22" fill="` + fg + `" opacity="0.5" text-anchor="middle">ShopShip demo image</text>
</svg>`
	return []byte(svg)
}
