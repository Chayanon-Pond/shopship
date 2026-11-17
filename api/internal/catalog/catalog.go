// Package catalog: public categories/products/search/reviews (read) and the
// admin catalog (products, variants, images, categories, inventory, review
// moderation). Public responses carry PUBLIC list prices only; personal
// prices come from GET /offers (internal/promotions).
//
// Owner: Wave-1 "api-core". Routes below are the frozen contract (docs/API.md).
package catalog

import (
	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/platform"
)

func Register(rt platform.Routes, d *platform.Deps) {
	db := httpx.NeedDB(d.DB)
	p := &public{d: d}

	v1 := rt.V1.Group("", db)
	v1.GET("/categories", p.categories)
	v1.GET("/categories/:slug", p.category)
	v1.GET("/products", p.products)
	v1.GET("/products/:slug", p.product)
	v1.GET("/products/:slug/reviews", p.reviews)
	v1.GET("/products/:slug/related", p.related)
	v1.GET("/search/suggest", p.suggest)

	h := &adminH{d: d}
	a := rt.Admin.Group("", db)
	read, write := auth.RequirePerm(auth.PermCatalogRead), auth.RequirePerm(auth.PermCatalogWrite)
	a.GET("/products", read, h.listProducts)
	a.POST("/products", write, h.createProduct)
	a.GET("/products/export.csv", read, h.exportProducts)
	a.GET("/products/import/template.csv", read, h.importTemplate)
	a.POST("/products/import", write, h.importProducts) // multipart, ?dry_run=true|false
	a.GET("/products/:id", read, h.getProduct)
	a.PATCH("/products/:id", write, h.patchProduct)
	a.DELETE("/products/:id", write, h.deleteProduct)
	a.POST("/products/:id/variants", write, h.createVariant)
	a.PATCH("/variants/:id", write, h.patchVariant)
	a.DELETE("/variants/:id", write, h.deleteVariant)
	a.GET("/variants/:id/price-history", read, h.priceHistory)
	a.POST("/products/:id/images", write, h.uploadImage) // multipart
	a.PUT("/products/:id/images/order", write, h.orderImages)
	a.PATCH("/images/:id", write, h.patchImage)
	a.DELETE("/images/:id", write, h.deleteImage)

	a.GET("/categories", read, h.listCategories)
	a.POST("/categories", write, h.createCategory)
	a.PATCH("/categories/:id", write, h.patchCategory)
	a.DELETE("/categories/:id", write, h.deleteCategory)

	a.GET("/inventory", read, h.inventory)
	a.POST("/inventory/adjust", auth.RequirePerm(auth.PermInventoryWrite), h.adjust)

	mod := auth.RequirePerm(auth.PermReviewsModerate)
	a.GET("/reviews", mod, h.listReviews)
	a.PATCH("/reviews/:id", mod, h.patchReview)
}
