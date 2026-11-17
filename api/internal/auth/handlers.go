package auth

import (
	"context"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	emailpkg "github.com/shopship/shop/api/internal/email"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/platform"
	"github.com/shopship/shop/api/internal/ratelimit"
)

// Me is the GET /auth/me shape (docs/API.md §2).
type Me struct {
	ID               int64     `json:"id"`
	Email            string    `json:"email"`
	Name             string    `json:"name"`
	Phone            string    `json:"phone"`
	Role             string    `json:"role"`
	Tier             string    `json:"tier"`
	Group            *GroupRef `json:"group"`
	MarketingConsent bool      `json:"marketing_consent"`
	EmailVerified    bool      `json:"email_verified"`
	CreatedAt        time.Time `json:"created_at"`
	Perms            []Perm    `json:"perms"`
	CSRFToken        string    `json:"csrf_token"`
}

type GroupRef struct {
	ID   int64  `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}

// LoadMe reads the Me shape for userID.
func LoadMe(ctx context.Context, q httpx.Querier, userID int64, csrf string) (Me, error) {
	var m Me
	var gid *int64
	var gcode, gname *string
	var verified *time.Time
	err := q.QueryRow(ctx, `SELECT u.id, u.email, u.name, u.phone, u.role, u.tier, u.marketing_consent,
			u.email_verified_at, u.created_at, g.id, g.code, g.name
		FROM users u LEFT JOIN customer_groups g ON g.id = u.group_id WHERE u.id = $1`, userID).
		Scan(&m.ID, &m.Email, &m.Name, &m.Phone, &m.Role, &m.Tier, &m.MarketingConsent, &verified, &m.CreatedAt,
			&gid, &gcode, &gname)
	if err != nil {
		return m, err
	}
	if gid != nil {
		m.Group = &GroupRef{ID: *gid, Code: *gcode, Name: *gname}
	}
	m.EmailVerified = verified != nil
	m.CreatedAt = m.CreatedAt.UTC()
	m.Perms = append([]Perm{}, Perms(m.Role)...)
	m.CSRFToken = csrf
	return m, nil
}

var emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

// NormalizeEmail lower-cases and trims; ok=false when invalid.
func NormalizeEmail(s string) (string, bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	if len(s) < 3 || len(s) > 254 || !emailRe.MatchString(s) {
		return s, false
	}
	if _, err := mail.ParseAddress(s); err != nil {
		return s, false
	}
	return s, true
}

// NormalizePhone strips spaces/dashes; ok=false unless 9-15 digits remain.
func NormalizePhone(s string) (string, bool) {
	s = strings.NewReplacer(" ", "", "-", "").Replace(strings.TrimSpace(s))
	if len(s) < 9 || len(s) > 15 {
		return s, false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return s, false
		}
	}
	return s, true
}

const (
	msgPasswordShort = "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"
	msgBadCreds      = "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
	msgRateLimited   = "ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่"
)

func validPassword(p string) bool {
	n := utf8.RuneCountInString(p)
	return n >= 8 && len(p) <= 256
}

type handler struct {
	d          *platform.Deps
	loginIP    *ratelimit.Limiter
	loginEmail *ratelimit.Limiter
	register   *ratelimit.Limiter
	forgot     *ratelimit.Limiter
	dummyHash  string
}

// Register mounts /auth/* (docs/API.md "Auth").
func Register(rt platform.Routes, d *platform.Deps) {
	dummy, _ := HashPassword("dummy-password-for-timing")
	h := &handler{
		d:          d,
		loginIP:    ratelimit.New(2*time.Minute, 5), // 5 / 10 min
		loginEmail: ratelimit.New(2*time.Minute, 5),
		register:   ratelimit.New(6*time.Minute, 10),
		forgot:     ratelimit.New(5*time.Minute, 3),
		dummyHash:  dummy,
	}
	g := rt.V1.Group("/auth", httpx.NeedDB(d.DB), func(c *gin.Context) { httpx.NoStore(c); c.Next() })
	g.POST("/register", h.registerUser)
	g.POST("/login", h.login)
	g.POST("/logout", h.logout)
	g.GET("/me", h.me)
	g.PATCH("/me", RequireUser(), h.patchMe)
	g.POST("/password/change", RequireUser(), h.changePassword)
	g.POST("/password/forgot", h.forgotPassword)
	g.POST("/password/reset", h.resetPassword)
	g.GET("/google/start", httpx.NotImplemented) // deferred: Google sign-in
}

func rateLimited(c *gin.Context, retryAfter int) {
	c.Header("Retry-After", itoa(retryAfter))
	httpx.Error(c, http.StatusTooManyRequests, httpx.CodeRateLimited, msgRateLimited, nil)
}

func itoa(n int) string {
	if n <= 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// startSession creates a session, sets the cookie, revokes the request's old
// session (fixation), runs the login hook and writes Me.
func (h *handler) startSession(c *gin.Context, userID int64, status int) {
	ctx := c.Request.Context()
	if old, ok := UserFrom(c); ok {
		_, _ = h.d.DB.Exec(ctx, `DELETE FROM sessions WHERE id = $1`, old.SessionID)
	}
	token, csrf, err := CreateSession(ctx, h.d.DB, userID, h.d.Cfg.SessionTTL, c.ClientIP(), c.Request.UserAgent())
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	SetSessionCookie(c, h.d, token)
	runLoginHook(c, h.d, userID)
	me, err := LoadMe(ctx, h.d.DB, userID, csrf)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, status, me)
}

func (h *handler) registerUser(c *gin.Context) {
	var in struct {
		Email            string `json:"email"`
		Password         string `json:"password"`
		Name             string `json:"name"`
		Phone            string `json:"phone"`
		MarketingConsent bool   `json:"marketing_consent"`
	}
	if !httpx.BindJSON(c, &in) {
		return
	}
	if !h.register.Allow("ip:" + c.ClientIP()) {
		rateLimited(c, 600)
		return
	}
	fields := map[string]string{}
	email, ok := NormalizeEmail(in.Email)
	if !ok {
		fields["email"] = "อีเมลไม่ถูกต้อง"
	}
	if !validPassword(in.Password) {
		fields["password"] = msgPasswordShort
	}
	name := strings.TrimSpace(in.Name)
	if name == "" || utf8.RuneCountInString(name) > 200 {
		fields["name"] = "กรุณากรอกชื่อ"
	}
	phone := ""
	if strings.TrimSpace(in.Phone) != "" {
		if phone, ok = NormalizePhone(in.Phone); !ok {
			fields["phone"] = "เบอร์โทรศัพท์ไม่ถูกต้อง"
		}
	}
	if len(fields) > 0 {
		httpx.Validation(c, fields)
		return
	}
	hash, err := HashPassword(in.Password)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	var id int64
	ctx := c.Request.Context()
	err = httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO users (email, password_hash, name, phone, marketing_consent, last_login_at)
			VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`, email, hash, name, phone, in.MarketingConsent).Scan(&id); err != nil {
			return err
		}
		return emailpkg.EnqueueWelcome(ctx, tx, id)
	})
	if err != nil {
		if httpx.IsUniqueViolation(err) {
			httpx.Conflict(c, "อีเมลนี้ถูกใช้สมัครสมาชิกแล้ว")
			return
		}
		httpx.Internal(c, h.d.Log, err)
		return
	}
	h.startSession(c, id, http.StatusCreated)
}

func (h *handler) login(c *gin.Context) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !httpx.BindJSON(c, &in) {
		return
	}
	email, _ := NormalizeEmail(in.Email)
	ipOK := h.loginIP.Allow("ip:" + c.ClientIP())
	emailOK := h.loginEmail.Allow("email:" + email)
	if !ipOK || !emailOK {
		rateLimited(c, 600)
		return
	}
	var id int64
	var hash *string
	var active bool
	err := h.d.DB.QueryRow(c.Request.Context(), `SELECT id, password_hash, is_active FROM users
		WHERE email = $1 AND deleted_at IS NULL`, email).Scan(&id, &hash, &active)
	if err != nil && !httpx.IsNoRows(err) {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	if err != nil || hash == nil {
		_, _ = VerifyPassword(in.Password, h.dummyHash) // no user enumeration via timing
		httpx.Error(c, http.StatusUnauthorized, httpx.CodeUnauthorized, msgBadCreds, nil)
		return
	}
	if ok, _ := VerifyPassword(in.Password, *hash); !ok {
		httpx.Error(c, http.StatusUnauthorized, httpx.CodeUnauthorized, msgBadCreds, nil)
		return
	}
	if !active {
		httpx.Error(c, http.StatusForbidden, httpx.CodeForbidden, "บัญชีนี้ถูกระงับการใช้งาน", nil)
		return
	}
	_, _ = h.d.DB.Exec(c.Request.Context(), `UPDATE users SET last_login_at = now() WHERE id = $1`, id)
	h.startSession(c, id, http.StatusOK)
}

func (h *handler) logout(c *gin.Context) {
	if u, ok := UserFrom(c); ok {
		if _, err := h.d.DB.Exec(c.Request.Context(), `DELETE FROM sessions WHERE id = $1`, u.SessionID); err != nil {
			httpx.Internal(c, h.d.Log, err)
			return
		}
	}
	ClearCookie(c, h.d, SessionCookie)
	c.Status(http.StatusNoContent)
}

func (h *handler) me(c *gin.Context) {
	u, ok := UserFrom(c)
	if !ok {
		// ?optional=true (additive, Wave 2): guests get 200 {data: null} instead of a 401, so the storefront's
		// session probe does not log a failed request in every guest's browser console.
		if c.Query("optional") == "true" {
			c.Header("Cache-Control", "no-store")
			c.JSON(http.StatusOK, gin.H{"data": nil})
			return
		}
		httpx.Error(c, http.StatusUnauthorized, httpx.CodeUnauthorized, "กรุณาเข้าสู่ระบบ", nil)
		return
	}
	me, err := LoadMe(c.Request.Context(), h.d.DB, u.ID, u.CSRFToken)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusOK, me)
}

func (h *handler) patchMe(c *gin.Context) {
	u, _ := UserFrom(c)
	var in struct {
		Name             *string `json:"name"`
		Phone            *string `json:"phone"`
		MarketingConsent *bool   `json:"marketing_consent"`
	}
	if !httpx.BindJSON(c, &in) {
		return
	}
	fields := map[string]string{}
	var name, phone *string
	if in.Name != nil {
		n := strings.TrimSpace(*in.Name)
		if n == "" || utf8.RuneCountInString(n) > 200 {
			fields["name"] = "กรุณากรอกชื่อ"
		}
		name = &n
	}
	if in.Phone != nil {
		p := ""
		if strings.TrimSpace(*in.Phone) != "" {
			var ok bool
			if p, ok = NormalizePhone(*in.Phone); !ok {
				fields["phone"] = "เบอร์โทรศัพท์ไม่ถูกต้อง"
			}
		}
		phone = &p
	}
	if len(fields) > 0 {
		httpx.Validation(c, fields)
		return
	}
	ctx := c.Request.Context()
	if _, err := h.d.DB.Exec(ctx, `UPDATE users SET name = coalesce($2, name), phone = coalesce($3, phone),
		marketing_consent = coalesce($4, marketing_consent) WHERE id = $1`, u.ID, name, phone, in.MarketingConsent); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	me, err := LoadMe(ctx, h.d.DB, u.ID, u.CSRFToken)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusOK, me)
}

func (h *handler) changePassword(c *gin.Context) {
	u, _ := UserFrom(c)
	var in struct {
		Current string `json:"current_password"`
		New     string `json:"new_password"`
	}
	if !httpx.BindJSON(c, &in) {
		return
	}
	if !h.loginIP.Allow("pwchange:" + itoa(int(u.ID))) {
		rateLimited(c, 600)
		return
	}
	ctx := c.Request.Context()
	var hash *string
	if err := h.d.DB.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1`, u.ID).Scan(&hash); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	if hash == nil {
		httpx.Validation(c, map[string]string{"current_password": "รหัสผ่านปัจจุบันไม่ถูกต้อง"})
		return
	}
	if ok, _ := VerifyPassword(in.Current, *hash); !ok {
		httpx.Validation(c, map[string]string{"current_password": "รหัสผ่านปัจจุบันไม่ถูกต้อง"})
		return
	}
	if !validPassword(in.New) {
		httpx.Validation(c, map[string]string{"new_password": msgPasswordShort})
		return
	}
	nh, err := HashPassword(in.New)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	err = httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1`, u.ID, nh); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1 AND id <> $2`, u.ID, u.SessionID)
		return err
	})
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *handler) forgotPassword(c *gin.Context) {
	var in struct {
		Email string `json:"email"`
	}
	if !httpx.BindJSON(c, &in) {
		return
	}
	email, ok := NormalizeEmail(in.Email)
	accepted := func() {
		c.JSON(http.StatusAccepted, gin.H{"data": gin.H{"status": "accepted"}})
	}
	if !ok || !h.forgot.Allow("ip:"+c.ClientIP()) || !h.forgot.Allow("email:"+email) {
		accepted()
		return
	}
	ctx := c.Request.Context()
	var id int64
	var name string
	err := h.d.DB.QueryRow(ctx, `SELECT id, name FROM users WHERE email = $1 AND is_active AND deleted_at IS NULL`, email).Scan(&id, &name)
	if err != nil {
		if !httpx.IsNoRows(err) {
			h.d.Log.Error("forgot password lookup", "err", err)
		}
		accepted()
		return
	}
	token := RandomToken(32)
	if _, err := h.d.DB.Exec(ctx, `INSERT INTO user_tokens (user_id, purpose, token_hash, expires_at)
		VALUES ($1, 'password_reset', $2, now() + interval '1 hour')`, id, HashToken(token)); err != nil {
		h.d.Log.Error("forgot password token", "err", err)
		accepted()
		return
	}
	link := h.d.Cfg.WebBaseURL + "/reset-password?token=" + token
	if h.d.Mailer != nil {
		if err := emailpkg.SendPasswordReset(ctx, h.d.Mailer, h.d.Cfg.WebBaseURL, email, name, link, "1 ชั่วโมง"); err != nil {
			h.d.Log.Error("forgot password mail", "err", err)
		}
	}
	if !h.d.Cfg.IsProduction() {
		// Log driver in dev: make the link usable without a mailbox.
		h.d.Log.Info("password reset link (dev only)", "email", email, "link", link)
	}
	accepted()
}

func (h *handler) resetPassword(c *gin.Context) {
	var in struct {
		Token string `json:"token"`
		New   string `json:"new_password"`
	}
	if !httpx.BindJSON(c, &in) {
		return
	}
	if !validPassword(in.New) {
		httpx.Validation(c, map[string]string{"new_password": msgPasswordShort})
		return
	}
	nh, err := HashPassword(in.New)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	ctx := c.Request.Context()
	bad := false
	err = httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		var uid int64
		err := tx.QueryRow(ctx, `UPDATE user_tokens SET used_at = now()
			WHERE token_hash = $1 AND purpose = 'password_reset' AND used_at IS NULL AND expires_at > now()
			RETURNING user_id`, HashToken(strings.TrimSpace(in.Token))).Scan(&uid)
		if httpx.IsNoRows(err) {
			bad = true
			return nil
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1`, uid, nh); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, uid)
		return err
	})
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	if bad {
		httpx.Validation(c, map[string]string{"token": "ลิงก์ตั้งรหัสผ่านหมดอายุหรือถูกใช้ไปแล้ว"})
		return
	}
	ClearCookie(c, h.d, SessionCookie)
	c.Status(http.StatusNoContent)
}
