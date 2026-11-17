package auth

import (
	"encoding/json"
	"fmt"

	"github.com/gin-gonic/gin"

	"github.com/shopship/shop/api/internal/httpx"
)

// Audit writes one audit_logs row for a back-office mutation. action is
// "area.verb" (e.g. product.update). Pass the transaction of the mutation
// when there is one so the log commits (or rolls back) with it. metadata must
// never contain secrets.
func Audit(c *gin.Context, q httpx.Querier, action, targetType string, targetID any, metadata map[string]any) error {
	var actorID *int64
	email := ""
	if u, ok := UserFrom(c); ok {
		actorID = &u.ID
		email = u.Email
	}
	if metadata == nil {
		metadata = map[string]any{}
	}
	meta, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	tid := ""
	if targetID != nil {
		tid = fmt.Sprint(targetID)
	}
	ua := c.Request.UserAgent()
	if len(ua) > 500 {
		ua = ua[:500]
	}
	_, err = q.Exec(c.Request.Context(), `INSERT INTO audit_logs (actor_user_id, actor_email, action, target_type, target_id, metadata, ip, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, actorID, email, action, targetType, tid, meta, c.ClientIP(), ua)
	return err
}
