// Package auth: register/login/logout/me, sessions (httpOnly cookie), CSRF,
// password reset, RBAC middleware. Guest-cart merge is triggered on login
// (calls into internal/cart).
//
// Owner: Wave-1 "api-core". Wave 0 provides the frozen middleware
// signatures with placeholder bodies; routes answer 501 until implemented.
package auth

import (
	"net/http"
	"slices"

	"github.com/gin-gonic/gin"

	"github.com/shopship/shop/api/internal/httpx"
)

const (
	SessionCookie = "shopship_session" // opaque token, HttpOnly, SameSite=Lax, Secure
	CSRFHeader    = "X-CSRF-Token"
	ctxUser       = "auth.user"
)

// User is the authenticated principal stored in the gin context.
type User struct {
	ID        int64
	Email     string
	Name      string
	Role      string
	GroupID   int64 // 0 = none
	Tier      string
	CSRFToken string
	SessionID int64
}

// UserFrom returns the session user, if any.
func UserFrom(c *gin.Context) (*User, bool) {
	v, ok := c.Get(ctxUser)
	if !ok {
		return nil, false
	}
	u, ok := v.(*User)
	return u, ok
}

func isSafe(m string) bool {
	return m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions
}

// CSRF protects unsafe methods: the Origin header (when present) must be
// allowlisted, and when a session is present X-CSRF-Token must equal the
// session's csrf_token. Guests (no session) rely on Origin + SameSite=Lax +
// JSON-only bodies. Webhook routes are mounted outside this middleware.
func CSRF(allowedOrigins []string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if isSafe(c.Request.Method) {
			c.Next()
			return
		}
		if o := c.GetHeader("Origin"); o != "" && !slices.Contains(allowedOrigins, o) {
			httpx.Error(c, http.StatusForbidden, httpx.CodeCSRF, "คำขอไม่ถูกต้อง", nil)
			return
		}
		if u, ok := UserFrom(c); ok && !csrfEqual(u.CSRFToken, c.GetHeader(CSRFHeader)) {
			httpx.Error(c, http.StatusForbidden, httpx.CodeCSRF, "คำขอไม่ถูกต้อง กรุณารีเฟรชหน้าแล้วลองใหม่", nil)
			return
		}
		c.Next()
	}
}

// RequireUser aborts with 401 when there is no session.
func RequireUser() gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, ok := UserFrom(c); !ok {
			httpx.Error(c, http.StatusUnauthorized, httpx.CodeUnauthorized, "กรุณาเข้าสู่ระบบ", nil)
			return
		}
		c.Next()
	}
}

// RequireStaff aborts unless the session user is owner/admin/staff.
func RequireStaff() gin.HandlerFunc {
	return func(c *gin.Context) {
		u, ok := UserFrom(c)
		if !ok {
			httpx.Error(c, http.StatusUnauthorized, httpx.CodeUnauthorized, "กรุณาเข้าสู่ระบบ", nil)
			return
		}
		if !IsStaff(u.Role) {
			httpx.Error(c, http.StatusForbidden, httpx.CodeForbidden, "ไม่มีสิทธิ์เข้าถึง", nil)
			return
		}
		c.Next()
	}
}

// RequirePerm aborts with 403 unless the user's role has p. Use after RequireStaff.
func RequirePerm(p Perm) gin.HandlerFunc {
	return func(c *gin.Context) {
		u, ok := UserFrom(c)
		if !ok || !Can(u.Role, p) {
			httpx.Error(c, http.StatusForbidden, httpx.CodeForbidden, "ไม่มีสิทธิ์ทำรายการนี้", nil)
			return
		}
		c.Next()
	}
}
