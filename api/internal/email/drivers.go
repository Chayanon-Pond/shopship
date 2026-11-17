package email

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/http"
	"net/textproto"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/shopship/shop/api/internal/config"
	"github.com/shopship/shop/api/internal/platform"
)

// PermanentError marks a send failure that retrying will not fix (bad
// address, rejected sender, invalid key). The worker marks the row failed.
type PermanentError struct{ Err error }

func (e *PermanentError) Error() string { return e.Err.Error() }
func (e *PermanentError) Unwrap() error { return e.Err }

// Permanent wraps err as a PermanentError.
func Permanent(err error) error { return &PermanentError{Err: err} }

func isPermanent(err error) bool {
	var p *PermanentError
	return errors.As(err, &p)
}

type ctxKey struct{}

// WithIdempotencyKey attaches the outbox dedupe key to ctx; the Resend driver
// sends it as Idempotency-Key and the file driver uses it in file names.
func WithIdempotencyKey(ctx context.Context, key string) context.Context {
	return context.WithValue(ctx, ctxKey{}, key)
}

func idempotencyKey(ctx context.Context) string {
	s, _ := ctx.Value(ctxKey{}).(string)
	return s
}

// IDSender is implemented by drivers that return a provider message id.
type IDSender interface {
	SendID(ctx context.Context, msg platform.Mail) (string, error)
}

// New returns the mailer selected by EMAIL_DRIVER. In production any driver
// other than resend is allowed (the owner may not have a key yet) but logged
// loudly at boot.
func New(cfg config.Config, log *slog.Logger) platform.Mailer {
	var m platform.Mailer
	switch cfg.EmailDriver {
	case "file":
		m = FileMailer{Dir: cfg.MailDir, From: cfg.EmailFrom}
	case "resend":
		m = &Resend{APIKey: cfg.ResendAPIKey, From: cfg.EmailFrom, ReplyTo: cfg.EmailReplyTo}
	default:
		m = LogMailer{Log: log, Production: cfg.IsProduction()}
	}
	if cfg.IsProduction() && cfg.EmailDriver != "resend" {
		log.Warn("EMAIL_DRIVER is not resend in production: customers will NOT receive any email (set EMAIL_DRIVER=resend, RESEND_API_KEY, EMAIL_FROM)",
			"email_driver", cfg.EmailDriver)
		if cfg.EmailDriver == "file" {
			log.Warn("EMAIL_DRIVER=file in production writes mail bodies (including password-reset links) to disk", "mail_dir", cfg.MailDir)
		}
	}
	return m
}

// ---------- log ----------

// LogMailer logs mail instead of sending it. Outside production it also
// logs the plain-text body (handy in dev); in production only the envelope,
// so tokens in links never reach the logs.
type LogMailer struct {
	Log        *slog.Logger
	Production bool
}

func (m LogMailer) Send(ctx context.Context, msg platform.Mail) error {
	if m.Production {
		m.Log.Info("email (log driver, not sent)", "subject", msg.Subject, "key", idempotencyKey(ctx))
		return nil
	}
	m.Log.Info("email (log driver, not sent)", "to", msg.To, "subject", msg.Subject, "key", idempotencyKey(ctx), "text", msg.Text)
	return nil
}

// ---------- file ----------

// FileMailer writes every mail as <Dir>/<time>-<key>.eml (full MIME message,
// opens in any mail client) and a matching .html for a quick browser preview.
type FileMailer struct {
	Dir  string
	From string
}

var unsafeName = regexp.MustCompile(`[^a-z0-9_-]+`)

func (m FileMailer) Send(ctx context.Context, msg platform.Mail) error {
	_, err := m.SendID(ctx, msg)
	return err
}

func (m FileMailer) SendID(ctx context.Context, msg platform.Mail) (string, error) {
	if err := os.MkdirAll(m.Dir, 0o755); err != nil {
		return "", err
	}
	name := unsafeName.ReplaceAllString(strings.ToLower(idempotencyKey(ctx)), "-")
	if name == "" {
		name = "mail"
	}
	if len(name) > 80 {
		name = name[:80]
	}
	base := time.Now().UTC().Format("20060102T150405.000Z") + "-" + name + "-" + randHex(3)
	eml, err := BuildEML(m.From, msg, time.Now())
	if err != nil {
		return "", err
	}
	if err := writeFile(filepath.Join(m.Dir, base+".eml"), eml); err != nil {
		return "", err
	}
	if msg.HTML != "" {
		if err := writeFile(filepath.Join(m.Dir, base+".html"), []byte(msg.HTML)); err != nil {
			return "", err
		}
	}
	return base, nil
}

func writeFile(p string, b []byte) error {
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// BuildEML renders msg as an RFC 5322 multipart/alternative message (UTF-8,
// quoted-printable bodies, RFC 2047 encoded subject).
func BuildEML(from string, msg platform.Mail, now time.Time) ([]byte, error) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	h := func(k, v string) { fmt.Fprintf(&buf, "%s: %s\r\n", k, v) }
	h("From", from)
	h("To", msg.To)
	h("Subject", mime.BEncoding.Encode("utf-8", msg.Subject))
	h("Date", now.Format(time.RFC1123Z))
	h("MIME-Version", "1.0")
	h("Content-Type", `multipart/alternative; boundary="`+mw.Boundary()+`"`)
	buf.WriteString("\r\n")
	part := func(ctype, body string) error {
		w, err := mw.CreatePart(textproto.MIMEHeader{
			"Content-Type":              {ctype + "; charset=utf-8"},
			"Content-Transfer-Encoding": {"quoted-printable"},
		})
		if err != nil {
			return err
		}
		qp := quotedprintable.NewWriter(w)
		if _, err := io.WriteString(qp, body); err != nil {
			return err
		}
		return qp.Close()
	}
	if err := part("text/plain", msg.Text); err != nil {
		return nil, err
	}
	if msg.HTML != "" {
		if err := part("text/html", msg.HTML); err != nil {
			return nil, err
		}
	}
	if err := mw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ---------- resend ----------

// Resend sends through the Resend HTTP API (POST /emails). BaseURL and
// Client are overridable for tests.
type Resend struct {
	APIKey  string
	From    string
	ReplyTo string
	BaseURL string // default https://api.resend.com
	Client  *http.Client
}

func (r *Resend) Send(ctx context.Context, msg platform.Mail) error {
	_, err := r.SendID(ctx, msg)
	return err
}

func (r *Resend) SendID(ctx context.Context, msg platform.Mail) (string, error) {
	body := map[string]any{
		"from":    r.From,
		"to":      []string{msg.To},
		"subject": msg.Subject,
		"text":    msg.Text,
	}
	if msg.HTML != "" {
		body["html"] = msg.HTML
	}
	if r.ReplyTo != "" {
		body["reply_to"] = r.ReplyTo
	}
	b, err := json.Marshal(body)
	if err != nil {
		return "", Permanent(err)
	}
	base := r.BaseURL
	if base == "" {
		base = "https://api.resend.com"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/emails", bytes.NewReader(b))
	if err != nil {
		return "", Permanent(err)
	}
	req.Header.Set("Authorization", "Bearer "+r.APIKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "shopship-api")
	if k := idempotencyKey(ctx); k != "" {
		req.Header.Set("Idempotency-Key", k)
	}
	client := r.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("resend: %w", err) // network: retry
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		var out struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(rb, &out)
		return out.ID, nil
	}
	var apiErr struct {
		Name    string `json:"name"`
		Message string `json:"message"`
	}
	_ = json.Unmarshal(rb, &apiErr)
	msgText := strings.TrimSpace(apiErr.Name + ": " + apiErr.Message)
	if apiErr.Message == "" {
		msgText = strings.TrimSpace(string(rb))
		if len(msgText) > 300 {
			msgText = msgText[:300]
		}
	}
	err = fmt.Errorf("resend: HTTP %d %s", resp.StatusCode, msgText)
	// 429 and 5xx are transient; 409 is an idempotency key still being
	// processed by Resend. Other 4xx will not succeed on retry.
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusConflict || resp.StatusCode >= 500 {
		return "", err
	}
	return "", Permanent(err)
}
