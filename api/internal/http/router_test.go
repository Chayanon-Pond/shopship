package http

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/shopship/shop/api/internal/config"
	"github.com/shopship/shop/api/internal/platform"
)

func testDeps() *platform.Deps {
	cfg := config.Config{Env: "test", PaymentProvider: "mock", ShippingCarrier: "flash_mock",
		CORSAllowedOrigins: []string{"http://localhost:3000"}, StorageDriver: "none"}
	return &platform.Deps{Cfg: cfg, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), Now: time.Now}
}

// The router builds without route conflicts and the stub contract answers.
func TestRouterWiring(t *testing.T) {
	r := NewRouter(testDeps())
	if n := len(r.Routes()); n < 100 {
		t.Fatalf("expected the full Wave-0 route table, got %d routes", n)
	}
	cases := []struct {
		method, path string
		want         int
	}{
		{"GET", "/healthz", 200},
		{"GET", "/api/v1/products", 503},        // real handler, no DB configured
		{"GET", "/api/v1/orders", 401},          // RequireUser
		{"GET", "/api/v1/admin/dashboard", 401}, // RequireStaff
		{"GET", "/api/v1/nope", 404},
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		if w.Code != tc.want {
			t.Errorf("%s %s = %d, want %d", tc.method, tc.path, w.Code, tc.want)
		}
	}
	// Foreign origin is refused on unsafe methods.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/cart/items", nil)
	req.Header.Set("Origin", "https://evil.example")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("cross-origin POST = %d, want 403", w.Code)
	}
}
