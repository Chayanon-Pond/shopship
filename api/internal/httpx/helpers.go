package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Querier is satisfied by *pgxpool.Pool, *pgxpool.Conn and pgx.Tx.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// NeedDB answers 503 service_unavailable when no database is configured.
func NeedDB(db *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			Error(c, http.StatusServiceUnavailable, CodeUnavailable, "ระบบยังไม่พร้อมให้บริการ", nil)
			return
		}
		c.Next()
	}
}

// NoStore marks a personal response.
func NoStore(c *gin.Context) { c.Header("Cache-Control", "no-store") }

// PublicCache marks a public catalog response.
func PublicCache(c *gin.Context) {
	c.Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
}

// Internal logs err and aborts with 500 (no details leaked).
func Internal(c *gin.Context, log *slog.Logger, err error) {
	if log != nil {
		log.Error("request failed", "err", err, "path", c.FullPath(), "method", c.Request.Method,
			"request_id", c.GetString("request_id"))
	}
	Error(c, http.StatusInternalServerError, CodeInternal, "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง", nil)
}

// Validation aborts with 422 and per-field Thai messages.
func Validation(c *gin.Context, fields map[string]string) {
	Error(c, http.StatusUnprocessableEntity, CodeValidation, "กรุณาตรวจสอบข้อมูล", fields)
}

// NotFound aborts with 404.
func NotFound(c *gin.Context) {
	Error(c, http.StatusNotFound, CodeNotFound, "ไม่พบข้อมูล", nil)
}

// Conflict aborts with 409 conflict.
func Conflict(c *gin.Context, msg string) { Error(c, http.StatusConflict, CodeConflict, msg, nil) }

// BindJSON decodes the body into dst (unknown fields allowed). It aborts
// with 413 when the body is over the limit and 400 when malformed. An empty
// body decodes as {}.
func BindJSON(c *gin.Context, dst any) bool {
	if c.Request.Body == nil {
		return true
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			Error(c, http.StatusRequestEntityTooLarge, CodePayloadTooLarge, "ข้อมูลมีขนาดใหญ่เกินไป", nil)
			return false
		}
		Error(c, http.StatusBadRequest, CodeBadRequest, "คำขอไม่ถูกต้อง", nil)
		return false
	}
	if len(strings.TrimSpace(string(body))) == 0 {
		return true
	}
	if ct := c.ContentType(); ct != "" && ct != "application/json" {
		Error(c, http.StatusBadRequest, CodeBadRequest, "ต้องส่งข้อมูลแบบ JSON", nil)
		return false
	}
	if err := json.Unmarshal(body, dst); err != nil {
		Error(c, http.StatusBadRequest, CodeBadRequest, "รูปแบบข้อมูลไม่ถูกต้อง", nil)
		return false
	}
	return true
}

// ParamID parses a positive int64 path param; aborts 404 when invalid.
func ParamID(c *gin.Context, name string) (int64, bool) {
	id, err := strconv.ParseInt(c.Param(name), 10, 64)
	if err != nil || id <= 0 {
		NotFound(c)
		return 0, false
	}
	return id, true
}

// PgCode returns the SQLSTATE of a Postgres error ("" otherwise).
func PgCode(err error) string {
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		return pe.Code
	}
	return ""
}

func IsUniqueViolation(err error) bool { return PgCode(err) == "23505" }
func IsFKViolation(err error) bool     { return PgCode(err) == "23503" }
func IsCheckViolation(err error) bool  { return PgCode(err) == "23514" }

// IsNoRows reports pgx.ErrNoRows.
func IsNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// InTx runs fn in a READ COMMITTED transaction.
func InTx(ctx context.Context, db *pgxpool.Pool, fn func(tx pgx.Tx) error) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// QueryBool parses ?name=true|false|1|0; ok=false when absent.
func QueryBool(c *gin.Context, name string) (val, present, valid bool) {
	s := strings.TrimSpace(c.Query(name))
	if s == "" {
		return false, false, true
	}
	b, err := strconv.ParseBool(s)
	if err != nil {
		return false, true, false
	}
	return b, true, true
}

// QueryInt64 parses an optional integer query param.
func QueryInt64(c *gin.Context, name string) (val int64, present, valid bool) {
	s := strings.TrimSpace(c.Query(name))
	if s == "" {
		return 0, false, true
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, true, false
	}
	return n, true, true
}

// BadRequest aborts with 400.
func BadRequest(c *gin.Context, msg string) {
	if msg == "" {
		msg = "คำขอไม่ถูกต้อง"
	}
	Error(c, http.StatusBadRequest, CodeBadRequest, msg, nil)
}

// LikePattern escapes %, _ and \ for ILIKE and wraps in %...%.
func LikePattern(q string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(q) + "%"
}
