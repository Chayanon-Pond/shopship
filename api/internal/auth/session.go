package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/platform"
)

// RandomToken returns n random bytes, base64url without padding.
func RandomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// HashToken is the SHA-256 stored for session and one-time tokens.
func HashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

// CreateSession inserts a session and returns the cookie token and csrf token.
func CreateSession(ctx context.Context, q httpx.Querier, userID int64, ttl time.Duration, ip, ua string) (token, csrf string, err error) {
	token = RandomToken(32)
	csrf = RandomToken(32)
	if len(ua) > 500 {
		ua = ua[:500]
	}
	_, err = q.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, csrf_token, ip, user_agent, expires_at)
		VALUES ($1, $2, $3, $4, $5, now() + $6 * interval '1 second')`,
		userID, HashToken(token), csrf, ip, ua, int64(ttl.Seconds()))
	return token, csrf, err
}

// SetSessionCookie writes shopship_session.
func SetSessionCookie(c *gin.Context, d *platform.Deps, token string) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name: SessionCookie, Value: token, Path: "/", Domain: d.Cfg.CookieDomain,
		MaxAge: int(d.Cfg.SessionTTL.Seconds()), HttpOnly: true, Secure: d.Cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

// ClearCookie expires a cookie by name.
func ClearCookie(c *gin.Context, d *platform.Deps, name string) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name: name, Value: "", Path: "/", Domain: d.Cfg.CookieDomain, MaxAge: -1,
		HttpOnly: true, Secure: d.Cfg.CookieSecure, SameSite: http.SameSiteLaxMode,
	})
}

// LoadSession resolves the session cookie (if present) into a *User in the
// context. It never rejects: anonymous or expired sessions continue as guests.
// Sliding expiry: last_seen_at/expires_at are bumped at most once a minute.
func LoadSession(d *platform.Deps) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := c.Cookie(SessionCookie)
		if err != nil || token == "" || d.DB == nil {
			c.Next()
			return
		}
		ctx := c.Request.Context()
		u := &User{}
		var lastSeen time.Time
		err = d.DB.QueryRow(ctx, `SELECT s.id, s.csrf_token, s.last_seen_at, u.id, u.email, u.name, u.role,
				coalesce(u.group_id, 0), u.tier
			FROM sessions s JOIN users u ON u.id = s.user_id
			WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active AND u.deleted_at IS NULL`,
			HashToken(token)).Scan(&u.SessionID, &u.CSRFToken, &lastSeen, &u.ID, &u.Email, &u.Name, &u.Role, &u.GroupID, &u.Tier)
		if err != nil {
			if !httpx.IsNoRows(err) {
				d.Log.Warn("session lookup failed", "err", err)
			}
			c.Next()
			return
		}
		if time.Since(lastSeen) > time.Minute {
			if _, err := d.DB.Exec(ctx, `UPDATE sessions SET last_seen_at = now(), expires_at = now() + $2 * interval '1 second' WHERE id = $1`,
				u.SessionID, int64(d.Cfg.SessionTTL.Seconds())); err == nil {
				SetSessionCookie(c, d, token)
			}
		}
		c.Set(ctxUser, u)
		c.Next()
	}
}

// LoginHook runs after a successful login/register (cart merge). It is set by
// internal/cart so auth does not import cart.
type LoginHook func(c *gin.Context, d *platform.Deps, userID int64)

var loginHook atomic.Pointer[LoginHook]

// SetLoginHook installs the post-login hook (idempotent).
func SetLoginHook(h LoginHook) { loginHook.Store(&h) }

func runLoginHook(c *gin.Context, d *platform.Deps, userID int64) {
	if h := loginHook.Load(); h != nil {
		(*h)(c, d, userID)
	}
}
