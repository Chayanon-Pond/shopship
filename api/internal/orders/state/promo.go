package state

import "github.com/shopship/shop/api/internal/promotions"

// Seams to the promotions package (idempotent release, confirm on payment,
// flash allocation give-back after a held->released reservation flip).
var (
	releasePromotions = promotions.Release
	confirmPromotions = promotions.Confirm
	releaseFlash      = promotions.ReleaseFlash
)
