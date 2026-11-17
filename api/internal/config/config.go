// Package config loads runtime settings from environment variables.
// Every variable is documented in api/.env.example.
package config

import (
	"errors"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port               string
	Env                string // development | staging | production
	DatabaseURL        string
	MigrateOnStart     bool
	CORSAllowedOrigins []string
	TrustedProxies     []string
	PublicBaseURL      string // absolute origin of this API, used for media URLs
	WebBaseURL         string // storefront origin, used in emails/links

	CookieSecure bool
	CookieDomain string
	SessionTTL   time.Duration

	PaymentProvider string // mock | omise
	OmisePublicKey  string
	OmiseSecretKey  string
	WebhookSecret   string // mock provider: shared secret for /payments/webhook/mock

	ShippingCarrier        string // flash_mock | flash
	ShippingFlatRateSatang int64  // mock adapter flat fee
	ReservationTTL         time.Duration

	StorageDriver string // local (r2 later)
	MediaDir      string

	EmailDriver  string // log | file | resend
	MailDir      string // file driver: each mail is written here as .eml + .html
	ResendAPIKey string
	EmailFrom    string // "ShopShip <no-reply@example.com>"; the domain must be verified at Resend
	EmailReplyTo string
}

func Load() Config {
	return Config{
		Port:                   getenv("PORT", "8080"),
		Env:                    getenv("APP_ENV", "development"),
		DatabaseURL:            os.Getenv("DATABASE_URL"),
		MigrateOnStart:         getbool("MIGRATE_ON_START", false),
		CORSAllowedOrigins:     splitCSV(getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000")),
		TrustedProxies:         splitCSV(getenv("TRUSTED_PROXIES", "127.0.0.1,::1")),
		PublicBaseURL:          strings.TrimRight(getenv("PUBLIC_BASE_URL", "http://localhost:8080"), "/"),
		WebBaseURL:             strings.TrimRight(getenv("WEB_BASE_URL", "http://localhost:3000"), "/"),
		CookieSecure:           getbool("COOKIE_SECURE", true),
		CookieDomain:           os.Getenv("COOKIE_DOMAIN"),
		SessionTTL:             getduration("SESSION_TTL", 30*24*time.Hour),
		PaymentProvider:        getenv("PAYMENT_PROVIDER", "mock"),
		OmisePublicKey:         os.Getenv("OMISE_PUBLIC_KEY"),
		OmiseSecretKey:         os.Getenv("OMISE_SECRET_KEY"),
		WebhookSecret:          os.Getenv("PAYMENT_WEBHOOK_SECRET"),
		ShippingCarrier:        getenv("SHIPPING_CARRIER", "flash_mock"),
		ShippingFlatRateSatang: getint64("SHIPPING_FLAT_RATE_SATANG", 4000),
		ReservationTTL:         getduration("RESERVATION_TTL", 15*time.Minute),
		StorageDriver:          getenv("STORAGE_DRIVER", "local"),
		MediaDir:               getenv("MEDIA_DIR", "./data/media"),
		EmailDriver:            getenv("EMAIL_DRIVER", "log"),
		MailDir:                getenv("MAIL_DIR", "./data/mail"),
		ResendAPIKey:           os.Getenv("RESEND_API_KEY"),
		EmailFrom:              getenv("EMAIL_FROM", "ShopShip <no-reply@shopship.local>"),
		EmailReplyTo:           os.Getenv("EMAIL_REPLY_TO"),
	}
}

func (c Config) IsProduction() bool { return c.Env == "production" }

// Validate refuses unsafe combinations. In particular the API must not boot
// in production with the mock payment provider or the mock carrier.
func (c Config) Validate() error {
	var errs []error
	switch c.PaymentProvider {
	case "mock", "omise":
	default:
		errs = append(errs, errors.New("PAYMENT_PROVIDER must be mock or omise"))
	}
	switch c.ShippingCarrier {
	case "flash_mock", "flash":
	default:
		errs = append(errs, errors.New("SHIPPING_CARRIER must be flash_mock or flash"))
	}
	switch c.EmailDriver {
	case "", "log", "file", "resend":
	default:
		errs = append(errs, errors.New("EMAIL_DRIVER must be log, file or resend"))
	}
	if c.EmailDriver == "resend" && (c.ResendAPIKey == "" || strings.TrimSpace(c.EmailFrom) == "") {
		errs = append(errs, errors.New("EMAIL_DRIVER=resend needs RESEND_API_KEY and EMAIL_FROM"))
	}
	// EMAIL_DRIVER=log|file in production is allowed (the owner may not have a
	// Resend key yet); email.New logs a loud warning at boot instead.
	if c.IsProduction() {
		if c.PaymentProvider == "mock" {
			errs = append(errs, errors.New("PAYMENT_PROVIDER=mock is not allowed when APP_ENV=production"))
		}
		if c.ShippingCarrier == "flash_mock" {
			errs = append(errs, errors.New("SHIPPING_CARRIER=flash_mock is not allowed when APP_ENV=production"))
		}
		if !c.CookieSecure {
			errs = append(errs, errors.New("COOKIE_SECURE=false is not allowed when APP_ENV=production"))
		}
		if c.DatabaseURL == "" {
			errs = append(errs, errors.New("DATABASE_URL is required when APP_ENV=production"))
		}
	}
	if c.PaymentProvider == "omise" && (c.OmisePublicKey == "" || c.OmiseSecretKey == "") {
		errs = append(errs, errors.New("PAYMENT_PROVIDER=omise needs OMISE_PUBLIC_KEY and OMISE_SECRET_KEY"))
	}
	return errors.Join(errs...)
}

func getenv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func getbool(key string, fallback bool) bool {
	if b, err := strconv.ParseBool(strings.TrimSpace(os.Getenv(key))); err == nil {
		return b
	}
	return fallback
}

func getint64(key string, fallback int64) int64 {
	if n, err := strconv.ParseInt(strings.TrimSpace(os.Getenv(key)), 10, 64); err == nil {
		return n
	}
	return fallback
}

func getduration(key string, fallback time.Duration) time.Duration {
	if d, err := time.ParseDuration(strings.TrimSpace(os.Getenv(key))); err == nil && d > 0 {
		return d
	}
	return fallback
}

func splitCSV(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
