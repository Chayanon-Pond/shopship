package auth_test

import (
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/shopship/shop/api/internal/testdb"
	"github.com/shopship/shop/api/internal/testdb/apitest"
)

func TestMain(m *testing.M) { os.Exit(testdb.Main(m)) }

type me struct {
	ID    int64    `json:"id"`
	Email string   `json:"email"`
	Role  string   `json:"role"`
	Perms []string `json:"perms"`
	CSRF  string   `json:"csrf_token"`
}

func TestAuthFlow(t *testing.T) {
	e := apitest.New(t)
	c := e.Client()

	// register -> 201 + cookie + Me
	r := c.Do("POST", "/api/v1/auth/register", map[string]any{"email": "Somchai@Example.com", "password": "correct-horse", "name": "สมชาย", "phone": "081-234-5678"}).Must(t, 201)
	var m me
	r.Data(t, &m)
	if m.Email != "somchai@example.com" || m.Role != "customer" || m.CSRF == "" || m.Perms == nil {
		t.Fatalf("me = %+v", m)
	}
	if !strings.Contains(r.Header.Get("Set-Cookie"), "HttpOnly") {
		t.Fatalf("session cookie not HttpOnly: %q", r.Header.Get("Set-Cookie"))
	}
	c.CSRF = m.CSRF
	c.Do("GET", "/api/v1/auth/me", nil).Must(t, 200)

	// duplicate email
	e.Client().Do("POST", "/api/v1/auth/register", map[string]any{"email": "somchai@example.com", "password": "another-pass", "name": "x"}).Must(t, 409)
	// validation
	if r := e.Client().Do("POST", "/api/v1/auth/register", map[string]any{"email": "bad", "password": "short", "name": ""}); r.Status != 422 || r.Code() != "validation_failed" {
		t.Fatalf("validation: %d %s", r.Status, r.Body)
	}

	// PATCH me
	r = c.Do("PATCH", "/api/v1/auth/me", map[string]any{"name": "สมชาย ใจดี", "marketing_consent": true}).Must(t, 200)
	if !strings.Contains(string(r.Body), "สมชาย ใจดี") {
		t.Fatalf("patch me: %s", r.Body)
	}

	// logout -> 204, me -> 401
	c.Do("POST", "/api/v1/auth/logout", nil).Must(t, 204)
	c.CSRF = ""
	c.Do("GET", "/api/v1/auth/me", nil).Must(t, 401)
	if r := c.Do("GET", "/api/v1/auth/me?optional=true", nil).Must(t, 200); !strings.Contains(string(r.Body), `"data":null`) {
		t.Fatalf("optional me for a guest = %s", r.Body)
	}

	// login
	if r := c.Login("somchai@example.com", "wrong-password"); r.Status != 401 {
		t.Fatalf("bad password = %d", r.Status)
	}
	c.Login("somchai@example.com", "correct-horse").Must(t, 200)

	// change password revokes other sessions
	other := e.Client()
	other.Login("somchai@example.com", "correct-horse").Must(t, 200)
	c.Do("POST", "/api/v1/auth/password/change", map[string]any{"current_password": "correct-horse", "new_password": "new-password-1"}).Must(t, 204)
	other.Do("GET", "/api/v1/auth/me", nil).Must(t, 401)
	c.Do("GET", "/api/v1/auth/me", nil).Must(t, 200)

	// forgot -> mail (log driver) -> reset (single use)
	e.Client().Do("POST", "/api/v1/auth/password/forgot", map[string]any{"email": "nobody@example.com"}).Must(t, 202)
	e.Client().Do("POST", "/api/v1/auth/password/forgot", map[string]any{"email": "somchai@example.com"}).Must(t, 202)
	mail, ok := e.Mail.Last()
	if !ok || !strings.Contains(mail.Text, "token=") {
		t.Fatalf("no reset mail: %+v", mail)
	}
	token := strings.Fields(mail.Text[strings.Index(mail.Text, "token=")+6:])[0]
	if !strings.Contains(mail.HTML, "token="+token) || !strings.Contains(mail.Subject, "ตั้งรหัสผ่านใหม่") {
		t.Fatalf("reset mail html/subject: %q", mail.Subject)
	}
	e.Client().Do("POST", "/api/v1/auth/password/reset", map[string]any{"token": token, "new_password": "reset-pass-99"}).Must(t, 204)
	e.Client().Do("POST", "/api/v1/auth/password/reset", map[string]any{"token": token, "new_password": "reset-pass-99"}).Must(t, 422)
	c.Do("GET", "/api/v1/auth/me", nil).Must(t, 401) // all sessions revoked
	c.Login("somchai@example.com", "reset-pass-99").Must(t, 200)

	// deactivated user -> 403
	e.Exec(`UPDATE users SET is_active = false WHERE email = 'somchai@example.com'`)
	if r := e.Client().Login("somchai@example.com", "reset-pass-99"); r.Status != 403 {
		t.Fatalf("inactive login = %d", r.Status)
	}
}

func TestLoginRateLimit(t *testing.T) {
	e := apitest.New(t)
	e.User("rl@example.com", "password-123", "customer")
	c := e.Client()
	for i := 0; i < 5; i++ {
		if r := c.Login("rl@example.com", "nope-nope"); r.Status != 401 {
			t.Fatalf("attempt %d = %d", i, r.Status)
		}
	}
	r := c.Login("rl@example.com", "password-123")
	if r.Status != 429 || r.Header.Get("Retry-After") == "" {
		t.Fatalf("6th attempt = %d (Retry-After %q)", r.Status, r.Header.Get("Retry-After"))
	}
}

func TestCSRFAndRBAC(t *testing.T) {
	e := apitest.New(t)
	uid := e.UserNoPassword("cust@example.com", "customer")
	c := e.SessionClient(uid)
	addr := map[string]any{"recipient_name": "ผู้รับ", "phone": "0812345678", "line1": "1 ถนน", "subdistrict": "ก", "district": "ข", "province": "กรุงเทพมหานคร", "postal_code": "10110"}

	tok := c.CSRF
	c.CSRF = "" // signed in, no token -> 403 csrf_failed
	if r := c.Do("POST", "/api/v1/me/addresses", addr); r.Status != 403 || r.Code() != "csrf_failed" {
		t.Fatalf("missing csrf = %d %s", r.Status, r.Body)
	}
	c.CSRF = "wrong-token"
	c.Do("POST", "/api/v1/me/addresses", addr).Must(t, 403)
	c.CSRF = tok
	c.Do("POST", "/api/v1/me/addresses", addr).Must(t, 201)
	// foreign origin
	if r := c.Do("POST", "/api/v1/me/addresses", addr, "Origin", "https://evil.example"); r.Status != 403 {
		t.Fatalf("foreign origin = %d", r.Status)
	}
	// customer -> admin 403; staff lacks catalog:write; admin has it
	c.Do("GET", "/api/v1/admin/dashboard", nil).Must(t, 403)
	staff := e.SessionClient(e.UserNoPassword("staff@example.com", "staff"))
	staff.Do("GET", "/api/v1/admin/dashboard", nil).Must(t, 200)
	staff.Do("POST", "/api/v1/admin/categories", map[string]any{"slug": "x", "name": "x"}).Must(t, 403)
	admin := e.SessionClient(e.UserNoPassword("admin@example.com", "admin"))
	admin.Do("POST", "/api/v1/admin/categories", map[string]any{"slug": "new-cat", "name": "หมวดใหม่"}).Must(t, 201)
	var n int
	e.Scalar(&n, `SELECT count(*) FROM audit_logs WHERE action = 'category.create' AND actor_email = 'admin@example.com'`)
	if n != 1 {
		t.Fatalf("audit rows = %d", n)
	}
	// admin cannot change roles (staff:manage is owner only); last owner protected
	if r := admin.Do("PATCH", "/api/v1/admin/users/"+itoa(uid), map[string]any{"role": "staff"}); r.Status != http.StatusForbidden {
		t.Fatalf("admin role change = %d", r.Status)
	}
	ownerID := e.UserNoPassword("owner@example.com", "owner")
	owner := e.SessionClient(ownerID)
	owner.Do("PATCH", "/api/v1/admin/users/"+itoa(uid), map[string]any{"role": "staff", "tier": "gold"}).Must(t, 200)
	if r := owner.Do("PATCH", "/api/v1/admin/users/"+itoa(ownerID), map[string]any{"role": "admin"}); r.Status != 409 {
		t.Fatalf("demote last owner = %d %s", r.Status, r.Body)
	}
}

func itoa(n int64) string {
	b := []byte{}
	if n == 0 {
		return "0"
	}
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
