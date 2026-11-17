package config

import "testing"

func TestValidateRefusesMockProviderInProduction(t *testing.T) {
	c := Config{Env: "production", PaymentProvider: "mock", ShippingCarrier: "flash", CookieSecure: true, DatabaseURL: "x"}
	if c.Validate() == nil {
		t.Fatal("mock payment provider must be refused in production")
	}
	c.PaymentProvider, c.OmisePublicKey, c.OmiseSecretKey = "omise", "pk", "sk"
	if err := c.Validate(); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	dev := Config{Env: "development", PaymentProvider: "mock", ShippingCarrier: "flash_mock"}
	if err := dev.Validate(); err != nil {
		t.Fatalf("dev with mocks must boot: %v", err)
	}
}

func TestValidateEmailDriver(t *testing.T) {
	base := Config{Env: "development", PaymentProvider: "mock", ShippingCarrier: "flash_mock"}
	for _, d := range []string{"", "log", "file"} {
		c := base
		c.EmailDriver = d
		if err := c.Validate(); err != nil {
			t.Fatalf("%q: %v", d, err)
		}
	}
	c := base
	c.EmailDriver = "smtp"
	if c.Validate() == nil {
		t.Fatal("unknown driver must be refused")
	}
	c.EmailDriver = "resend"
	if c.Validate() == nil {
		t.Fatal("resend without a key must be refused")
	}
	c.ResendAPIKey, c.EmailFrom = "re_x", "ShopShip <shop@example.com>"
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
	// production with the log driver boots (warned at startup, not refused)
	prod := Config{Env: "production", PaymentProvider: "omise", OmisePublicKey: "pk", OmiseSecretKey: "sk",
		ShippingCarrier: "flash", CookieSecure: true, DatabaseURL: "x", EmailDriver: "log"}
	if err := prod.Validate(); err != nil {
		t.Fatalf("production + log must boot: %v", err)
	}
}
