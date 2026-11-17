// Package assistant is the storefront shop assistant ("ผู้ช่วย ShopShip"):
// POST /api/v1/assistant/chat.
//
// Two brains share one read-only toolbox (tools.go):
//   - rules (default, offline): Thai keyword intent classification -> tools ->
//     templated Thai replies (intent.go);
//   - Claude (when ANTHROPIC_API_KEY is set): Messages API tool use over the
//     same tools (llm.go). Any LLM error falls back to the rules brain.
//
// Tools are scoped to the caller: public catalog prices only (never member,
// group or trade prices), orders only for the signed-in owner or order number
// + email for guests. Message text is never logged.
//
// Owner: Wave 3 "assistant".
package assistant

import (
	"context"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"github.com/shopship/shop/api/internal/auth"
	"github.com/shopship/shop/api/internal/httpx"
	"github.com/shopship/shop/api/internal/platform"
	"github.com/shopship/shop/api/internal/ratelimit"
	"github.com/shopship/shop/api/internal/shipping"
)

const (
	maxHistory      = 10  // messages kept (newest)
	maxUserRunes    = 500 // last user message
	maxHistoryRunes = 1000
	defaultModel    = "claude-haiku-5-5"
)

var allowedModels = map[string]bool{"claude-haiku-5-5": true, "claude-sonnet-5-5": true}

// Settings come from the environment (documented in api/.env.example).
type Settings struct {
	APIKey      string
	BaseURL     string
	Model       string
	MaxTokens   int
	Timeout     time.Duration
	Contact     Contact
	RatePerMin  int
	GuestOrders int // guest order lookups per IP per 10 min
}

// Contact is where the bot hands off to a human.
type Contact struct {
	LineURL string
	Email   string
	Phone   string
}

// LoadSettings reads ASSISTANT_* / ANTHROPIC_* variables.
func LoadSettings() (Settings, string) {
	s := Settings{
		APIKey:      strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY")),
		BaseURL:     strings.TrimRight(env("ANTHROPIC_BASE_URL", "https://api.anthropic.com"), "/"),
		Model:       env("ASSISTANT_MODEL", defaultModel),
		MaxTokens:   envInt("ASSISTANT_MAX_TOKENS", 1024),
		Timeout:     envDuration("ASSISTANT_TIMEOUT", 15*time.Second),
		RatePerMin:  envInt("ASSISTANT_RATE_PER_MIN", 20),
		GuestOrders: 5,
		Contact: Contact{
			LineURL: strings.TrimSpace(os.Getenv("ASSISTANT_CONTACT_LINE_URL")),
			Email:   env("ASSISTANT_CONTACT_EMAIL", "support@shopship.example"),
			Phone:   env("ASSISTANT_CONTACT_PHONE", "02-000-0000"),
		},
	}
	warn := ""
	if !allowedModels[s.Model] {
		warn = "ASSISTANT_MODEL not allowed, using " + defaultModel
		s.Model = defaultModel
	}
	if s.MaxTokens < 256 || s.MaxTokens > 4096 {
		s.MaxTokens = 1024
	}
	if s.RatePerMin < 1 {
		s.RatePerMin = 20
	}
	return s, warn
}

// ---------- wire shapes (docs/API.md §14) ----------

type Message struct {
	Role    string `json:"role"` // user | assistant
	Content string `json:"content"`
}

type ChatRequest struct {
	Messages []Message `json:"messages"`
	Context  *struct {
		ProductSlug string `json:"product_slug"`
	} `json:"context"`
}

// Card is a product card as the public sees it.
type Card struct {
	Slug            string `json:"slug"`
	Name            string `json:"name"`
	PriceSatang     int64  `json:"price_satang"` // public flash price when on flash sale, else public min list price
	PriceFrom       bool   `json:"price_from"`   // variants have different prices ("เริ่มต้น")
	Lowest30dSatang *int64 `json:"lowest_30d_satang"`
	OnFlashSale     bool   `json:"on_flash_sale"`
	ImageURL        string `json:"image_url"`
	InStock         bool   `json:"in_stock"`
	VariantID       *int64 `json:"variant_id"` // set only when the product has exactly one active variant in stock
}

type Action struct {
	Kind  string `json:"kind"` // link
	Label string `json:"label"`
	Href  string `json:"href"`
}

type ChatResponse struct {
	Reply       string   `json:"reply"`
	Suggestions []string `json:"suggestions"`
	Products    []Card   `json:"products"`
	Actions     []Action `json:"actions"`
	Source      string   `json:"source"` // rules | llm
}

// Caller is who is asking (tools are scoped to it).
type Caller struct {
	UserID int64 // 0 = guest
	Name   string
	IP     string
}

// Input is one turn for a brain.
type Input struct {
	Caller      Caller
	Messages    []Message // oldest first, last is the user's
	ProductSlug string
}

// Brain answers one turn.
type Brain interface {
	Reply(ctx context.Context, in Input) (ChatResponse, error)
}

// Service picks the LLM brain when configured and falls back to rules.
type Service struct {
	Rules *RuleBrain
	LLM   Brain // nil = rules only
	Log   interface {
		Warn(msg string, args ...any)
	}
}

func (s *Service) Reply(ctx context.Context, in Input) (ChatResponse, error) {
	if s.LLM != nil {
		out, err := s.LLM.Reply(ctx, in)
		if err == nil {
			return normalize(out), nil
		}
		if s.Log != nil {
			s.Log.Warn("assistant llm fallback", "err", errClass(err))
		}
	}
	out, err := s.Rules.Reply(ctx, in)
	return normalize(out), err
}

func normalize(r ChatResponse) ChatResponse {
	if r.Suggestions == nil {
		r.Suggestions = []string{}
	}
	if r.Products == nil {
		r.Products = []Card{}
	}
	if r.Actions == nil {
		r.Actions = []Action{}
	}
	if len(r.Products) > 6 {
		r.Products = r.Products[:6]
	}
	if len(r.Suggestions) > 4 {
		r.Suggestions = r.Suggestions[:4]
	}
	return r
}

// ---------- HTTP ----------

type handler struct {
	d      *platform.Deps
	svc    *Service
	ipLim  *ratelimit.Limiter
	usrLim *ratelimit.Limiter
}

// Register mounts POST /assistant/chat on V1 (session optional, CSRF/Origin
// checked by the group middleware).
func Register(rt platform.Routes, d *platform.Deps) {
	s, warn := LoadSettings()
	if warn != "" {
		d.Log.Warn(warn)
	}
	h := newHandler(d, s)
	rt.V1.POST("/assistant/chat", httpx.NeedDB(d.DB), h.chat)
}

func newHandler(d *platform.Deps, s Settings) *handler {
	tools := &Tools{
		d:        d,
		carrier:  shipping.CarrierFor(d.Cfg),
		guestLim: ratelimit.New(10*time.Minute/time.Duration(s.GuestOrders), s.GuestOrders),
		contact:  s.Contact,
	}
	svc := &Service{Rules: &RuleBrain{T: tools}, Log: d.Log}
	if s.APIKey != "" {
		svc.LLM = &ClaudeBrain{T: tools, S: s, HTTP: &http.Client{Timeout: s.Timeout}}
	}
	every := time.Minute / time.Duration(s.RatePerMin)
	return &handler{d: d, svc: svc, ipLim: ratelimit.New(every, s.RatePerMin), usrLim: ratelimit.New(every, s.RatePerMin)}
}

func (h *handler) chat(c *gin.Context) {
	httpx.NoStore(c)
	caller := Caller{IP: c.ClientIP()}
	u, signedIn := auth.UserFrom(c)
	if signedIn {
		caller.UserID, caller.Name = u.ID, u.Name
	}
	ok := h.ipLim.Allow("ip:" + caller.IP)
	if signedIn {
		ok = h.usrLim.Allow("u:"+strconv.FormatInt(u.ID, 10)) && ok
	}
	if !ok {
		c.Header("Retry-After", "10")
		httpx.Error(c, http.StatusTooManyRequests, httpx.CodeRateLimited, "ส่งข้อความถี่เกินไป กรุณารอสักครู่แล้วลองใหม่", nil)
		return
	}

	var req ChatRequest
	if !httpx.BindJSON(c, &req) {
		return
	}
	msgs, field := clean(req.Messages)
	if field != "" {
		httpx.Validation(c, map[string]string{"messages": field})
		return
	}
	in := Input{Caller: caller, Messages: msgs}
	if req.Context != nil {
		in.ProductSlug = strings.TrimSpace(req.Context.ProductSlug)
		if len(in.ProductSlug) > 160 {
			in.ProductSlug = ""
		}
	}
	start := time.Now()
	out, err := h.svc.Reply(c.Request.Context(), in)
	if err != nil {
		httpx.Internal(c, h.d.Log, err)
		return
	}
	// metadata only: never the message text (PII)
	h.d.Log.Info("assistant reply", "source", out.Source, "products", len(out.Products), "signed_in", signedIn,
		"ms", time.Since(start).Milliseconds(), "request_id", c.GetString("request_id"))
	httpx.Data(c, http.StatusOK, out)
}

// clean validates and trims the history. Returns a Thai field error or "".
func clean(in []Message) ([]Message, string) {
	if len(in) == 0 {
		return nil, "กรุณาพิมพ์ข้อความ"
	}
	if len(in) > 50 {
		in = in[len(in)-50:]
	}
	out := make([]Message, 0, len(in))
	for _, m := range in {
		role := strings.ToLower(strings.TrimSpace(m.Role))
		if role != "user" && role != "assistant" {
			return nil, "รูปแบบข้อความไม่ถูกต้อง"
		}
		text := strings.TrimSpace(strings.ToValidUTF8(m.Content, ""))
		if text == "" {
			continue
		}
		out = append(out, Message{Role: role, Content: text})
	}
	if len(out) == 0 || out[len(out)-1].Role != "user" {
		return nil, "กรุณาพิมพ์ข้อความ"
	}
	if utf8.RuneCountInString(out[len(out)-1].Content) > maxUserRunes {
		return nil, "ข้อความยาวเกินไป (สูงสุด " + strconv.Itoa(maxUserRunes) + " ตัวอักษร)"
	}
	if len(out) > maxHistory {
		out = out[len(out)-maxHistory:]
	}
	// the API needs the first message to be the user's
	for len(out) > 1 && out[0].Role != "user" {
		out = out[1:]
	}
	for i := range out[:len(out)-1] {
		if r := []rune(out[i].Content); len(r) > maxHistoryRunes {
			out[i].Content = string(r[:maxHistoryRunes])
		}
	}
	return out, ""
}

func env(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if n, err := strconv.Atoi(strings.TrimSpace(os.Getenv(k))); err == nil {
		return n
	}
	return def
}

func envDuration(k string, def time.Duration) time.Duration {
	if d, err := time.ParseDuration(strings.TrimSpace(os.Getenv(k))); err == nil && d > 0 {
		return d
	}
	return def
}
