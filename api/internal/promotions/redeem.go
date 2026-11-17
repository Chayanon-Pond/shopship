package promotions

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/pricing"
)

// ErrLimitReached is matched (errors.Is) by every *LimitError.
var ErrLimitReached = errors.New("promotions: limit reached")

// ErrFlashSoldOut: the flash allocation cannot cover the requested qty.
var ErrFlashSoldOut = errors.New("promotions: flash sale allocation exhausted")

// LimitError: a usage limit was hit while redeeming. Map to
// 409 limit_reached with details.reason_code = ReasonCode.
type LimitError struct {
	PromotionID int64
	ReasonCode  string // pricing.ReasonUsageLimit | pricing.ReasonPerCustomerLimit
}

func (e *LimitError) Error() string {
	return fmt.Sprintf("promotions: promotion %d: %s", e.PromotionID, e.ReasonCode)
}
func (e *LimitError) Is(target error) bool { return target == ErrLimitReached }

// AppliedPromotions returns promotion_id -> money it gave in this quote, for
// every rule that actually priced something (layer-1 price sources, layer-2
// line adjustments, layer 3/4 cart adjustments, the shipping rule). Only ok
// lines count.
func AppliedPromotions(q pricing.Quote) map[int64]int64 {
	out := map[int64]int64{}
	for _, l := range q.Lines {
		if l.Availability.Status != pricing.AvailOK {
			continue
		}
		if l.PriceSource.PromotionID != nil {
			out[*l.PriceSource.PromotionID] += int64(l.Qty) * (l.ListUnitPriceSatang - l.UnitPriceSatang)
		}
		for _, a := range l.Adjustments {
			out[a.PromotionID] += a.AmountSatang
		}
	}
	for _, a := range q.Adjustments {
		out[a.PromotionID] += a.AmountSatang
	}
	if q.Shipping.PromotionID != nil {
		out[*q.Shipping.PromotionID] += q.Shipping.DiscountSatang
	}
	return out
}

// Redeem records the quote's promotions against orderID inside the checkout
// transaction (docs/API.md §8 step 5): for each applied promotion, in id
// order (deadlock-free),
//
//	UPDATE promotions SET used_count = used_count + 1
//	 WHERE id = $1 AND (usage_limit IS NULL OR used_count < usage_limit)
//
// (0 rows => *LimitError usage_limit_reached), then the per-customer limit is
// checked against non-released redemptions — safe under READ COMMITTED because
// the UPDATE above holds the promotion's row lock until commit, so concurrent
// redeemers of the same promotion are serialized — and a 'reserved'
// promotion_redemptions row is inserted. Any error => the caller rolls back.
//
// Flash-sale allocations are NOT touched here: use ReserveFlash per line.
func Redeem(ctx context.Context, tx pgx.Tx, quote pricing.Quote, orderID, userID int64) error {
	applied := AppliedPromotions(quote)
	ids := make([]int64, 0, len(applied))
	for id := range applied {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	var couponPromo int64
	var couponCodeID *int64
	if quote.Coupon != nil && quote.Coupon.Status == pricing.CouponApplied {
		var pid, cid int64
		err := tx.QueryRow(ctx, `SELECT promotion_id, id FROM coupon_codes WHERE code = $1`, quote.Coupon.Code).Scan(&pid, &cid)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("promotions: redeem: coupon: %w", err)
		}
		if err == nil {
			couponPromo, couponCodeID = pid, &cid
		}
	}
	for _, id := range ids {
		var perCustomer *int
		err := tx.QueryRow(ctx, `UPDATE promotions SET used_count = used_count + 1
			WHERE id = $1 AND (usage_limit IS NULL OR used_count < usage_limit)
			RETURNING per_customer_limit`, id).Scan(&perCustomer)
		if errors.Is(err, pgx.ErrNoRows) {
			return &LimitError{PromotionID: id, ReasonCode: pricing.ReasonUsageLimit}
		}
		if err != nil {
			return fmt.Errorf("promotions: redeem %d: %w", id, err)
		}
		if perCustomer != nil {
			var used int
			if err := tx.QueryRow(ctx, `SELECT count(*) FROM promotion_redemptions
				WHERE promotion_id = $1 AND user_id = $2 AND status <> 'released'`, id, userID).Scan(&used); err != nil {
				return fmt.Errorf("promotions: redeem %d: %w", id, err)
			}
			if used >= *perCustomer {
				return &LimitError{PromotionID: id, ReasonCode: pricing.ReasonPerCustomerLimit}
			}
		}
		var codeID *int64
		if id == couponPromo {
			codeID = couponCodeID
		}
		amt := max(applied[id], 0)
		if _, err := tx.Exec(ctx, `INSERT INTO promotion_redemptions (promotion_id, coupon_code_id, order_id, user_id, amount_satang)
			VALUES ($1, $2, $3, $4, $5)`, id, codeID, orderID, userID, amt); err != nil {
			return fmt.Errorf("promotions: redeem %d: %w", id, err)
		}
	}
	return nil
}

// Release returns the order's redemptions (cancel / payment expiry).
// Idempotent: only rows not yet released are flipped, and only those give
// their use back.
func Release(ctx context.Context, tx pgx.Tx, orderID int64) error {
	rows, err := tx.Query(ctx, `UPDATE promotion_redemptions SET status = 'released'
		WHERE order_id = $1 AND status <> 'released' RETURNING promotion_id`, orderID)
	if err != nil {
		return fmt.Errorf("promotions: release: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		return fmt.Errorf("promotions: release: %w", err)
	}
	slices.Sort(ids)
	for _, id := range ids {
		if _, err := tx.Exec(ctx, `UPDATE promotions SET used_count = used_count - 1 WHERE id = $1 AND used_count > 0`, id); err != nil {
			return fmt.Errorf("promotions: release %d: %w", id, err)
		}
	}
	return nil
}

// Confirm marks the order's reserved redemptions confirmed (payment success).
func Confirm(ctx context.Context, tx pgx.Tx, orderID int64) error {
	_, err := tx.Exec(ctx, `UPDATE promotion_redemptions SET status = 'confirmed' WHERE order_id = $1 AND status = 'reserved'`, orderID)
	if err != nil {
		return fmt.Errorf("promotions: confirm: %w", err)
	}
	return nil
}

// ReserveFlash takes qty from a flash-sale allocation:
//
//	UPDATE flash_sale_items SET sold_qty = sold_qty + $2 WHERE id = $1 AND sold_qty + $2 <= qty_limit
//
// 0 rows => ErrFlashSoldOut (map to 409 out_of_stock).
func ReserveFlash(ctx context.Context, tx pgx.Tx, flashSaleItemID int64, qty int) error {
	tag, err := tx.Exec(ctx, `UPDATE flash_sale_items SET sold_qty = sold_qty + $2
		WHERE id = $1 AND sold_qty + $2 <= qty_limit`, flashSaleItemID, qty)
	if err != nil {
		return fmt.Errorf("promotions: reserve flash: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrFlashSoldOut
	}
	return nil
}

// ReleaseFlash gives qty back to a flash allocation. Call it only after the
// stock reservation was flipped held->released (RETURNING), which makes the
// release idempotent.
func ReleaseFlash(ctx context.Context, tx pgx.Tx, flashSaleItemID int64, qty int) error {
	_, err := tx.Exec(ctx, `UPDATE flash_sale_items SET sold_qty = greatest(sold_qty - $2, 0) WHERE id = $1`, flashSaleItemID, qty)
	if err != nil {
		return fmt.Errorf("promotions: release flash: %w", err)
	}
	return nil
}
