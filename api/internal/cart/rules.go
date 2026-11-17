package cart

import (
	"context"
	"time"

	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/pricing"
	"github.com/shopship/shop/api/internal/promotions"
)

// loadRuleset is the frozen seam to promotions.LoadRuleset (docs/WAVES.md).
var loadRuleset = func(ctx context.Context, q httpx.Querier, c pricing.Cart, cust *pricing.Customer, now time.Time) (pricing.Ruleset, pricing.Context, error) {
	return promotions.LoadRuleset(ctx, q, c, cust, now)
}
