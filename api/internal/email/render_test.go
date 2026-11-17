package email

import (
	"strings"
	"testing"
	"time"
)

func sampleOrder(unpaid bool) *Order {
	o := &Order{
		No: "SS261117AB12", URL: "http://localhost:3000/account/orders/SS261117AB12", Status: "paid", PaymentMethod: "promptpay",
		CreatedAt: time.Date(2026, 11, 17, 7, 5, 0, 0, time.UTC),
		Items: []Item{
			{Name: "เสื้อยืดคอตตอน", Variant: "ขาว / M", Qty: 2, UnitSatang: 19900, ListUnitSatang: 29000, LineTotalSatang: 39800, PriceLabel: "Flash Sale"},
			{Name: "ถุงเท้า", Qty: 3, UnitSatang: 5000, ListUnitSatang: 5000, LineTotalSatang: 10000,
				Adjustments: []Line{{Label: "ซื้อ 2 แถม 1", Amount: 5000}}},
		},
		Discounts:         []Line{{Label: "โค้ด WELCOME100", Amount: 10000}},
		SubtotalSatang:    123450,
		DiscountSatang:    10000,
		ShippingFeeSatang: 4000,
		ShippingDiscount:  &Line{Label: "ส่งฟรี", Amount: 4000},
		SavingsSatang:     33450,
		GrandTotalSatang:  113450,
		ShipName:          "สมชาย ใจดี", ShipPhone: "0812345678", ShipAddress: "1 ถนนสุขุมวิท คลองตัน คลองเตย กรุงเทพมหานคร 10110",
	}
	if unpaid {
		o.Status = "pending_payment"
		o.PayURL = "http://localhost:3000/checkout/pay/SS261117AB12"
		o.PayBy = time.Date(2026, 11, 17, 7, 20, 0, 0, time.UTC)
	}
	return o
}

func TestRenderOrderPlacedThaiAndBaht(t *testing.T) {
	d := Data{Name: "สมชาย", Email: "somchai@example.com", WebURL: "http://localhost:3000", Order: sampleOrder(true)}
	subject, html, text, err := Render(KindOrderPlaced, d)
	if err != nil {
		t.Fatal(err)
	}
	if subject != "ได้รับคำสั่งซื้อ SS261117AB12 แล้ว รอชำระเงิน" {
		t.Fatalf("subject = %q", subject)
	}
	for _, want := range []string{
		"฿1,234.50",       // subtotal, satang -> baht with separators
		"฿1,134.50",       // grand total
		"฿199",            // whole baht without .00
		"฿290",            // strike-through list price
		"−฿100",           // cart discount line
		"−฿50",            // layer-2 line discount
		"−฿40",            // free shipping
		"โค้ด WELCOME100", // discount label
		"คุณประหยัดไป ฿334.50", // savings
		"/checkout/pay/SS261117AB12",
		"17 พ.ย. 2569 14:20 น.", // pay-by in Bangkok time, Buddhist year
		"สวัสดีคุณสมชาย",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("html missing %q", want)
		}
		if !strings.Contains(text, want) {
			t.Errorf("text missing %q", want)
		}
	}
	if !strings.Contains(html, `lang="th"`) || !strings.Contains(html, "#0071E3") || !strings.Contains(html, `name="viewport"`) {
		t.Error("layout: lang/accent/viewport missing")
	}
	for _, body := range []string{html, text} {
		if strings.Contains(body, "<no value>") || strings.Contains(body, "ZgotmplZ") {
			t.Fatalf("template leak:\n%s", body)
		}
	}
	// paid order: no pay link, subject without "waiting for payment"
	d.Order = sampleOrder(false)
	subject, html, _, err = Render(KindOrderPlaced, d)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(html, "/checkout/pay/") || strings.Contains(subject, "รอชำระเงิน") {
		t.Fatalf("paid order still offers payment: %q", subject)
	}
}

func TestRenderEveryKind(t *testing.T) {
	now := time.Date(2026, 11, 17, 8, 0, 0, 0, time.UTC)
	base := Data{Name: "", Email: "a@example.com", WebURL: "http://localhost:3000", Link: "http://localhost:3000/reset-password?token=abc",
		ExpiresIn: "1 ชั่วโมง", Now: now, Reason: "ลูกค้ายกเลิกคำสั่งซื้อ", RefundSatang: 113450,
		Order:    sampleOrder(false),
		Shipment: &Shipment{Carrier: "Flash Express", TrackingNo: "TH0123456789", TrackingURL: "https://www.flashexpress.co.th/fle/tracking?se=TH0123456789"}}
	want := map[string][]string{
		KindPasswordReset:   {"ตั้งรหัสผ่านใหม่", "token=abc", "1 ชั่วโมง"},
		KindWelcome:         {"ยินดีต้อนรับสู่ ShopShip"},
		KindOrderPlaced:     {"SS261117AB12"},
		KindPaymentReceived: {"ชำระเงินสำเร็จ", "฿1,134.50", "PromptPay"},
		KindOrderShipped:    {"TH0123456789", "Flash Express", "flashexpress.co.th"},
		KindOrderDelivered:  {"ส่งถึงแล้ว"},
		KindOrderCancelled:  {"ยกเลิกคำสั่งซื้อ", "ลูกค้ายกเลิกคำสั่งซื้อ"},
		KindOrderExpired:    {"หมดเวลาชำระเงิน"},
		KindRefundIssued:    {"คืนเงิน ฿1,134.50"},
	}
	for _, k := range Kinds {
		subject, html, text, err := Render(k, base)
		if err != nil {
			t.Fatalf("%s: %v", k, err)
		}
		if subject == "" || strings.Contains(subject, "\n") {
			t.Fatalf("%s: bad subject %q", k, subject)
		}
		if !strings.Contains(html, "สวัสดีคุณลูกค้า") || !strings.Contains(text, "สวัสดีคุณลูกค้า") {
			t.Errorf("%s: empty name must greet ลูกค้า", k)
		}
		for _, w := range want[k] {
			if !strings.Contains(subject+html, w) || (!strings.Contains(subject+text, w) && !strings.HasPrefix(w, "flashexpress")) {
				t.Errorf("%s: missing %q", k, w)
			}
		}
		for _, body := range []string{html, text} {
			if strings.Contains(body, "<no value>") || strings.Contains(body, "ZgotmplZ") {
				t.Fatalf("%s: template leak", k)
			}
		}
	}
	if _, _, _, err := Render("nope", base); err == nil {
		t.Fatal("unknown kind must fail")
	}
}

func TestRenderEscapesUserInput(t *testing.T) {
	d := Data{Name: `<script>alert(1)</script>`, Email: "x@example.com", WebURL: "http://localhost:3000", Link: "javascript:alert(1)"}
	_, html, _, err := Render(KindWelcome, d)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(html, "<script>") || strings.Contains(html, `href="javascript:`) {
		t.Fatal("user input not escaped")
	}
}

func TestBackoff(t *testing.T) {
	cases := map[int]time.Duration{0: 30 * time.Second, 1: 30 * time.Second, 2: time.Minute, 3: 2 * time.Minute, 8: 64 * time.Minute, 9: 2 * time.Hour, 50: 2 * time.Hour}
	for n, want := range cases {
		if got := Backoff(n); got != want {
			t.Errorf("Backoff(%d) = %v, want %v", n, got, want)
		}
	}
}
