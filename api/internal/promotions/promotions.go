// Package promotions: the data side of pricing. Loads pricing.Ruleset and
// customer usage from Postgres, records redemptions with the usage-limit
// guards, serves public campaign/flash-sale/banner/offer endpoints and the
// admin CRUD for promotions (all kinds), coupon codes, flash sales,
// campaigns and customer groups.
//
// Entry points for other packages (api-core cart/orders/catalog/seed):
//
//	LoadRuleset(ctx, q, cart, customer, now) (pricing.Ruleset, pricing.Context, error)  // frozen
//	LoadLines(ctx, q, items) / AttachPriceHistory(ctx, q, lines, rs)                     // build pricing.Cart lines
//	Quote(ctx, q, QuoteInput{...}) (pricing.Quote, error)                                // all of the above + pricing.Price
//	Redeem(ctx, tx, quote, orderID, userID) / Release(ctx, tx, orderID) / Confirm(...)  // frozen (+Confirm)
//	ReserveFlash / ReleaseFlash(ctx, tx, flashSaleItemID, qty)                            // flash allocation guards
//	ProductCards / FlashBadges / ProductBadges(ctx, q, productIDs, now)                   // catalog helpers
//	SeedDemo(ctx, q)                                                                       // demo data
//
// Owner: Wave-1 "pricing" agent (together with internal/pricing).
// Routes are the frozen contract (docs/API.md).
package promotions

import (
	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/platform"
)

type handlers struct{ d *platform.Deps }

func Register(rt platform.Routes, d *platform.Deps) {
	h := &handlers{d: d}

	v1 := rt.V1
	v1.GET("/campaigns/active", h.campaignActive)
	v1.GET("/banners", h.banners)
	v1.GET("/flash-sales/current", h.flashSalesCurrent)
	v1.GET("/offers", h.offers) // personal (member/trade/flash) prices; Cache-Control: no-store

	a := rt.Admin
	read, write := auth.RequirePerm(auth.PermPromotionsRead), auth.RequirePerm(auth.PermPromotionsWrite)
	a.GET("/promotions", read, h.listPromotions)
	a.POST("/promotions", write, h.createPromotion)
	a.GET("/promotions/:id", read, h.getPromotion)
	a.PATCH("/promotions/:id", write, h.patchPromotion)
	a.DELETE("/promotions/:id", write, h.deletePromotion)
	a.POST("/promotions/:id/codes", write, h.addCodes)
	a.DELETE("/coupon-codes/:id", write, h.deactivateCode)
	a.GET("/promotions/:id/redemptions", read, h.redemptions)
	a.POST("/promotions/preview", read, h.preview) // price a hypothetical cart with draft rules

	a.GET("/flash-sales", read, h.listFlashSales)
	a.POST("/flash-sales", write, h.createFlashSale)
	a.GET("/flash-sales/:id", read, h.getFlashSale)
	a.PATCH("/flash-sales/:id", write, h.patchFlashSale)
	a.DELETE("/flash-sales/:id", write, h.deleteFlashSale)
	a.PUT("/flash-sales/:id/items", write, h.putFlashItems)

	a.GET("/campaigns", read, h.listCampaigns)
	a.POST("/campaigns", write, h.createCampaign)
	a.PATCH("/campaigns/:id", write, h.patchCampaign)
	a.DELETE("/campaigns/:id", write, h.deleteCampaign)

	cr, cw := auth.RequirePerm(auth.PermCustomersRead), auth.RequirePerm(auth.PermCustomersWrite)
	a.GET("/customer-groups", cr, h.listGroups)
	a.POST("/customer-groups", cw, h.createGroup)
	a.PATCH("/customer-groups/:id", cw, h.patchGroup)
	a.DELETE("/customer-groups/:id", cw, h.deleteGroup)
}
