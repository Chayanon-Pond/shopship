// Package state is the order lifecycle shared by orders, payments and
// shipping: legal status moves, status history, and the side effects of
// paying (commit reservations, confirm redemptions, bump sold_count) and of
// cancelling (idempotent release of stock, flash sold_qty and promotion
// usage). It has no HTTP handlers.
//
// Owner: Wave-1 "api-core".
package state

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/email"
)

// Order statuses.
const (
	PendingPayment = "pending_payment"
	Paid           = "paid"
	Packing        = "packing"
	Shipped        = "shipped"
	Delivered      = "delivered"
	Completed      = "completed"
	Cancelled      = "cancelled"
	Refunded       = "refunded"
)

// NoteExpired is the history note of a system cancel after the payment window.
const NoteExpired = "หมดเวลาชำระเงิน"

// ErrInvalidState = illegal transition (HTTP 409 invalid_state).
var ErrInvalidState = errors.New("order: invalid state transition")

// ErrNotFound = no such order.
var ErrNotFound = errors.New("order: not found")

var legal = map[string][]string{
	PendingPayment: {Paid, Cancelled},
	Paid:           {Packing, Cancelled},
	Packing:        {Shipped, Cancelled},
	Shipped:        {Delivered},
	Delivered:      {Completed, Refunded},
	Completed:      {Refunded},
}

// Legal reports whether from -> to is an allowed move.
func Legal(from, to string) bool {
	for _, s := range legal[from] {
		if s == to {
			return true
		}
	}
	return false
}

// Lock locks the order row and returns its current status.
func Lock(ctx context.Context, tx pgx.Tx, orderID int64) (string, error) {
	var st string
	err := tx.QueryRow(ctx, `SELECT status FROM orders WHERE id = $1 FOR UPDATE`, orderID).Scan(&st)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return st, err
}

// Transition moves the (locked or not) order to `to`, applies the side
// effects, and records history. actorID nil = system.
func Transition(ctx context.Context, tx pgx.Tx, orderID int64, to string, actorID *int64, note string) (from string, err error) {
	from, err = Lock(ctx, tx, orderID)
	if err != nil {
		return "", err
	}
	if !Legal(from, to) {
		return from, fmt.Errorf("%w: %s -> %s", ErrInvalidState, from, to)
	}
	switch to {
	case Paid:
		if err := markPaid(ctx, tx, orderID); err != nil {
			return from, err
		}
	case Cancelled:
		if err := Release(ctx, tx, orderID, from != PendingPayment); err != nil {
			return from, err
		}
		if _, err := tx.Exec(ctx, `UPDATE orders SET cancelled_at = now(), cancel_reason = $2 WHERE id = $1`, orderID, note); err != nil {
			return from, err
		}
		if _, err := tx.Exec(ctx, `UPDATE payments SET status = 'expired' WHERE order_id = $1 AND status IN ('pending', 'requires_action')`, orderID); err != nil {
			return from, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE orders SET status = $2 WHERE id = $1`, orderID, to); err != nil {
		return from, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, from_status, to_status, actor_user_id, note)
		VALUES ($1, $2, $3, $4, $5)`, orderID, from, to, actorID, note); err != nil {
		return from, err
	}
	return from, enqueueMail(ctx, tx, orderID, from, to, actorID, note)
}

// enqueueMail queues the customer mail for a transition in the same tx.
// Refunded has none here: the refund mail is queued where money moves
// (payments.RefundOrder / Sync).
func enqueueMail(ctx context.Context, tx pgx.Tx, orderID int64, from, to string, actorID *int64, note string) error {
	switch to {
	case Paid:
		return email.EnqueueOrder(ctx, tx, email.KindPaymentReceived, orderID, "", nil)
	case Shipped:
		return email.EnqueueOrder(ctx, tx, email.KindOrderShipped, orderID, "", nil)
	case Delivered:
		return email.EnqueueOrder(ctx, tx, email.KindOrderDelivered, orderID, "", nil)
	case Cancelled:
		if actorID == nil && note == NoteExpired && from == PendingPayment {
			return email.EnqueueOrder(ctx, tx, email.KindOrderExpired, orderID, "", nil)
		}
		return email.EnqueueOrder(ctx, tx, email.KindOrderCancelled, orderID, "",
			map[string]any{"reason": note, "was_paid": from != PendingPayment})
	}
	return nil
}

func markPaid(ctx context.Context, tx pgx.Tx, orderID int64) error {
	if _, err := tx.Exec(ctx, `UPDATE stock_reservations SET status = 'committed' WHERE order_id = $1 AND status = 'held'`, orderID); err != nil {
		return err
	}
	if err := confirmPromotions(ctx, tx, orderID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE products p SET sold_count = p.sold_count + s.qty
		FROM (SELECT product_id, sum(qty)::int AS qty FROM order_items WHERE order_id = $1 AND product_id IS NOT NULL GROUP BY product_id) s
		WHERE p.id = s.product_id`, orderID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE orders SET paid_at = now() WHERE id = $1`, orderID)
	return err
}

// Release returns the order's stock, flash allocation and promotion usage.
// Idempotent: only reservations flipped by this call (RETURNING) restore
// anything. includeCommitted also releases committed reservations (cancel
// after payment) and takes the sold_count back.
func Release(ctx context.Context, tx pgx.Tx, orderID int64, includeCommitted bool) error {
	statuses := []string{"held"}
	if includeCommitted {
		statuses = append(statuses, "committed")
	}
	rows, err := tx.Query(ctx, `UPDATE stock_reservations SET status = 'released', released_at = now()
		WHERE order_id = $1 AND status = ANY($2)
		RETURNING variant_id, flash_sale_item_id, qty`, orderID, statuses)
	if err != nil {
		return err
	}
	type rel struct {
		variant int64
		flash   *int64
		qty     int
	}
	var rs []rel
	for rows.Next() {
		var r rel
		if err := rows.Scan(&r.variant, &r.flash, &r.qty); err != nil {
			rows.Close()
			return err
		}
		rs = append(rs, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	sort.Slice(rs, func(i, j int) bool { return rs[i].variant < rs[j].variant }) // lock order
	for _, r := range rs {
		if _, err := tx.Exec(ctx, `UPDATE product_variants SET stock = stock + $2 WHERE id = $1`, r.variant, r.qty); err != nil {
			return err
		}
		if r.flash != nil {
			if err := releaseFlash(ctx, tx, *r.flash, r.qty); err != nil {
				return err
			}
		}
	}
	if includeCommitted && len(rs) > 0 {
		if _, err := tx.Exec(ctx, `UPDATE products p SET sold_count = greatest(p.sold_count - s.qty, 0)
			FROM (SELECT product_id, sum(qty)::int AS qty FROM order_items WHERE order_id = $1 AND product_id IS NOT NULL GROUP BY product_id) s
			WHERE p.id = s.product_id`, orderID); err != nil {
			return err
		}
	}
	return releasePromotions(ctx, tx, orderID)
}

// ExpireDue cancels pending_payment orders whose payment window has passed
// (releasing their reservations). Returns the number of orders expired.
func ExpireDue(ctx context.Context, begin func(context.Context) (pgx.Tx, error), now time.Time, limit int) (int, error) {
	n := 0
	for i := 0; i < limit; i++ {
		done, err := expireOne(ctx, begin, now)
		if err != nil {
			return n, err
		}
		if !done {
			break
		}
		n++
	}
	return n, nil
}

func expireOne(ctx context.Context, begin func(context.Context) (pgx.Tx, error), now time.Time) (bool, error) {
	tx, err := begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var id int64
	err = tx.QueryRow(ctx, `SELECT id FROM orders WHERE status = 'pending_payment' AND payment_due_at <= $1
		ORDER BY payment_due_at LIMIT 1 FOR UPDATE SKIP LOCKED`, now).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if _, err := Transition(ctx, tx, id, Cancelled, nil, NoteExpired); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
}
