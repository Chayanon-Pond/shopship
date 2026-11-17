package auth

// Role values (users.role).
const (
	RoleCustomer = "customer"
	RoleStaff    = "staff"
	RoleAdmin    = "admin"
	RoleOwner    = "owner"
)

// Perm is a back-office permission. The matrix below is the source of truth
// and is mirrored in docs/API.md "RBAC" and web/src/lib/api/types.ts.
type Perm string

const (
	PermDashboardRead   Perm = "dashboard:read"
	PermCatalogRead     Perm = "catalog:read"
	PermCatalogWrite    Perm = "catalog:write" // products, variants, images, categories
	PermInventoryWrite  Perm = "inventory:write"
	PermOrdersRead      Perm = "orders:read"
	PermOrdersFulfil    Perm = "orders:fulfil" // paid->packing->shipped, create shipment
	PermOrdersManage    Perm = "orders:manage" // cancel, refund, any transition
	PermPromotionsRead  Perm = "promotions:read"
	PermPromotionsWrite Perm = "promotions:write" // promotions, codes, flash sales, campaigns
	PermCustomersRead   Perm = "customers:read"
	PermCustomersWrite  Perm = "customers:write" // assign group/tier, deactivate, customer groups
	PermBannersWrite    Perm = "banners:write"
	PermReviewsModerate Perm = "reviews:moderate"
	PermAuditRead       Perm = "audit:read"
	PermStaffManage     Perm = "staff:manage" // change roles (owner only)
)

var staffPerms = []Perm{
	PermDashboardRead, PermCatalogRead, PermInventoryWrite, PermOrdersRead, PermOrdersFulfil, PermPromotionsRead,
}

var adminPerms = append(append([]Perm{}, staffPerms...),
	PermCatalogWrite, PermOrdersManage, PermPromotionsWrite, PermCustomersRead, PermCustomersWrite,
	PermBannersWrite, PermReviewsModerate, PermAuditRead,
)

var ownerPerms = append(append([]Perm{}, adminPerms...), PermStaffManage)

var matrix = map[string]map[Perm]bool{
	RoleStaff: set(staffPerms),
	RoleAdmin: set(adminPerms),
	RoleOwner: set(ownerPerms),
}

func set(ps []Perm) map[Perm]bool {
	m := make(map[Perm]bool, len(ps))
	for _, p := range ps {
		m[p] = true
	}
	return m
}

// Can reports whether role has perm.
func Can(role string, p Perm) bool { return matrix[role][p] }

// IsStaff reports whether role may enter the back office.
func IsStaff(role string) bool { return role == RoleStaff || role == RoleAdmin || role == RoleOwner }

// Perms lists the permissions of role (for GET /auth/me).
func Perms(role string) []Perm {
	switch role {
	case RoleOwner:
		return ownerPerms
	case RoleAdmin:
		return adminPerms
	case RoleStaff:
		return staffPerms
	}
	return nil
}
