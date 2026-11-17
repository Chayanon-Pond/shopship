package admin

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/account"
	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/orders"
)

// paidStatuses count as sales.
const paidStatuses = `('paid', 'packing', 'shipped', 'delivered', 'completed')`

type groupRef struct {
	ID   int64  `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}

type userRow struct {
	ID               int64      `json:"id"`
	Email            string     `json:"email"`
	Name             string     `json:"name"`
	Phone            string     `json:"phone"`
	Role             string     `json:"role"`
	Tier             string     `json:"tier"`
	Group            *groupRef  `json:"group"`
	IsActive         bool       `json:"is_active"`
	OrderCount       int        `json:"order_count"`
	TotalSpentSatang int64      `json:"total_spent_satang"`
	CreatedAt        time.Time  `json:"created_at"`
	LastLoginAt      *time.Time `json:"last_login_at"`
}

const userCols = `u.id, u.email, u.name, u.phone, u.role, u.tier, g.id, g.code, g.name, u.is_active,
	(SELECT count(*) FROM orders o WHERE o.user_id = u.id)::int,
	coalesce((SELECT sum(grand_total_satang) FROM orders o WHERE o.user_id = u.id AND o.status IN ` + paidStatuses + `), 0)::bigint,
	u.created_at, u.last_login_at`

func scanUser(row pgx.Row) (userRow, error) {
	var r userRow
	var gid *int64
	var gcode, gname *string
	err := row.Scan(&r.ID, &r.Email, &r.Name, &r.Phone, &r.Role, &r.Tier, &gid, &gcode, &gname, &r.IsActive, &r.OrderCount,
		&r.TotalSpentSatang, &r.CreatedAt, &r.LastLoginAt)
	if gid != nil {
		r.Group = &groupRef{ID: *gid, Code: *gcode, Name: *gname}
	}
	r.CreatedAt = r.CreatedAt.UTC()
	if r.LastLoginAt != nil {
		t := r.LastLoginAt.UTC()
		r.LastLoginAt = &t
	}
	return r, err
}

var roles = map[string]bool{auth.RoleCustomer: true, auth.RoleStaff: true, auth.RoleAdmin: true, auth.RoleOwner: true}
var tiers = map[string]bool{"standard": true, "silver": true, "gold": true, "platinum": true}

func (h *handler) listUsers(c *gin.Context) {
	ctx := c.Request.Context()
	page, per := httpx.Page(c, 24, 100)
	a := &args{}
	where := []string{"u.deleted_at IS NULL"}
	if s := c.Query("role"); s != "" {
		if s == "staff_all" {
			where = append(where, "u.role <> 'customer'")
		} else {
			// one role or a comma-separated list (e.g. staff,admin,owner for the back-office users page)
			list := strings.Split(s, ",")
			for _, r := range list {
				if !roles[r] {
					httpx.BadRequest(c, "พารามิเตอร์ role ไม่ถูกต้อง")
					return
				}
			}
			where = append(where, "u.role = ANY("+a.add(list)+"::text[])")
		}
	}
	if v, present, valid := httpx.QueryInt64(c, "group_id"); !valid {
		httpx.BadRequest(c, "")
		return
	} else if present {
		where = append(where, "u.group_id = "+a.add(v))
	}
	if s := c.Query("tier"); s != "" {
		if !tiers[s] {
			httpx.BadRequest(c, "พารามิเตอร์ tier ไม่ถูกต้อง")
			return
		}
		where = append(where, "u.tier = "+a.add(s))
	}
	if q := strings.TrimSpace(c.Query("q")); q != "" {
		p := a.add(httpx.LikePattern(strings.ToLower(q)))
		where = append(where, "(u.email LIKE "+p+" OR lower(u.name) LIKE "+p+" OR u.phone LIKE "+p+")")
	}
	w := strings.Join(where, " AND ")
	var total int
	if err := h.d.DB.QueryRow(ctx, "SELECT count(*) FROM users u WHERE "+w, a.v...).Scan(&total); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	order := "u.created_at DESC, u.id DESC"
	switch c.Query("sort") {
	case "", "created_desc":
	case "name":
		order = "u.name, u.id"
	case "spent_desc":
		order = "12 DESC, u.id"
	case "last_login_desc":
		order = "u.last_login_at DESC NULLS LAST, u.id"
	default:
		httpx.BadRequest(c, "พารามิเตอร์ sort ไม่ถูกต้อง")
		return
	}
	rows, err := h.d.DB.Query(ctx, fmt.Sprintf(`SELECT %s FROM users u LEFT JOIN customer_groups g ON g.id = u.group_id
		WHERE %s ORDER BY %s LIMIT %d OFFSET %d`, userCols, w, order, per, (page-1)*per), a.v...)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	defer rows.Close()
	list := []userRow{}
	for rows.Next() {
		r, err := scanUser(rows)
		if err != nil {
			httpx.Internal(c, h.d.Log, err)
			return
		}
		list = append(list, r)
	}
	httpx.List(c, list, httpx.NewMeta(page, per, total))
}

type userDetail struct {
	userRow
	MarketingConsent bool              `json:"marketing_consent"`
	Addresses        []account.Address `json:"addresses"`
	RecentOrders     []orders.Summary  `json:"recent_orders"`
}

func (h *handler) loadUser(c *gin.Context, id int64) (userDetail, error) {
	ctx := c.Request.Context()
	var ud userDetail
	r, err := scanUser(h.d.DB.QueryRow(ctx, `SELECT `+userCols+` FROM users u LEFT JOIN customer_groups g ON g.id = u.group_id
		WHERE u.id = $1 AND u.deleted_at IS NULL`, id))
	if err != nil {
		return ud, err
	}
	ud.userRow = r
	if err := h.d.DB.QueryRow(ctx, `SELECT marketing_consent FROM users WHERE id = $1`, id).Scan(&ud.MarketingConsent); err != nil {
		return ud, err
	}
	rows, err := h.d.DB.Query(ctx, `SELECT id FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`, id)
	if err != nil {
		return ud, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		return ud, err
	}
	ud.Addresses = []account.Address{}
	for _, aid := range ids {
		a, err := account.GetAddress(ctx, h.d.DB, id, aid)
		if err != nil {
			return ud, err
		}
		ud.Addresses = append(ud.Addresses, a)
	}
	ud.RecentOrders, err = orders.Summaries(ctx, h.d.DB, "o.user_id = $1", 10, 0, id)
	return ud, err
}

func (h *handler) getUser(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	ud, err := h.loadUser(c, id)
	if httpx.IsNoRows(err) {
		httpx.NotFound(c)
		return
	}
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusOK, ud)
}

var errLastOwner = errors.New("last owner")

func (h *handler) patchUser(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var raw map[string]json.RawMessage
	if !httpx.BindJSON(c, &raw) {
		return
	}
	me, _ := auth.UserFrom(c)
	var tier, role *string
	var active *bool
	groupSet := false
	var group *int64
	f := map[string]string{}
	if v, ok := raw["tier"]; ok {
		var s string
		if json.Unmarshal(v, &s) != nil || !tiers[s] {
			f["tier"] = "ระดับสมาชิกไม่ถูกต้อง"
		}
		tier = &s
	}
	if v, ok := raw["role"]; ok {
		var s string
		if json.Unmarshal(v, &s) != nil || !roles[s] {
			f["role"] = "บทบาทไม่ถูกต้อง"
		}
		role = &s
	}
	if v, ok := raw["is_active"]; ok {
		var b bool
		if json.Unmarshal(v, &b) != nil {
			f["is_active"] = "ค่าไม่ถูกต้อง"
		}
		active = &b
	}
	if v, ok := raw["group_id"]; ok {
		groupSet = true
		if string(v) != "null" {
			var n int64
			if json.Unmarshal(v, &n) != nil || n <= 0 {
				f["group_id"] = "กลุ่มลูกค้าไม่ถูกต้อง"
			}
			group = &n
		}
	}
	if len(f) > 0 {
		httpx.Validation(c, f)
		return
	}
	ctx := c.Request.Context()
	forbidden := false
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		var curRole string
		var curActive bool
		if err := tx.QueryRow(ctx, `SELECT role, is_active FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, id).Scan(&curRole, &curActive); err != nil {
			return err
		}
		// role changes, and changes to back-office accounts, need staff:manage
		if (role != nil && *role != curRole) || (auth.IsStaff(curRole) && active != nil && *active != curActive) {
			if !auth.Can(me.Role, auth.PermStaffManage) {
				forbidden = true
				return nil
			}
		}
		losingOwner := curRole == auth.RoleOwner && curActive &&
			((role != nil && *role != auth.RoleOwner) || (active != nil && !*active))
		if losingOwner {
			// lock all owners, then count
			var n int
			if err := tx.QueryRow(ctx, `SELECT count(*) FROM (SELECT id FROM users WHERE role = 'owner' AND is_active
				AND deleted_at IS NULL FOR UPDATE) s`).Scan(&n); err != nil {
				return err
			}
			if n <= 1 {
				return errLastOwner
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET tier = coalesce($2, tier), role = coalesce($3, role), is_active = coalesce($4, is_active),
				group_id = CASE WHEN $5::boolean THEN $6::bigint ELSE group_id END WHERE id = $1`, id, tier, role, active, groupSet, group); err != nil {
			return err
		}
		if (active != nil && !*active) || (role != nil && *role != curRole) {
			if _, err := tx.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, id); err != nil {
				return err
			}
		}
		meta := map[string]any{}
		if tier != nil {
			meta["tier"] = *tier
		}
		if role != nil {
			meta["role_from"], meta["role_to"] = curRole, *role
		}
		if active != nil {
			meta["is_active"] = *active
		}
		if groupSet {
			meta["group_id"] = group
		}
		return auth.Audit(c, tx, "user.update", "user", id, meta)
	})
	switch {
	case forbidden:
		httpx.Error(c, http.StatusForbidden, httpx.CodeForbidden, "เฉพาะเจ้าของร้านเท่านั้นที่เปลี่ยนบทบาทหรือระงับบัญชีพนักงานได้", nil)
		return
	case errors.Is(err, errLastOwner):
		httpx.Conflict(c, "ต้องมีเจ้าของร้านที่ใช้งานอยู่อย่างน้อย 1 คน")
		return
	case httpx.IsFKViolation(err):
		httpx.Validation(c, map[string]string{"group_id": "ไม่พบกลุ่มลูกค้านี้"})
		return
	case httpx.IsNoRows(err):
		httpx.NotFound(c)
		return
	case err != nil:
		httpx.Internal(c, h.d.Log, err)
		return
	}
	h.getUser(c)
}
