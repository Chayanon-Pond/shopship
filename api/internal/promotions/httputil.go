package promotions

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/httpx"
)

const (
	cachePublic = "public, max-age=60, stale-while-revalidate=300"
	cacheNone   = "no-store"
)

// needDB answers 503 when no database is configured.
func (h *handlers) needDB(c *gin.Context) bool {
	if h.d.DB == nil {
		httpx.Error(c, http.StatusServiceUnavailable, httpx.CodeUnavailable, "ระบบยังไม่พร้อมใช้งาน", nil)
		return false
	}
	return true
}

func pathID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		httpx.Error(c, http.StatusNotFound, httpx.CodeNotFound, "ไม่พบข้อมูล", nil)
		return 0, false
	}
	return id, true
}

// decode reads a JSON body into dst (which may be pre-filled: absent fields
// keep their values — that is how PATCH merges).
func decode(c *gin.Context, dst any) bool {
	dec := json.NewDecoder(c.Request.Body)
	if err := dec.Decode(dst); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			httpx.Error(c, http.StatusRequestEntityTooLarge, httpx.CodePayloadTooLarge, "ข้อมูลมีขนาดใหญ่เกินไป", nil)
			return false
		}
		httpx.Error(c, http.StatusBadRequest, httpx.CodeBadRequest, "รูปแบบข้อมูลไม่ถูกต้อง", nil)
		return false
	}
	return true
}

func notFound(c *gin.Context) {
	httpx.Error(c, http.StatusNotFound, httpx.CodeNotFound, "ไม่พบข้อมูล", nil)
}

func invalid(c *gin.Context, fields map[string]string) {
	httpx.Error(c, http.StatusUnprocessableEntity, httpx.CodeValidation, "กรุณาตรวจสอบข้อมูล", fields)
}

// dbError maps Postgres errors to the envelope (unique -> 409, FK/check -> 422).
func (h *handlers) dbError(c *gin.Context, err error) {
	var pe *pgconn.PgError
	if errors.Is(err, pgx.ErrNoRows) {
		notFound(c)
		return
	}
	if errors.As(err, &pe) {
		switch pe.Code {
		case "23505":
			httpx.Error(c, http.StatusConflict, httpx.CodeConflict, "ข้อมูลซ้ำกับที่มีอยู่แล้ว", nil)
			return
		case "23503":
			invalid(c, map[string]string{"_": "อ้างอิงข้อมูลที่ไม่มีอยู่"})
			return
		case "23514", "22P02", "22007", "22008":
			invalid(c, map[string]string{"_": "ข้อมูลไม่ผ่านเงื่อนไขของระบบ"})
			return
		}
	}
	if h.d.Log != nil {
		h.d.Log.Error("promotions", "err", err, "path", c.FullPath())
	}
	httpx.Error(c, http.StatusInternalServerError, httpx.CodeInternal, "เกิดข้อผิดพลาด กรุณาลองใหม่", nil)
}

// audit writes one audit_logs row inside the mutation's transaction.
func audit(ctx context.Context, q Querier, c *gin.Context, action, targetType string, targetID int64, meta any) error {
	var actorID *int64
	email := ""
	if u, ok := auth.UserFrom(c); ok {
		actorID, email = &u.ID, u.Email
	}
	if meta == nil {
		meta = map[string]any{}
	}
	b, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `INSERT INTO audit_logs (actor_user_id, actor_email, action, target_type, target_id, metadata, ip, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, actorID, email, action, targetType, strconv.FormatInt(targetID, 10), b,
		c.ClientIP(), c.Request.UserAgent())
	return err
}

// inTx runs fn in a transaction on the pool.
func (h *handlers) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, h.d.DB, fn)
}
