package email

import (
	"context"

	"github.com/shopship/shop/api/internal/platform"
)

// SendPasswordReset renders and sends the reset mail synchronously. It is
// not queued: the link carries the raw token, which must never be stored.
func SendPasswordReset(ctx context.Context, m platform.Mailer, webBase, to, name, link, expiresIn string) error {
	subject, html, text, err := Render(KindPasswordReset, Data{Name: name, Email: to, WebURL: webBase, Link: link, ExpiresIn: expiresIn})
	if err != nil {
		return err
	}
	return m.Send(ctx, platform.Mail{To: to, Subject: subject, HTML: html, Text: text})
}
