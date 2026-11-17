package email

import (
	"bytes"
	"embed"
	"fmt"
	htmltpl "html/template"
	"strings"
	texttpl "text/template"
	"time"

	"github.com/shopship/shop/api/internal/pricing"
)

//go:embed templates/*.html templates/*.txt
var templateFS embed.FS

// Brand colours and copy shared by every template.
const (
	Brand  = "ShopShip"
	Accent = "#0071E3"
)

// Data is everything a template may read. Unused fields stay zero.
type Data struct {
	Name     string // customer's display name ("" -> "ลูกค้า")
	Email    string
	WebURL   string // storefront origin
	Link     string // primary call-to-action (reset link, order page, ...)
	Order    *Order
	Shipment *Shipment

	Reason       string // cancellation reason
	WasPaid      bool   // cancelled after payment -> a refund follows
	RefundSatang int64
	LatePayment  bool // refund of a payment that arrived after the order was cancelled
	ExpiresIn    string
	Now          time.Time
}

// Order is the order summary rendered in order mails.
type Order struct {
	No            string
	URL           string // account order page
	Status        string
	PaymentMethod string // promptpay | card
	CreatedAt     time.Time
	PaidAt        time.Time // zero while unpaid
	PayURL        string    // set only while unpaid and inside the payment window
	PayBy         time.Time

	Items               []Item
	Discounts           []Line // cart-level (layers 3-4)
	SubtotalSatang      int64
	DiscountSatang      int64
	ShippingFeeSatang   int64
	ShippingDiscount    *Line // layer-5 (free shipping)
	SavingsSatang       int64
	GrandTotalSatang    int64
	CouponCode          string
	ShipName, ShipPhone string
	ShipAddress         string
	CustomerNote        string
}

// Item is one order line.
type Item struct {
	Name, Variant, SKU string
	ImageURL           string
	Qty                int
	UnitSatang         int64
	ListUnitSatang     int64
	LineTotalSatang    int64
	PriceLabel         string
	Adjustments        []Line // layer-2 (buy N get M) per line
}

// Line is a labelled discount amount (positive satang).
type Line struct {
	Label  string
	Amount int64
}

// Shipment is the parcel shown in shipped/delivered mails.
type Shipment struct {
	Carrier     string // display name
	TrackingNo  string
	TrackingURL string
}

var thaiMonths = [...]string{"ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."}

// ThaiDateTime formats t in Bangkok time with the Buddhist year:
// "17 พ.ย. 2569 14:05 น.".
func ThaiDateTime(t time.Time) string {
	b := t.In(pricing.Bangkok)
	return fmt.Sprintf("%d %s %d %02d:%02d น.", b.Day(), thaiMonths[b.Month()-1], b.Year()+543, b.Hour(), b.Minute())
}

var funcs = map[string]any{
	"baht":     pricing.FormatBaht,
	"thaidate": ThaiDateTime,
	"neg": func(satang int64) string {
		return "−" + pricing.FormatBaht(satang)
	},
	"name": func(n string) string {
		if s := strings.TrimSpace(n); s != "" {
			return s
		}
		return "ลูกค้า"
	},
	"method": func(m string) string {
		if m == "card" {
			return "บัตรเครดิต/เดบิต"
		}
		return "PromptPay"
	},
	"btn": func(url, label string) map[string]string {
		return map[string]string{"URL": url, "Label": label}
	},
	"accent": func() string { return Accent },
	"brand":  func() string { return Brand },
	"strike": func(it Item) bool { return it.ListUnitSatang > it.UnitSatang },
}

type kindTemplates struct {
	html *htmltpl.Template
	text *texttpl.Template
}

var templates = map[string]kindTemplates{}

// Kinds lists every template kind (outbox kinds + password reset).
var Kinds = []string{KindPasswordReset, KindWelcome, KindOrderPlaced, KindPaymentReceived, KindOrderShipped,
	KindOrderDelivered, KindOrderCancelled, KindOrderExpired, KindRefundIssued}

func init() {
	for _, k := range Kinds {
		h := htmltpl.Must(htmltpl.New("layout.html").Funcs(funcs).ParseFS(templateFS,
			"templates/layout.html", "templates/partials.html", "templates/"+k+".html"))
		t := texttpl.Must(texttpl.New("layout.txt").Funcs(funcs).ParseFS(templateFS,
			"templates/layout.txt", "templates/partials.txt", "templates/"+k+".txt"))
		templates[k] = kindTemplates{html: h, text: t}
	}
}

// Render builds the subject, HTML and plain-text body for kind.
func Render(kind string, d Data) (subject, html, text string, err error) {
	t, ok := templates[kind]
	if !ok {
		return "", "", "", fmt.Errorf("email: unknown template %q", kind)
	}
	if d.Now.IsZero() {
		d.Now = time.Now()
	}
	var sb, pb, tb, hb bytes.Buffer
	if err := t.text.ExecuteTemplate(&sb, "subject", d); err != nil {
		return "", "", "", err
	}
	if err := t.text.ExecuteTemplate(&pb, "preheader", d); err != nil {
		return "", "", "", err
	}
	if err := t.text.ExecuteTemplate(&tb, "layout.txt", d); err != nil {
		return "", "", "", err
	}
	subject = strings.Join(strings.Fields(sb.String()), " ")
	view := struct {
		Data
		Subject   string
		Preheader string
		Year      int
	}{d, subject, strings.Join(strings.Fields(pb.String()), " "), d.Now.In(pricing.Bangkok).Year() + 543}
	if err := t.html.ExecuteTemplate(&hb, "layout.html", view); err != nil {
		return "", "", "", err
	}
	return subject, hb.String(), tidyText(tb.String()), nil
}

// tidyText trims trailing spaces and collapses 3+ blank lines left by
// template conditionals.
func tidyText(s string) string {
	lines := strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
	var out []string
	blank := 0
	for _, l := range lines {
		l = strings.TrimRight(l, " \t")
		if l == "" {
			blank++
			if blank > 1 {
				continue
			}
		} else {
			blank = 0
		}
		out = append(out, l)
	}
	return strings.TrimSpace(strings.Join(out, "\n")) + "\n"
}
