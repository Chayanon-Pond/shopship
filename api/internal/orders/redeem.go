package orders

import "github.com/shopship/shop/api/internal/promotions"

// redeem is the frozen seam to promotions.Redeem (docs/WAVES.md): records
// every applied promotion, guards used_count and per-customer limits.
// Errors: *promotions.LimitError (errors.Is promotions.ErrLimitReached).
var redeem = promotions.Redeem
