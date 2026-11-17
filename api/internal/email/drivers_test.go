package email

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/mail"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shopship/shop/api/internal/config"
	"github.com/shopship/shop/api/internal/platform"
)

func TestFileMailerWritesEMLAndHTML(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "mail")
	m := FileMailer{Dir: dir, From: "ShopShip <no-reply@shopship.local>"}
	subject, html, text, err := Render(KindOrderPlaced, Data{Name: "สมชาย", WebURL: "http://localhost:3000", Order: sampleOrder(true)})
	if err != nil {
		t.Fatal(err)
	}
	ctx := WithIdempotencyKey(context.Background(), "order:7:order_placed")
	if err := m.Send(ctx, platform.Mail{To: "somchai@example.com", Subject: subject, HTML: html, Text: text}); err != nil {
		t.Fatal(err)
	}
	emls, _ := filepath.Glob(filepath.Join(dir, "*-order-7-order_placed-*.eml"))
	htmls, _ := filepath.Glob(filepath.Join(dir, "*-order-7-order_placed-*.html"))
	if len(emls) != 1 || len(htmls) != 1 {
		entries, _ := os.ReadDir(dir)
		t.Fatalf("want 1 eml + 1 html, got %v", entries)
	}
	raw, _ := os.ReadFile(htmls[0])
	if string(raw) != html {
		t.Fatal(".html preview differs from the HTML body")
	}

	f, err := os.Open(emls[0])
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	msg, err := mail.ReadMessage(f)
	if err != nil {
		t.Fatal(err)
	}
	dec := new(mime.WordDecoder)
	got, err := dec.DecodeHeader(msg.Header.Get("Subject"))
	if err != nil || got != subject {
		t.Fatalf("subject = %q (%v), want %q", got, err, subject)
	}
	if msg.Header.Get("To") != "somchai@example.com" {
		t.Fatalf("to = %q", msg.Header.Get("To"))
	}
	mt, params, err := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	if err != nil || mt != "multipart/alternative" {
		t.Fatalf("content-type %q %v", mt, err)
	}
	mr := multipart.NewReader(msg.Body, params["boundary"])
	var parts []string
	for {
		p, err := mr.NextPart() // decodes quoted-printable
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(p)
		parts = append(parts, norm(string(b)))
	}
	if len(parts) != 2 || parts[0] != norm(text) || parts[1] != norm(html) {
		t.Fatalf("eml parts do not round-trip (%d parts)", len(parts))
	}
}

func TestResendDriver(t *testing.T) {
	var gotAuth, gotKey string
	var gotBody map[string]any
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/emails" {
			http.NotFound(w, r)
			return
		}
		gotAuth, gotKey = r.Header.Get("Authorization"), r.Header.Get("Idempotency-Key")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(status)
		switch status {
		case http.StatusOK:
			_, _ = io.WriteString(w, `{"id":"re_123"}`)
		default:
			_, _ = io.WriteString(w, `{"statusCode":422,"name":"validation_error","message":"Invalid to field"}`)
		}
	}))
	defer srv.Close()
	r := &Resend{APIKey: "re_test_key", From: "ShopShip <shop@example.com>", ReplyTo: "help@example.com", BaseURL: srv.URL}
	ctx := WithIdempotencyKey(context.Background(), "order:1:payment_received")
	id, err := r.SendID(ctx, platform.Mail{To: "a@example.com", Subject: "ทดสอบ", Text: "สวัสดี", HTML: "<p>สวัสดี</p>"})
	if err != nil || id != "re_123" {
		t.Fatalf("send = %q %v", id, err)
	}
	if gotAuth != "Bearer re_test_key" || gotKey != "order:1:payment_received" {
		t.Fatalf("headers auth=%q key=%q", gotAuth, gotKey)
	}
	to, _ := gotBody["to"].([]any)
	if gotBody["from"] != "ShopShip <shop@example.com>" || len(to) != 1 || to[0] != "a@example.com" ||
		gotBody["subject"] != "ทดสอบ" || gotBody["html"] != "<p>สวัสดี</p>" || gotBody["text"] != "สวัสดี" || gotBody["reply_to"] != "help@example.com" {
		t.Fatalf("body = %v", gotBody)
	}

	status = http.StatusUnprocessableEntity
	if _, err := r.SendID(ctx, platform.Mail{To: "bad"}); err == nil || !isPermanent(err) || !strings.Contains(err.Error(), "Invalid to field") {
		t.Fatalf("422 must be permanent: %v", err)
	}
	for _, s := range []int{http.StatusTooManyRequests, http.StatusInternalServerError, http.StatusBadGateway} {
		status = s
		if _, err := r.SendID(ctx, platform.Mail{To: "a@example.com"}); err == nil || isPermanent(err) {
			t.Fatalf("%d must be retryable: %v", s, err)
		}
	}
	srv.Close()
	if _, err := r.SendID(ctx, platform.Mail{To: "a@example.com"}); err == nil || isPermanent(err) {
		t.Fatalf("network error must be retryable: %v", err)
	}
}

func norm(s string) string { return strings.TrimRight(strings.ReplaceAll(s, "\r\n", "\n"), "\n") }

func TestNewSelectsDriverAndRedactsInProduction(t *testing.T) {
	var buf strings.Builder
	log := slog.New(slog.NewTextHandler(&buf, nil))
	cfg := config.Config{Env: "production", EmailDriver: "log"}
	m := New(cfg, log)
	if !strings.Contains(buf.String(), "customers will NOT receive any email") {
		t.Fatalf("no production warning: %s", buf.String())
	}
	buf.Reset()
	if err := m.Send(context.Background(), platform.Mail{To: "a@example.com", Subject: "s", Text: "token=SECRET"}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(buf.String(), "SECRET") || strings.Contains(buf.String(), "a@example.com") {
		t.Fatalf("production log driver leaked body/recipient: %s", buf.String())
	}
	if _, ok := New(config.Config{EmailDriver: "file", MailDir: t.TempDir()}, log).(FileMailer); !ok {
		t.Fatal("file driver not selected")
	}
	if _, ok := New(config.Config{EmailDriver: "resend", ResendAPIKey: "k", EmailFrom: "a@b.c"}, log).(*Resend); !ok {
		t.Fatal("resend driver not selected")
	}
}
