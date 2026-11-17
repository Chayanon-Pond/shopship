// Package admin: back-office endpoints that belong to no other domain —
// dashboard stats, users (assign group/tier/role), banners CRUD, generic
// image uploads, audit log viewer.
//
// Owner: Wave-1 "api-core". Routes are the frozen contract (docs/API.md).
package admin

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/catalog"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/platform"
)

type handler struct{ d *platform.Deps }

func Register(rt platform.Routes, d *platform.Deps) {
	h := &handler{d: d}
	a := rt.Admin.Group("", httpx.NeedDB(d.DB))
	a.GET("/dashboard", auth.RequirePerm(auth.PermDashboardRead), h.dashboard)

	a.GET("/users", auth.RequirePerm(auth.PermCustomersRead), h.listUsers)
	a.GET("/users/:id", auth.RequirePerm(auth.PermCustomersRead), h.getUser)
	// group_id/tier/is_active need customers:write; role needs staff:manage (checked in handler)
	a.PATCH("/users/:id", auth.RequirePerm(auth.PermCustomersWrite), h.patchUser)

	bw := auth.RequirePerm(auth.PermBannersWrite)
	a.GET("/banners", bw, h.listBanners)
	a.POST("/banners", bw, h.createBanner)
	a.PATCH("/banners/:id", bw, h.patchBanner)
	a.DELETE("/banners/:id", bw, h.deleteBanner)

	a.POST("/uploads", h.upload) // multipart image; any staff with a write perm (checked in handler)

	a.GET("/audit-logs", auth.RequirePerm(auth.PermAuditRead), h.auditLogs)
}

var bangkok = func() *time.Location {
	if l, err := time.LoadLocation("Asia/Bangkok"); err == nil {
		return l
	}
	return time.FixedZone("ICT", 7*3600)
}()

// parseDate accepts YYYY-MM-DD (Bangkok day) or RFC 3339.
func parseDate(s string, endOfDay bool) (time.Time, bool) {
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, true
	}
	t, err := time.ParseInLocation("2006-01-02", s, bangkok)
	if err != nil {
		return time.Time{}, false
	}
	if endOfDay {
		t = t.AddDate(0, 0, 1)
	}
	return t, true
}

type args struct{ v []any }

func (a *args) add(x any) string {
	a.v = append(a.v, x)
	return fmt.Sprintf("$%d", len(a.v))
}

// ---------- uploads ----------

func (h *handler) upload(c *gin.Context) {
	u, _ := auth.UserFrom(c)
	if !auth.Can(u.Role, auth.PermCatalogWrite) && !auth.Can(u.Role, auth.PermBannersWrite) && !auth.Can(u.Role, auth.PermPromotionsWrite) {
		httpx.Error(c, http.StatusForbidden, httpx.CodeForbidden, "ไม่มีสิทธิ์อัปโหลดไฟล์", nil)
		return
	}
	up, f := catalog.ReadUpload(c)
	if f != nil {
		httpx.Validation(c, f)
		return
	}
	ctx := c.Request.Context()
	key, url, err := catalog.Store(ctx, h.d.Storage, "uploads/"+time.Now().UTC().Format("200601"), up)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	_ = auth.Audit(c, h.d.DB, "upload.create", "upload", key, map[string]any{"bytes": len(up.Data), "content_type": up.ContentType})
	httpx.Data(c, http.StatusCreated, gin.H{"storage_key": key, "url": url, "width": up.Width, "height": up.Height})
}

// ---------- audit ----------

func (h *handler) auditLogs(c *gin.Context) {
	ctx := c.Request.Context()
	page, per := httpx.Page(c, 50, 100)
	a := &args{}
	where := []string{"true"}
	if v, present, valid := httpx.QueryInt64(c, "actor_id"); !valid {
		httpx.BadRequest(c, "")
		return
	} else if present {
		where = append(where, "l.actor_user_id = "+a.add(v))
	}
	if s := strings.TrimSpace(c.Query("action")); s != "" {
		if strings.Contains(s, ".") {
			where = append(where, "l.action = "+a.add(s))
		} else {
			where = append(where, "l.action LIKE "+a.add(s+".%"))
		}
	}
	if s := strings.TrimSpace(c.Query("target_type")); s != "" {
		where = append(where, "l.target_type = "+a.add(s))
	}
	if s := strings.TrimSpace(c.Query("target_id")); s != "" {
		where = append(where, "l.target_id = "+a.add(s))
	}
	if s := c.Query("from"); s != "" {
		t, ok := parseDate(s, false)
		if !ok {
			httpx.BadRequest(c, "พารามิเตอร์ from ไม่ถูกต้อง")
			return
		}
		where = append(where, "l.created_at >= "+a.add(t))
	}
	if s := c.Query("to"); s != "" {
		t, ok := parseDate(s, true)
		if !ok {
			httpx.BadRequest(c, "พารามิเตอร์ to ไม่ถูกต้อง")
			return
		}
		where = append(where, "l.created_at < "+a.add(t))
	}
	w := strings.Join(where, " AND ")
	var total int
	if err := h.d.DB.QueryRow(ctx, "SELECT count(*) FROM audit_logs l WHERE "+w, a.v...).Scan(&total); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	rows, err := h.d.DB.Query(ctx, fmt.Sprintf(`SELECT l.id, l.actor_user_id, l.actor_email, l.action, l.target_type, l.target_id,
			l.metadata, l.ip, l.created_at FROM audit_logs l WHERE %s ORDER BY l.created_at DESC, l.id DESC LIMIT %d OFFSET %d`,
		w, per, (page-1)*per), a.v...)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	defer rows.Close()
	type actor struct {
		ID    int64  `json:"id"`
		Email string `json:"email"`
	}
	type row struct {
		ID         int64           `json:"id"`
		Actor      *actor          `json:"actor"`
		Action     string          `json:"action"`
		TargetType string          `json:"target_type"`
		TargetID   string          `json:"target_id"`
		Metadata   json.RawMessage `json:"metadata"`
		IP         string          `json:"ip"`
		CreatedAt  time.Time       `json:"created_at"`
	}
	list := []row{}
	for rows.Next() {
		var r row
		var aid *int64
		var email string
		var meta []byte
		if err := rows.Scan(&r.ID, &aid, &email, &r.Action, &r.TargetType, &r.TargetID, &meta, &r.IP, &r.CreatedAt); err != nil {
			httpx.Internal(c, h.d.Log, err)
			return
		}
		if aid != nil {
			r.Actor = &actor{ID: *aid, Email: email}
		}
		r.Metadata = meta
		r.CreatedAt = r.CreatedAt.UTC()
		list = append(list, r)
	}
	httpx.List(c, list, httpx.NewMeta(page, per, total))
}
