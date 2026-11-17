// Package apitest runs the real router against an embedded-PG test database
// over a real HTTP listener (cookies, CSRF, Origin) for integration tests.
// Test-only: never import from non-test code.
package apitest

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/config"
	apihttp "github.com/shopship/shop/api/internal/http"
	"github.com/shopship/shop/api/internal/platform"
	"github.com/shopship/shop/api/internal/testdb"
)

const Origin = "http://localhost:3000"
const WebhookSecret = "test-webhook-secret"

// Env is one isolated API + database.
type Env struct {
	T      testing.TB
	Pool   *pgxpool.Pool
	Deps   *platform.Deps
	Server *httptest.Server
	Mail   *Mailbox

	mu     sync.Mutex
	offset time.Duration
}

// Mailbox captures outgoing mail.
type Mailbox struct {
	mu   sync.Mutex
	Sent []platform.Mail
}

func (m *Mailbox) Send(_ context.Context, msg platform.Mail) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Sent = append(m.Sent, msg)
	return nil
}

func (m *Mailbox) Last() (platform.Mail, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.Sent) == 0 {
		return platform.Mail{}, false
	}
	return m.Sent[len(m.Sent)-1], true
}

// New starts the API on a fresh migrated database.
func New(t testing.TB) *Env {
	t.Helper()
	gin.SetMode(gin.TestMode)
	pool := testdb.New(t)
	cfg := config.Load()
	cfg.Env = "test"
	cfg.CookieSecure = false
	cfg.CORSAllowedOrigins = []string{Origin}
	cfg.PaymentProvider = "mock"
	cfg.ShippingCarrier = "flash_mock"
	cfg.ShippingFlatRateSatang = 4000
	cfg.WebhookSecret = WebhookSecret
	cfg.WebBaseURL = Origin
	cfg.StorageDriver = "local"
	cfg.MediaDir = t.TempDir()
	cfg.PublicBaseURL = "http://api.test"
	e := &Env{T: t, Pool: pool, Mail: &Mailbox{}}
	logw := io.Discard
	if os.Getenv("SHOPSHIP_TEST_API_LOG") == "1" {
		logw = os.Stderr
	}
	e.Deps = &platform.Deps{
		Cfg:     cfg,
		DB:      pool,
		Log:     slog.New(slog.NewTextHandler(logw, nil)),
		Now:     e.Now,
		Storage: platform.LocalDisk{Dir: cfg.MediaDir, BaseURL: cfg.PublicBaseURL},
		Mailer:  e.Mail,
	}
	e.Server = httptest.NewServer(apihttp.NewRouter(e.Deps))
	t.Cleanup(e.Server.Close)
	return e
}

// Now is the injectable clock (real time + Advance offset).
func (e *Env) Now() time.Time {
	e.mu.Lock()
	defer e.mu.Unlock()
	return time.Now().Add(e.offset)
}

// Advance moves the API clock forward.
func (e *Env) Advance(d time.Duration) {
	e.mu.Lock()
	e.offset += d
	e.mu.Unlock()
}

// Exec runs SQL or fails the test.
func (e *Env) Exec(sql string, args ...any) {
	e.T.Helper()
	if _, err := e.Pool.Exec(context.Background(), sql, args...); err != nil {
		e.T.Fatalf("%s: %v", sql, err)
	}
}

// Scalar scans one value or fails the test.
func (e *Env) Scalar(dst any, sql string, args ...any) {
	e.T.Helper()
	if err := e.Pool.QueryRow(context.Background(), sql, args...).Scan(dst); err != nil {
		e.T.Fatalf("%s: %v", sql, err)
	}
}

// Product creates an active product with one variant and returns the variant id.
func (e *Env) Product(slug, name string, priceSatang int64, stock int) (productID, variantID int64) {
	e.T.Helper()
	ctx := context.Background()
	var cat int64
	err := e.Pool.QueryRow(ctx, `SELECT id FROM categories WHERE slug = 'test-cat'`).Scan(&cat)
	if err != nil {
		if err := e.Pool.QueryRow(ctx, `INSERT INTO categories (slug, name) VALUES ('test-cat', 'หมวดทดสอบ') RETURNING id`).Scan(&cat); err != nil {
			e.T.Fatal(err)
		}
	}
	if err := e.Pool.QueryRow(ctx, `INSERT INTO products (slug, name, category_id, status, published_at) VALUES ($1, $2, $3, 'active', now()) RETURNING id`,
		slug, name, cat).Scan(&productID); err != nil {
		e.T.Fatal(err)
	}
	sku := strings.ToUpper(slug)
	if len(sku) > 60 {
		sku = sku[:60]
	}
	if err := e.Pool.QueryRow(ctx, `INSERT INTO product_variants (product_id, sku, name, price_satang, stock, weight_grams)
		VALUES ($1, $2, 'มาตรฐาน', $3, $4, 500) RETURNING id`, productID, sku, priceSatang, stock).Scan(&variantID); err != nil {
		e.T.Fatal(err)
	}
	return productID, variantID
}

// User inserts a user with a password and returns its id. A fast low-cost
// hash is not available, so this uses the real argon2id (~20 ms).
func (e *Env) User(email, password, role string) int64 {
	e.T.Helper()
	h, err := auth.HashPassword(password)
	if err != nil {
		e.T.Fatal(err)
	}
	var id int64
	if err := e.Pool.QueryRow(context.Background(), `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id`,
		email, h, "ผู้ทดสอบ", role).Scan(&id); err != nil {
		e.T.Fatal(err)
	}
	return id
}

// UserNoPassword inserts a user quickly (for sessions created directly).
func (e *Env) UserNoPassword(email, role string) int64 {
	e.T.Helper()
	var id int64
	if err := e.Pool.QueryRow(context.Background(), `INSERT INTO users (email, name, role) VALUES ($1, 'ผู้ทดสอบ', $2) RETURNING id`,
		email, role).Scan(&id); err != nil {
		e.T.Fatal(err)
	}
	return id
}

// Address adds a default Bangkok address and returns its id.
func (e *Env) Address(userID int64) int64 {
	e.T.Helper()
	var id int64
	if err := e.Pool.QueryRow(context.Background(), `INSERT INTO addresses (user_id, recipient_name, phone, line1, subdistrict, district, province, postal_code, is_default)
		VALUES ($1, 'ผู้รับ', '0812345678', '1 ถนนสุขุมวิท', 'คลองตัน', 'คลองเตย', 'กรุงเทพมหานคร', '10110', true) RETURNING id`, userID).Scan(&id); err != nil {
		e.T.Fatal(err)
	}
	return id
}

// ---------- client ----------

// Client is a browser-like client with a cookie jar and in-memory CSRF token.
type Client struct {
	e    *Env
	http *http.Client
	CSRF string
}

func (e *Env) Client() *Client {
	jar, _ := cookiejar.New(nil)
	return &Client{e: e, http: &http.Client{Jar: jar, Timeout: 60 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

// SessionClient is a client already signed in as userID (session created in DB).
func (e *Env) SessionClient(userID int64) *Client {
	e.T.Helper()
	c := e.Client()
	token, csrf, err := auth.CreateSession(context.Background(), e.Pool, userID, time.Hour, "127.0.0.1", "test")
	if err != nil {
		e.T.Fatal(err)
	}
	u, _ := url.Parse(e.Server.URL)
	c.http.Jar.SetCookies(u, []*http.Cookie{{Name: auth.SessionCookie, Value: token, Path: "/"}})
	c.CSRF = csrf
	return c
}

// Resp is a decoded response.
type Resp struct {
	Status int
	Header http.Header
	Body   []byte
}

// JSON decodes the body into v.
func (r Resp) JSON(t testing.TB, v any) {
	t.Helper()
	if err := json.Unmarshal(r.Body, v); err != nil {
		t.Fatalf("decode %s: %v", r.Body, err)
	}
}

// Data decodes {"data": ...} into v.
func (r Resp) Data(t testing.TB, v any) {
	t.Helper()
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	r.JSON(t, &env)
	if err := json.Unmarshal(env.Data, v); err != nil {
		t.Fatalf("decode data %s: %v", r.Body, err)
	}
}

// Code returns error.code ("" on success bodies).
func (r Resp) Code() string {
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(r.Body, &env)
	return env.Error.Code
}

// Do sends a request. Mutating requests carry Origin and the CSRF token.
func (c *Client) Do(method, path string, body any, headers ...string) Resp {
	c.e.T.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.e.Server.URL+path, rd)
	if err != nil {
		c.e.T.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if method != http.MethodGet {
		req.Header.Set("Origin", Origin)
		if c.CSRF != "" {
			req.Header.Set(auth.CSRFHeader, c.CSRF)
		}
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	res, err := c.http.Do(req)
	if err != nil {
		c.e.T.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return Resp{Status: res.StatusCode, Header: res.Header, Body: b}
}

// Raw sends a prepared request (multipart etc.).
func (c *Client) Raw(req *http.Request) Resp {
	c.e.T.Helper()
	if req.Method != http.MethodGet {
		req.Header.Set("Origin", Origin)
		if c.CSRF != "" {
			req.Header.Set(auth.CSRFHeader, c.CSRF)
		}
	}
	res, err := c.http.Do(req)
	if err != nil {
		c.e.T.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return Resp{Status: res.StatusCode, Header: res.Header, Body: b}
}

// Cookie returns the jar's cookie value for name ("" when absent).
func (c *Client) Cookie(name string) string {
	u, _ := url.Parse(c.e.Server.URL)
	for _, ck := range c.http.Jar.Cookies(u) {
		if ck.Name == name {
			return ck.Value
		}
	}
	return ""
}

// URL is the server base URL.
func (e *Env) URL() string { return e.Server.URL }

// Login signs in through the API and keeps the CSRF token.
func (c *Client) Login(email, password string) Resp {
	c.e.T.Helper()
	r := c.Do(http.MethodPost, "/api/v1/auth/login", map[string]any{"email": email, "password": password})
	if r.Status == http.StatusOK {
		var me struct {
			CSRF string `json:"csrf_token"`
		}
		r.Data(c.e.T, &me)
		c.CSRF = me.CSRF
	}
	return r
}

// Must fails unless the status matches.
func (r Resp) Must(t testing.TB, status int) Resp {
	t.Helper()
	if r.Status != status {
		t.Fatalf("status %d, want %d: %s", r.Status, status, r.Body)
	}
	return r
}
