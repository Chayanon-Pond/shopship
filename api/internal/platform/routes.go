package platform

import "github.com/gin-gonic/gin"

// Routes are the groups handed to every domain package's Register function.
//
//	V1    = /api/v1          session loaded if present (optional), origin/CSRF checked
//	Admin = /api/v1/admin    staff session required (owner|admin|staff), CSRF checked;
//	                         add auth.RequirePerm(...) per route
//
// Middleware on these groups is wired once in internal/http/router.go
// (coordinator-owned). Domain packages only add routes.
type Routes struct {
	V1    *gin.RouterGroup
	Admin *gin.RouterGroup
}
