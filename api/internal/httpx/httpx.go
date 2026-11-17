// Package httpx writes JSON responses in the frozen envelope (docs/API.md):
//
//	success: {"data": ...}  or  {"data": [...], "meta": {page, per_page, total, total_pages}}
//	error:   {"error": {"code", "message", "fields"?, "details"?}}
//
// Owner after Wave 0: api-core (additive changes only).
package httpx

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Error codes (docs/API.md "Error codes"). Add new codes there first.
const (
	CodeValidation      = "validation_failed"
	CodeBadRequest      = "bad_request"
	CodeUnauthorized    = "unauthorized"
	CodeForbidden       = "forbidden"
	CodeCSRF            = "csrf_failed"
	CodeNotFound        = "not_found"
	CodeConflict        = "conflict"
	CodePriceChanged    = "price_changed"
	CodeOutOfStock      = "out_of_stock"
	CodeLimitReached    = "limit_reached"
	CodeIdempotency     = "idempotency_conflict"
	CodeInvalidState    = "invalid_state"
	CodePayloadTooLarge = "payload_too_large"
	CodeRateLimited     = "rate_limited"
	CodeUnavailable     = "service_unavailable"
	CodeInternal        = "internal"
	CodeNotImplemented  = "not_implemented"
)

type ErrorBody struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
	Details any               `json:"details,omitempty"`
}

type Envelope struct {
	Error ErrorBody `json:"error"`
}

type Meta struct {
	Page       int `json:"page"`
	PerPage    int `json:"per_page"`
	Total      int `json:"total"`
	TotalPages int `json:"total_pages"`
}

func NewMeta(page, perPage, total int) Meta {
	tp := 0
	if perPage > 0 {
		tp = (total + perPage - 1) / perPage
	}
	return Meta{Page: page, PerPage: perPage, Total: total, TotalPages: tp}
}

func Data(c *gin.Context, status int, data any) { c.JSON(status, gin.H{"data": data}) }

func List(c *gin.Context, data any, meta Meta) {
	c.JSON(http.StatusOK, gin.H{"data": data, "meta": meta})
}

// Error aborts with the error envelope.
func Error(c *gin.Context, status int, code, message string, fields map[string]string) {
	c.AbortWithStatusJSON(status, Envelope{Error: ErrorBody{Code: code, Message: message, Fields: fields}})
}

// ErrorDetails aborts with the envelope plus a machine-readable details object
// (e.g. the fresh quote on 409 price_changed).
func ErrorDetails(c *gin.Context, status int, code, message string, details any) {
	c.AbortWithStatusJSON(status, Envelope{Error: ErrorBody{Code: code, Message: message, Details: details}})
}

// NotImplemented is the Wave 0 placeholder handler.
func NotImplemented(c *gin.Context) {
	Error(c, http.StatusNotImplemented, CodeNotImplemented, "ยังไม่เปิดใช้งาน", nil)
}

// Page parses ?page (>=1, default 1) and ?per_page (1..max, default def).
func Page(c *gin.Context, def, max int) (page, perPage int) {
	page, _ = strconv.Atoi(c.Query("page"))
	if page < 1 {
		page = 1
	}
	perPage, _ = strconv.Atoi(c.Query("per_page"))
	if perPage < 1 {
		perPage = def
	}
	if perPage > max {
		perPage = max
	}
	return page, perPage
}

// RequestID sets/propagates X-Request-ID.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader("X-Request-ID")
		if _, err := uuid.Parse(id); err != nil {
			id = uuid.NewString()
		}
		c.Set("request_id", id)
		c.Header("X-Request-ID", id)
		c.Next()
	}
}
