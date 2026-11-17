package email

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/platform"
)

// Lease is how long a claimed row is hidden from other workers while it is
// being sent (longer than the Resend client timeout).
const Lease = 5 * time.Minute

// Backoff is the wait after the n-th failed attempt (n >= 1): 30 s doubling,
// capped at 2 h. With the default 8 attempts a mail is retried for ~2 h.
func Backoff(n int) time.Duration {
	if n < 1 {
		n = 1
	}
	d := 30 * time.Second
	for i := 1; i < n; i++ {
		d *= 2
		if d >= 2*time.Hour {
			return 2 * time.Hour
		}
	}
	return d
}

// Result counts what one ProcessDue pass did.
type Result struct{ Sent, Retried, Failed int }

// ProcessDue sends up to limit due outbox rows with d.Mailer. Rows are
// claimed one at a time with FOR UPDATE SKIP LOCKED and a lease, so several
// API instances can run the worker concurrently and a crash mid-send only
// delays the mail until the lease ends.
func ProcessDue(ctx context.Context, d *platform.Deps, limit int) (Result, error) {
	var res Result
	if d.DB == nil || d.Mailer == nil {
		return res, nil
	}
	for i := 0; i < limit; i++ {
		now := d.Now().UTC()
		var r outboxRow
		err := d.DB.QueryRow(ctx, `UPDATE email_outbox SET attempts = attempts + 1, next_attempt_at = $2
			WHERE id = (SELECT id FROM email_outbox WHERE status = 'pending' AND next_attempt_at <= $1
				ORDER BY next_attempt_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
			RETURNING id, kind, dedupe_key, to_email, user_id, order_id, payload, attempts, max_attempts`,
			now, now.Add(Lease)).Scan(&r.ID, &r.Kind, &r.Key, &r.To, &r.UserID, &r.OrderID, &r.Payload, &r.Attempts, &r.MaxAttempts)
		if errors.Is(err, pgx.ErrNoRows) {
			return res, nil
		}
		if err != nil {
			return res, err
		}
		msgID, sendErr := deliver(ctx, d, r, now)
		if sendErr == nil {
			if _, err := d.DB.Exec(ctx, `UPDATE email_outbox SET status = 'sent', sent_at = $2, last_error = '',
				provider_message_id = $3 WHERE id = $1`, r.ID, d.Now().UTC(), msgID); err != nil {
				return res, err
			}
			res.Sent++
			continue
		}
		if ctx.Err() != nil {
			return res, ctx.Err() // shutting down: the lease returns the row later
		}
		errText := sendErr.Error()
		if len(errText) > 500 {
			errText = errText[:500]
		}
		if isPermanent(sendErr) || r.Attempts >= r.MaxAttempts {
			if _, err := d.DB.Exec(ctx, `UPDATE email_outbox SET status = 'failed', last_error = $2 WHERE id = $1`, r.ID, errText); err != nil {
				return res, err
			}
			res.Failed++
			d.Log.Error("email failed permanently", "outbox_id", r.ID, "kind", r.Kind, "attempts", r.Attempts, "err", errText)
			continue
		}
		next := d.Now().UTC().Add(Backoff(r.Attempts))
		if _, err := d.DB.Exec(ctx, `UPDATE email_outbox SET next_attempt_at = $2, last_error = $3 WHERE id = $1`, r.ID, next, errText); err != nil {
			return res, err
		}
		res.Retried++
		d.Log.Warn("email send failed; will retry", "outbox_id", r.ID, "kind", r.Kind, "attempts", r.Attempts, "next_attempt_at", next, "err", errText)
	}
	return res, nil
}

func deliver(ctx context.Context, d *platform.Deps, r outboxRow, now time.Time) (string, error) {
	data, err := buildData(ctx, d.DB, d.Cfg.WebBaseURL, r, now)
	if errors.Is(err, errGone) {
		return "", Permanent(err)
	}
	if err != nil {
		return "", err
	}
	subject, html, text, err := Render(r.Kind, data)
	if err != nil {
		return "", Permanent(err)
	}
	msg := platform.Mail{To: r.To, Subject: subject, HTML: html, Text: text}
	sctx := WithIdempotencyKey(ctx, r.Key)
	if s, ok := d.Mailer.(IDSender); ok {
		return s.SendID(sctx, msg)
	}
	return "", d.Mailer.Send(sctx, msg)
}

// RunOutbox drains the outbox every interval until ctx is done.
// Started by `server serve` (cmd/server/main.go).
func RunOutbox(ctx context.Context, d *platform.Deps, interval time.Duration) {
	if d.DB == nil {
		return
	}
	if interval <= 0 {
		interval = 5 * time.Second
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		if res, err := ProcessDue(ctx, d, 100); err != nil {
			if ctx.Err() == nil {
				d.Log.Error("email outbox pass failed", "err", err)
			}
		} else if res.Sent+res.Retried+res.Failed > 0 {
			d.Log.Info("email outbox", "sent", res.Sent, "retried", res.Retried, "failed", res.Failed)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
