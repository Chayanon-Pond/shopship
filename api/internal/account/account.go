// Package account: the signed-in customer's address book and wishlist.
//
// Owner: Wave-1 "api-core". Routes are the frozen contract (docs/API.md).
package account

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/catalog"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/platform"
)

const maxAddresses = 10

type handler struct{ d *platform.Deps }

func Register(rt platform.Routes, d *platform.Deps) {
	h := &handler{d: d}
	me := rt.V1.Group("/me", auth.RequireUser(), httpx.NeedDB(d.DB), func(c *gin.Context) { httpx.NoStore(c); c.Next() })
	me.GET("/addresses", h.listAddresses)
	me.POST("/addresses", h.createAddress)
	me.PATCH("/addresses/:id", h.patchAddress)
	me.DELETE("/addresses/:id", h.deleteAddress)
	me.POST("/addresses/:id/default", h.makeDefault)
	me.GET("/wishlist", h.wishlist)
	me.PUT("/wishlist/:product_id", h.addWish)
	me.DELETE("/wishlist/:product_id", h.removeWish)
}

// Address is the address-book shape.
type Address struct {
	ID            int64  `json:"id"`
	Label         string `json:"label"`
	RecipientName string `json:"recipient_name"`
	Phone         string `json:"phone"`
	Line1         string `json:"line1"`
	Line2         string `json:"line2"`
	Subdistrict   string `json:"subdistrict"`
	District      string `json:"district"`
	Province      string `json:"province"`
	PostalCode    string `json:"postal_code"`
	Country       string `json:"country"`
	IsDefault     bool   `json:"is_default"`
}

const addrCols = `id, label, recipient_name, phone, line1, line2, subdistrict, district, province, postal_code, country, is_default`

func scanAddr(row pgx.Row) (Address, error) {
	var a Address
	err := row.Scan(&a.ID, &a.Label, &a.RecipientName, &a.Phone, &a.Line1, &a.Line2, &a.Subdistrict, &a.District,
		&a.Province, &a.PostalCode, &a.Country, &a.IsDefault)
	return a, err
}

// GetAddress loads one of the user's addresses.
func GetAddress(ctx context.Context, q httpx.Querier, userID, id int64) (Address, error) {
	return scanAddr(q.QueryRow(ctx, `SELECT `+addrCols+` FROM addresses WHERE id = $1 AND user_id = $2`, id, userID))
}

type addrInput struct {
	Label         *string `json:"label"`
	RecipientName *string `json:"recipient_name"`
	Phone         *string `json:"phone"`
	Line1         *string `json:"line1"`
	Line2         *string `json:"line2"`
	Subdistrict   *string `json:"subdistrict"`
	District      *string `json:"district"`
	Province      *string `json:"province"`
	PostalCode    *string `json:"postal_code"`
	IsDefault     *bool   `json:"is_default"`
}

var postalRe = regexp.MustCompile(`^[1-9][0-9]{4}$`)

// apply merges in onto a and validates the result.
func (in addrInput) apply(a *Address) map[string]string {
	set := func(dst *string, p *string) {
		if p != nil {
			*dst = strings.TrimSpace(*p)
		}
	}
	set(&a.Label, in.Label)
	set(&a.RecipientName, in.RecipientName)
	set(&a.Phone, in.Phone)
	set(&a.Line1, in.Line1)
	set(&a.Line2, in.Line2)
	set(&a.Subdistrict, in.Subdistrict)
	set(&a.District, in.District)
	set(&a.Province, in.Province)
	set(&a.PostalCode, in.PostalCode)
	f := map[string]string{}
	req := func(name, v string, max int, msg string) {
		if v == "" || utf8.RuneCountInString(v) > max {
			f[name] = msg
		}
	}
	if utf8.RuneCountInString(a.Label) > 50 {
		f["label"] = "ชื่อที่อยู่ยาวเกินไป"
	}
	req("recipient_name", a.RecipientName, 200, "กรุณากรอกชื่อผู้รับ")
	req("line1", a.Line1, 300, "กรุณากรอกที่อยู่")
	if utf8.RuneCountInString(a.Line2) > 300 {
		f["line2"] = "ที่อยู่ยาวเกินไป"
	}
	req("subdistrict", a.Subdistrict, 100, "กรุณากรอกแขวง/ตำบล")
	req("district", a.District, 100, "กรุณากรอกเขต/อำเภอ")
	req("province", a.Province, 100, "กรุณากรอกจังหวัด")
	if !postalRe.MatchString(a.PostalCode) {
		f["postal_code"] = "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก"
	}
	if p, ok := auth.NormalizePhone(a.Phone); ok {
		a.Phone = p
	} else {
		f["phone"] = "เบอร์โทรศัพท์ต้องเป็นตัวเลข 9-15 หลัก"
	}
	return f
}

func (h *handler) listAddresses(c *gin.Context) {
	u, _ := auth.UserFrom(c)
	rows, err := h.d.DB.Query(c.Request.Context(), `SELECT `+addrCols+` FROM addresses WHERE user_id = $1
		ORDER BY is_default DESC, created_at DESC, id DESC`, u.ID)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	defer rows.Close()
	out := []Address{}
	for rows.Next() {
		a, err := scanAddr(rows)
		if err != nil {
			httpx.Internal(c, h.d.Log, err)
			return
		}
		out = append(out, a)
	}
	httpx.Data(c, http.StatusOK, out)
}

func (h *handler) createAddress(c *gin.Context) {
	u, _ := auth.UserFrom(c)
	var in addrInput
	if !httpx.BindJSON(c, &in) {
		return
	}
	a := Address{Country: "TH"}
	if f := in.apply(&a); len(f) > 0 {
		httpx.Validation(c, f)
		return
	}
	ctx := c.Request.Context()
	full := false
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		// serialize per user
		if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, u.ID); err != nil {
			return err
		}
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM addresses WHERE user_id = $1`, u.ID).Scan(&n); err != nil {
			return err
		}
		if n >= maxAddresses {
			full = true
			return nil
		}
		def := n == 0 || (in.IsDefault != nil && *in.IsDefault)
		if def {
			if _, err := tx.Exec(ctx, `UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default`, u.ID); err != nil {
				return err
			}
		}
		var err error
		a, err = scanAddr(tx.QueryRow(ctx, `INSERT INTO addresses (user_id, label, recipient_name, phone, line1, line2, subdistrict,
				district, province, postal_code, is_default) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING `+addrCols,
			u.ID, a.Label, a.RecipientName, a.Phone, a.Line1, a.Line2, a.Subdistrict, a.District, a.Province, a.PostalCode, def))
		return err
	})
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	if full {
		httpx.Validation(c, map[string]string{"_": "บันทึกที่อยู่ได้สูงสุด 10 รายการ"})
		return
	}
	httpx.Data(c, http.StatusCreated, a)
}

func (h *handler) patchAddress(c *gin.Context) {
	u, _ := auth.UserFrom(c)
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var in addrInput
	if !httpx.BindJSON(c, &in) {
		return
	}
	ctx := c.Request.Context()
	var a Address
	var fields map[string]string
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		var err error
		a, err = scanAddr(tx.QueryRow(ctx, `SELECT `+addrCols+` FROM addresses WHERE id = $1 AND user_id = $2 FOR UPDATE`, id, u.ID))
		if err != nil {
			return err
		}
		if fields = in.apply(&a); len(fields) > 0 {
			return nil
		}
		if in.IsDefault != nil && *in.IsDefault && !a.IsDefault {
			if _, err := tx.Exec(ctx, `UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default`, u.ID); err != nil {
				return err
			}
			a.IsDefault = true
		}
		a, err = scanAddr(tx.QueryRow(ctx, `UPDATE addresses SET label = $3, recipient_name = $4, phone = $5, line1 = $6, line2 = $7,
				subdistrict = $8, district = $9, province = $10, postal_code = $11, is_default = $12
			WHERE id = $1 AND user_id = $2 RETURNING `+addrCols, id, u.ID, a.Label, a.RecipientName, a.Phone, a.Line1, a.Line2,
			a.Subdistrict, a.District, a.Province, a.PostalCode, a.IsDefault))
		return err
	})
	if httpx.IsNoRows(err) {
		httpx.NotFound(c)
		return
	}
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	if len(fields) > 0 {
		httpx.Validation(c, fields)
		return
	}
	httpx.Data(c, http.StatusOK, a)
}

func (h *handler) deleteAddress(c *gin.Context) {
	u, _ := auth.UserFrom(c)
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	ctx := c.Request.Context()
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		var wasDefault bool
		if err := tx.QueryRow(ctx, `DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING is_default`, id, u.ID).Scan(&wasDefault); err != nil {
			return err
		}
		if wasDefault {
			_, err := tx.Exec(ctx, `UPDATE addresses SET is_default = true WHERE id = (SELECT id FROM addresses WHERE user_id = $1
				ORDER BY created_at DESC, id DESC LIMIT 1)`, u.ID)
			return err
		}
		return nil
	})
	if httpx.IsNoRows(err) {
		httpx.NotFound(c)
		return
	}
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *handler) makeDefault(c *gin.Context) {
	u, _ := auth.UserFrom(c)
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	ctx := c.Request.Context()
	var a Address
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		if _, err := GetAddress(ctx, tx, u.ID, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default AND id <> $2`, u.ID, id); err != nil {
			return err
		}
		var err error
		a, err = scanAddr(tx.QueryRow(ctx, `UPDATE addresses SET is_default = true WHERE id = $1 RETURNING `+addrCols, id))
		return err
	})
	if httpx.IsNoRows(err) {
		httpx.NotFound(c)
		return
	}
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusOK, a)
}

func (h *handler) wishlist(c *gin.Context) {
	u, _ := auth.UserFrom(c)
	ctx := c.Request.Context()
	page, per := httpx.Page(c, 24, 48)
	var total int
	if err := h.d.DB.QueryRow(ctx, `SELECT count(*) FROM wishlist_items w JOIN products p ON p.id = w.product_id
		WHERE w.user_id = $1 AND p.status = 'active' AND p.deleted_at IS NULL`, u.ID).Scan(&total); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	rows, err := h.d.DB.Query(ctx, `SELECT w.product_id FROM wishlist_items w JOIN products p ON p.id = w.product_id
		WHERE w.user_id = $1 AND p.status = 'active' AND p.deleted_at IS NULL
		ORDER BY w.created_at DESC, w.product_id DESC LIMIT $2 OFFSET $3`, u.ID, per, (page-1)*per)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	cards, err := catalog.LoadCards(ctx, h.d.DB, ids, h.d.Now(), true)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.List(c, cards, httpx.NewMeta(page, per, total))
}

func (h *handler) addWish(c *gin.Context) {
	u, _ := auth.UserFrom(c)
	pid, ok := httpx.ParamID(c, "product_id")
	if !ok {
		return
	}
	tag, err := h.d.DB.Exec(c.Request.Context(), `INSERT INTO wishlist_items (user_id, product_id)
		SELECT $1, id FROM products WHERE id = $2 AND status = 'active' AND deleted_at IS NULL
		ON CONFLICT DO NOTHING`, u.ID, pid)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		_ = h.d.DB.QueryRow(c.Request.Context(), `SELECT EXISTS (SELECT 1 FROM wishlist_items WHERE user_id = $1 AND product_id = $2)`, u.ID, pid).Scan(&exists)
		if !exists {
			httpx.NotFound(c)
			return
		}
	}
	c.Status(http.StatusNoContent)
}

func (h *handler) removeWish(c *gin.Context) {
	u, _ := auth.UserFrom(c)
	pid, ok := httpx.ParamID(c, "product_id")
	if !ok {
		return
	}
	if _, err := h.d.DB.Exec(c.Request.Context(), `DELETE FROM wishlist_items WHERE user_id = $1 AND product_id = $2`, u.ID, pid); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	c.Status(http.StatusNoContent)
}
