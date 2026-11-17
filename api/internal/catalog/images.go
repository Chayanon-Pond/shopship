package catalog

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"image"
	_ "image/jpeg" // DecodeConfig
	_ "image/png"  // DecodeConfig
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/platform"
)

// MaxUploadBytes is the per-file upload limit (docs/API.md: 8 MB).
const MaxUploadBytes = 8 << 20

// Upload is a validated image upload. Images are stored as uploaded: no Go
// image-resize library is in go.mod (only the stdlib decoders), so resizing
// is deferred to the CDN / a later wave; width/height are read from the header.
type Upload struct {
	Data          []byte
	ContentType   string
	Ext           string
	Width, Height int
}

var errBadImage = errors.New("unsupported image")

// ReadUpload reads the multipart "file" field and validates it (jpeg/png/webp ≤ 8 MB).
func ReadUpload(c *gin.Context) (*Upload, map[string]string) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, MaxUploadBytes+(1<<20))
	fh, err := c.FormFile("file")
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) || strings.Contains(err.Error(), "too large") {
			return nil, map[string]string{"file": "ไฟล์ใหญ่เกิน 8 MB"}
		}
		return nil, map[string]string{"file": "กรุณาเลือกไฟล์รูปภาพ"}
	}
	if fh.Size > MaxUploadBytes {
		return nil, map[string]string{"file": "ไฟล์ใหญ่เกิน 8 MB"}
	}
	f, err := fh.Open()
	if err != nil {
		return nil, map[string]string{"file": "อ่านไฟล์ไม่ได้"}
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, MaxUploadBytes+1))
	if err != nil || len(data) > MaxUploadBytes {
		return nil, map[string]string{"file": "ไฟล์ใหญ่เกิน 8 MB"}
	}
	up, err := InspectImage(data)
	if err != nil {
		return nil, map[string]string{"file": "รองรับเฉพาะไฟล์ JPEG, PNG หรือ WebP"}
	}
	return up, nil
}

// InspectImage sniffs the type and reads dimensions.
func InspectImage(data []byte) (*Upload, error) {
	ct := http.DetectContentType(data)
	up := &Upload{Data: data, ContentType: ct}
	switch ct {
	case "image/jpeg", "image/png":
		cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			return nil, errBadImage
		}
		up.Width, up.Height = cfg.Width, cfg.Height
		up.Ext = map[string]string{"image/jpeg": "jpg", "image/png": "png"}[ct]
	case "image/webp":
		w, h, ok := webpSize(data)
		if !ok {
			return nil, errBadImage
		}
		up.Width, up.Height, up.Ext = w, h, "webp"
	default:
		return nil, errBadImage
	}
	if up.Width <= 0 || up.Height <= 0 || up.Width > 12000 || up.Height > 12000 {
		return nil, errBadImage
	}
	return up, nil
}

// webpSize parses VP8 / VP8L / VP8X headers.
func webpSize(b []byte) (int, int, bool) {
	if len(b) < 30 || string(b[0:4]) != "RIFF" || string(b[8:12]) != "WEBP" {
		return 0, 0, false
	}
	switch string(b[12:16]) {
	case "VP8 ":
		if b[23] != 0x9d || b[24] != 0x01 || b[25] != 0x2a {
			return 0, 0, false
		}
		w := int(binary.LittleEndian.Uint16(b[26:28]) & 0x3fff)
		h := int(binary.LittleEndian.Uint16(b[28:30]) & 0x3fff)
		return w, h, true
	case "VP8L":
		if b[20] != 0x2f {
			return 0, 0, false
		}
		bits := binary.LittleEndian.Uint32(b[21:25])
		return int(bits&0x3fff) + 1, int((bits>>14)&0x3fff) + 1, true
	case "VP8X":
		w := int(uint32(b[24])|uint32(b[25])<<8|uint32(b[26])<<16) + 1
		h := int(uint32(b[27])|uint32(b[28])<<8|uint32(b[29])<<16) + 1
		return w, h, true
	}
	return 0, 0, false
}

// Store puts the upload under prefix/<random>.<ext> and returns key + URL.
func Store(ctx context.Context, s platform.Storage, prefix string, up *Upload) (key, url string, err error) {
	if s == nil {
		return "", "", errors.New("storage not configured")
	}
	key = prefix + "/" + strings.ToLower(strings.ReplaceAll(auth.RandomToken(12), "_", "0")) + "." + up.Ext
	key = strings.ReplaceAll(key, "-", "0")
	url, err = s.Put(ctx, key, up.ContentType, bytes.NewReader(up.Data))
	return key, url, err
}

func (h *adminH) uploadImage(c *gin.Context) {
	pid, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	ctx := c.Request.Context()
	var exists bool
	if err := h.d.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM products WHERE id = $1 AND deleted_at IS NULL)`, pid).Scan(&exists); err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	if !exists {
		httpx.NotFound(c)
		return
	}
	up, f := ReadUpload(c)
	if f != nil {
		httpx.Validation(c, f)
		return
	}
	alt := strings.TrimSpace(c.PostForm("alt"))
	if len([]rune(alt)) > 300 {
		httpx.Validation(c, map[string]string{"alt": "ข้อความ alt ยาวเกินไป"})
		return
	}
	var variantID *int64
	if v := strings.TrimSpace(c.PostForm("variant_id")); v != "" {
		var n int64
		if err := h.d.DB.QueryRow(ctx, `SELECT id FROM product_variants WHERE id = $1::bigint AND product_id = $2`, v, pid).Scan(&n); err != nil {
			httpx.Validation(c, map[string]string{"variant_id": "ไม่พบตัวเลือกสินค้านี้"})
			return
		}
		variantID = &n
	}
	key, url, err := Store(ctx, h.d.Storage, "products/"+itoa64(pid), up)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	var im Image
	err = httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `INSERT INTO product_images (product_id, variant_id, storage_key, url, alt, width, height, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT coalesce(max(sort_order) + 1, 0) FROM product_images WHERE product_id = $1))
			RETURNING id, url, alt, width, height`, pid, variantID, key, url, alt, up.Width, up.Height).
			Scan(&im.ID, &im.URL, &im.Alt, &im.Width, &im.Height); err != nil {
			return err
		}
		return auth.Audit(c, tx, "image.create", "product", pid, map[string]any{"image_id": im.ID, "storage_key": key})
	})
	if err != nil {
		_ = h.d.Storage.Delete(ctx, key)
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusCreated, im)
}

func itoa64(n int64) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func (h *adminH) productImages(ctx context.Context, pid int64) ([]Image, error) {
	rows, err := h.d.DB.Query(ctx, `SELECT id, url, alt, width, height FROM product_images WHERE product_id = $1 ORDER BY sort_order, id`, pid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Image{}
	for rows.Next() {
		var im Image
		if err := rows.Scan(&im.ID, &im.URL, &im.Alt, &im.Width, &im.Height); err != nil {
			return nil, err
		}
		out = append(out, im)
	}
	return out, rows.Err()
}

func (h *adminH) orderImages(c *gin.Context) {
	pid, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var in struct {
		ImageIDs []int64 `json:"image_ids"`
	}
	if !httpx.BindJSON(c, &in) {
		return
	}
	ctx := c.Request.Context()
	bad := false
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM product_images WHERE product_id = $1 AND id = ANY($2)`, pid, in.ImageIDs).Scan(&n); err != nil {
			return err
		}
		if n != len(in.ImageIDs) {
			bad = true
			return nil
		}
		for i, id := range in.ImageIDs {
			if _, err := tx.Exec(ctx, `UPDATE product_images SET sort_order = $2 WHERE id = $1`, id, i); err != nil {
				return err
			}
		}
		return auth.Audit(c, tx, "image.reorder", "product", pid, map[string]any{"image_ids": in.ImageIDs})
	})
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	if bad {
		httpx.Validation(c, map[string]string{"image_ids": "มีรูปที่ไม่ใช่ของสินค้านี้"})
		return
	}
	ims, err := h.productImages(ctx, pid)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	httpx.Data(c, http.StatusOK, ims)
}

func (h *adminH) patchImage(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var in struct {
		Alt       *string `json:"alt"`
		VariantID *string `json:"-"`
	}
	var raw map[string]any
	if !httpx.BindJSON(c, &raw) {
		return
	}
	if v, ok := raw["alt"].(string); ok {
		v = strings.TrimSpace(v)
		in.Alt = &v
	}
	ctx := c.Request.Context()
	vSet := false
	var variant *int64
	if v, present := raw["variant_id"]; present {
		vSet = true
		if f, ok := v.(float64); ok {
			n := int64(f)
			variant = &n
		} else if v != nil {
			httpx.Validation(c, map[string]string{"variant_id": "ไม่ถูกต้อง"})
			return
		}
	}
	var im Image
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		var pid int64
		if err := tx.QueryRow(ctx, `SELECT product_id FROM product_images WHERE id = $1`, id).Scan(&pid); err != nil {
			return err
		}
		if variant != nil {
			var ok bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM product_variants WHERE id = $1 AND product_id = $2)`, *variant, pid).Scan(&ok); err != nil {
				return err
			}
			if !ok {
				return errBadImage
			}
		}
		if err := tx.QueryRow(ctx, `UPDATE product_images SET alt = coalesce($2, alt), variant_id = CASE WHEN $3::boolean THEN $4::bigint ELSE variant_id END
			WHERE id = $1 RETURNING id, url, alt, width, height`, id, in.Alt, vSet, variant).Scan(&im.ID, &im.URL, &im.Alt, &im.Width, &im.Height); err != nil {
			return err
		}
		return auth.Audit(c, tx, "image.update", "image", id, nil)
	})
	if errors.Is(err, errBadImage) {
		httpx.Validation(c, map[string]string{"variant_id": "ไม่พบตัวเลือกสินค้านี้"})
		return
	}
	if err != nil {
		h.writeErr(c, err)
		return
	}
	httpx.Data(c, http.StatusOK, im)
}

func (h *adminH) deleteImage(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	ctx := c.Request.Context()
	var key string
	err := httpx.InTx(ctx, h.d.DB, func(tx pgx.Tx) error {
		var pid int64
		if err := tx.QueryRow(ctx, `DELETE FROM product_images WHERE id = $1 RETURNING storage_key, product_id`, id).Scan(&key, &pid); err != nil {
			return err
		}
		return auth.Audit(c, tx, "image.delete", "product", pid, map[string]any{"image_id": id})
	})
	if err != nil {
		h.writeErr(c, err)
		return
	}
	if h.d.Storage != nil && key != "" && !strings.HasPrefix(key, "seed/") {
		_ = h.d.Storage.Delete(ctx, key)
	}
	c.Status(http.StatusNoContent)
}
