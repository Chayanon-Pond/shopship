// Package shipping: carrier adapter behind the Carrier interface. MVP ships a
// flat-rate mock "flash_mock" (fee = SHIPPING_FLAT_RATE_SATANG, fake tracking
// numbers, scripted tracking events); live Flash Express comes later.
//
// Owner: Wave-1 "api-core". Routes are the frozen contract (docs/API.md).
package shipping

import (
	"context"
	"crypto/rand"
	"errors"
	"math/big"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/config"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/platform"
)

type Carrier interface {
	Name() string // flash_mock | flash
	Quote(ctx context.Context, in QuoteInput) (Rate, error)
	CreateShipment(ctx context.Context, in ShipmentInput) (Shipment, error)
	Track(ctx context.Context, trackingNo string) ([]Event, error)
}

type QuoteInput struct {
	PostalCode  string
	WeightGrams int
}

type Rate struct {
	FeeSatang int64
	EtaDays   [2]int // min, max
	Carrier   string
}

type ShipmentInput struct {
	OrderNo     string
	WeightGrams int
	Recipient   string
	Phone       string
	Address     string
	PostalCode  string
}

type Shipment struct {
	TrackingNo string
	LabelURL   string
	FeeSatang  int64
}

type Event struct {
	Status      string
	Description string
	Location    string
	OccurredAt  time.Time
}

// ErrUnavailable is returned by carriers that are not wired yet.
var ErrUnavailable = errors.New("shipping: carrier not available")

// MockCarrier is the flat-rate "flash_mock" adapter.
//
//	fee = FlatRate for parcels up to 3 kg, + 1500 satang per started kg above.
//	ETA [1,3] days; remote provinces (postal prefixes 58, 63, 94, 95, 96) [2,5].
//	Tracking numbers: "TH" + 10 digits + "MK".
type MockCarrier struct{ FlatRate int64 }

func (MockCarrier) Name() string { return "flash_mock" }

var remotePrefixes = []string{"58", "63", "94", "95", "96"}

// IsRemote reports whether the postal code is in a remote zone.
func IsRemote(postal string) bool {
	for _, p := range remotePrefixes {
		if strings.HasPrefix(postal, p) {
			return true
		}
	}
	return false
}

func (m MockCarrier) Quote(_ context.Context, in QuoteInput) (Rate, error) {
	fee := m.FlatRate
	if in.WeightGrams > 3000 {
		extraKg := (in.WeightGrams - 3000 + 999) / 1000
		fee += int64(extraKg) * 1500
	}
	eta := [2]int{1, 3}
	if IsRemote(in.PostalCode) {
		eta = [2]int{2, 5}
	}
	return Rate{FeeSatang: fee, EtaDays: eta, Carrier: m.Name()}, nil
}

func (m MockCarrier) CreateShipment(ctx context.Context, in ShipmentInput) (Shipment, error) {
	r, _ := m.Quote(ctx, QuoteInput{PostalCode: in.PostalCode, WeightGrams: in.WeightGrams})
	return Shipment{TrackingNo: MockTrackingNo(), FeeSatang: r.FeeSatang}, nil
}

// Track: mock events live in shipment_events (advanced via the mock endpoint).
func (MockCarrier) Track(context.Context, string) ([]Event, error) { return nil, nil }

// MockTrackingNo returns "TH" + 10 random digits + "MK".
func MockTrackingNo() string {
	var b strings.Builder
	b.WriteString("TH")
	for i := 0; i < 10; i++ {
		n, _ := rand.Int(rand.Reader, big.NewInt(10))
		b.WriteByte(byte('0' + n.Int64()))
	}
	b.WriteString("MK")
	return b.String()
}

type unavailableCarrier struct{ name string }

func (u unavailableCarrier) Name() string { return u.name }
func (unavailableCarrier) Quote(context.Context, QuoteInput) (Rate, error) {
	return Rate{}, ErrUnavailable
}
func (unavailableCarrier) CreateShipment(context.Context, ShipmentInput) (Shipment, error) {
	return Shipment{}, ErrUnavailable
}
func (unavailableCarrier) Track(context.Context, string) ([]Event, error) { return nil, ErrUnavailable }

// CarrierFor returns the configured carrier.
func CarrierFor(cfg config.Config) Carrier {
	if cfg.ShippingCarrier == "flash_mock" {
		rate := cfg.ShippingFlatRateSatang
		if rate <= 0 {
			rate = 4000
		}
		return MockCarrier{FlatRate: rate}
	}
	return unavailableCarrier{name: cfg.ShippingCarrier}
}

func Register(rt platform.Routes, d *platform.Deps) {
	h := &handler{d: d, carrier: CarrierFor(d.Cfg)}
	db := httpx.NeedDB(d.DB)
	rt.V1.POST("/shipping/quote", db, h.quote)
	rt.V1.GET("/orders/:order_no/tracking", auth.RequireUser(), db, h.tracking)

	a := rt.Admin
	fulfil := auth.RequirePerm(auth.PermOrdersFulfil)
	a.POST("/orders/:order_no/shipments", fulfil, db, h.createShipment)
	a.GET("/shipments/:id/label", fulfil, db, h.label)
	// Mock carrier only (404 otherwise): advance the scripted tracking one step.
	a.POST("/shipments/:id/mock-advance", fulfil, db, h.mockAdvance)
}

// RegisterWebhooks mounts carrier webhooks outside CSRF/session middleware.
func RegisterWebhooks(v1 *gin.RouterGroup, d *platform.Deps) {
	h := &handler{d: d, carrier: CarrierFor(d.Cfg)}
	v1.POST("/webhooks/shipping/:carrier", httpx.NeedDB(d.DB), h.webhook)
}
