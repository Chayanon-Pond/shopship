// Package http wires the Gin router, global middleware and every domain
// package's routes.
//
// OWNERSHIP: after Wave 0 only the coordinator edits this file. Domain agents
// add routes inside their own package's Register function.
package http

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/shopship/shop/api/internal/account"
	"github.com/shopship/shop/api/internal/admin"
	"github.com/shopship/shop/api/internal/assistant"
	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/cart"
	"github.com/shopship/shop/api/internal/catalog"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/orders"
	"github.com/shopship/shop/api/internal/payments"
	"github.com/shopship/shop/api/internal/platform"
	"github.com/shopship/shop/api/internal/promotions"
	"github.com/shopship/shop/api/internal/shipping"
)

const maxBodyBytes = 1 << 20 // 1 MiB JSON; upload routes raise their own limit

// NewRouter builds the API router. d.DB may be nil (no DATABASE_URL in dev).
func NewRouter(d *platform.Deps) *gin.Engine {
	cfg := d.Cfg
	if cfg.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(gin.Recovery(), httpx.RequestID(), gin.Logger(), securityHeaders(), cors(cfg.CORSAllowedOrigins))
	_ = r.SetTrustedProxies(cfg.TrustedProxies)
	r.HandleMethodNotAllowed = true
	r.NoRoute(func(c *gin.Context) {
		httpx.Error(c, http.StatusNotFound, httpx.CodeNotFound, "ไม่พบข้อมูล", nil)
	})

	// Liveness: process is up (Railway healthcheck).
	r.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })

	// Readiness: dependencies reachable.
	r.GET("/readyz", func(c *gin.Context) {
		if d.DB == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "no database configured"})
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		if err := d.DB.Ping(ctx); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "database unreachable"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ready"})
	})

	// Local-disk media (STORAGE_DRIVER=local).
	if cfg.StorageDriver == "local" {
		media := r.Group("/media", func(c *gin.Context) {
			// product photos are public and indexable (unlike the API); cache them in browsers/CDN for a week and
			// sandbox anything opened directly (seed SVGs)
			h := c.Writer.Header()
			h.Del("X-Robots-Tag")
			h.Set("Cache-Control", "public, max-age=604800")
			h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
			c.Next()
		})
		media.Static("/", cfg.MediaDir)
	}

	base := r.Group("/api/v1", bodyLimit(maxBodyBytes))
	base.GET("/meta", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"name": "ShopShip API", "version": "0.1.0"})
	})

	// Webhooks: no session, no CSRF (verified by provider signature/secret).
	payments.RegisterWebhooks(base, d)
	shipping.RegisterWebhooks(base, d)

	v1 := base.Group("", auth.LoadSession(d), auth.CSRF(cfg.CORSAllowedOrigins))
	rt := platform.Routes{
		V1:    v1,
		Admin: v1.Group("/admin", auth.RequireStaff(), noStore()),
	}

	auth.Register(rt, d)
	account.Register(rt, d)
	catalog.Register(rt, d)
	cart.Register(rt, d)
	orders.Register(rt, d)
	payments.Register(rt, d)
	shipping.Register(rt, d)
	carrier := shipping.CarrierFor(cfg)
	promotions.ShippingFee = func(ctx context.Context, postal string, weightGrams int) (int64, error) {
		r, err := carrier.Quote(ctx, shipping.QuoteInput{PostalCode: postal, WeightGrams: weightGrams})
		return r.FeeSatang, err
	}
	promotions.Register(rt, d)
	admin.Register(rt, d)
	assistant.Register(rt, d)

	return r
}

func securityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.Writer.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("X-Robots-Tag", "noindex, nofollow")
		c.Next()
	}
}

func noStore() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Next()
	}
}

func bodyLimit(n int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body != nil {
			limit := n
			if strings.HasPrefix(c.GetHeader("Content-Type"), "multipart/form-data") {
				limit = 9 << 20 // 8 MiB file + form overhead; handlers enforce 8 MiB per file
			}
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
		}
		c.Next()
	}
}

func cors(allowed []string) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" && slices.Contains(allowed, origin) {
			h := c.Writer.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Credentials", "true")
			h.Set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, Idempotency-Key")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			h.Add("Vary", "Origin")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
