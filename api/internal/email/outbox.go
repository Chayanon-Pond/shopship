// Package email is ShopShip's transactional email: drivers (log, file,
// resend) behind platform.Mailer, embedded Thai templates, and the
// email_outbox (migration 0007) with its worker.
//
// State changes enqueue a row in the same transaction (Enqueue*); the worker
// (RunOutbox, started by `server serve`) renders the mail from current data
// and sends it with retries. Every event has a dedupe key, so enqueueing the
// same event twice is a no-op.
//
// Owner: api-core.
package email

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/jackc/pgx/v5/pgconn"
)

// Outbox kinds. Password reset is sent synchronously (see SendPasswordReset)
// because its link carries a raw token that must not be stored.
const (
	KindWelcome         = "welcome"
	KindOrderPlaced     = "order_placed"
	KindPaymentReceived = "payment_received"
	KindOrderShipped    = "order_shipped"
	KindOrderDelivered  = "order_delivered"
	KindOrderCancelled  = "order_cancelled"
	KindOrderExpired    = "order_expired"
	KindRefundIssued    = "refund_issued"
	KindPasswordReset   = "password_reset"
)

// Execer is satisfied by pgx.Tx, *pgxpool.Pool and *pgxpool.Conn.
type Execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func marshal(payload map[string]any) []byte {
	if len(payload) == 0 {
		return []byte("{}")
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return []byte("{}")
	}
	return b
}

// EnqueueOrder queues an order mail to the order's email address. The dedupe
// key is order:<id>:<kind>[:suffix]; a second call with the same key does
// nothing. Call it inside the transaction that made the state change.
func EnqueueOrder(ctx context.Context, q Execer, kind string, orderID int64, suffix string, payload map[string]any) error {
	key := "order:" + strconv.FormatInt(orderID, 10) + ":" + kind
	if suffix != "" {
		key += ":" + suffix
	}
	_, err := q.Exec(ctx, `INSERT INTO email_outbox (kind, dedupe_key, to_email, user_id, order_id, payload)
		SELECT $1, $2, o.email, o.user_id, o.id, $4 FROM orders o WHERE o.id = $3
		ON CONFLICT (dedupe_key) DO NOTHING`, kind, key, orderID, marshal(payload))
	return err
}

// EnqueueRefund queues the refund mail for one refunded payment.
func EnqueueRefund(ctx context.Context, q Execer, orderID, paymentID, amountSatang int64, latePayment bool) error {
	return EnqueueOrder(ctx, q, KindRefundIssued, orderID, strconv.FormatInt(paymentID, 10),
		map[string]any{"amount_satang": amountSatang, "late_payment": latePayment})
}

// EnqueueWelcome queues the registration mail (once per user).
func EnqueueWelcome(ctx context.Context, q Execer, userID int64) error {
	_, err := q.Exec(ctx, `INSERT INTO email_outbox (kind, dedupe_key, to_email, user_id)
		SELECT $1, 'user:' || u.id || ':welcome', u.email, u.id FROM users u WHERE u.id = $2
		ON CONFLICT (dedupe_key) DO NOTHING`, KindWelcome, userID)
	return err
}
