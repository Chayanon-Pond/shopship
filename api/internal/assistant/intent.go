package assistant

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/shopship/shop/api/internal/pricing"
)

// ---------- intent classification (pure, offline) ----------

type IntentKind string

const (
	IntentGreeting   IntentKind = "greeting"
	IntentThanks     IntentKind = "thanks"
	IntentSearch     IntentKind = "product_search"
	IntentDetail     IntentKind = "product_detail"
	IntentPromotions IntentKind = "promotions"
	IntentShipping   IntentKind = "shipping"
	IntentOrder      IntentKind = "order_status"
	IntentPolicy     IntentKind = "policy"
	IntentHandoff    IntentKind = "handoff"
	IntentOffTopic   IntentKind = "off_topic"
	IntentUnknown    IntentKind = "unknown"
)

type Intent struct {
	Kind     IntentKind
	Topic    string // policy topic
	Query    string // product search text
	MaxPrice int64  // satang, 0 = none
	Postal   string
	OrderNo  string
	Email    string
}

var (
	postalFind = regexp.MustCompile(`(?:^|[^0-9])([1-9][0-9]{4})(?:[^0-9]|$)`)
	priceCap   = regexp.MustCompile(`(?i)(ไม่เกิน|ต่ำกว่า|ไม่ถึง|under|below|less than)\s*฿?\s*([0-9][0-9,]*)\s*(บาท|฿|baht)?`)
	punct      = strings.NewReplacer("?", " ", "!", " ", ",", " ", ".", " ", "“", " ", "”", " ", "\"", " ", "'", " ", "(", " ", ")", " ", "ๆ", " ")
)

var (
	kwHandoff  = []string{"คุยกับคน", "คุยกับแอดมิน", "คุยกับพนักงาน", "ขอคุยกับ", "ติดต่อแอดมิน", "ติดต่อพนักงาน", "ติดต่อเจ้าหน้าที่", "เจ้าหน้าที่", "แอดมิน", "ติดต่อร้าน", "ติดต่อทีมงาน", "คุยกับทีมงาน", "human", "agent", "real person"}
	kwOrder    = []string{"คำสั่งซื้อ", "ออเดอร์", "ออร์เดอร์", "order", "พัสดุ", "เลขพัสดุ", "ติดตาม", "ของถึง", "ของมาถึง", "ส่งของยัง", "ส่งยัง", "ได้รับของ", "ยังไม่ได้ของ", "สถานะ", "tracking", "แทร็ก"}
	kwShipping = []string{"ค่าส่ง", "ค่าจัดส่ง", "ส่งฟรี", "ส่งกี่วัน", "กี่วันถึง", "กี่วันได้", "จัดส่งกี่วัน", "shipping fee", "free shipping", "delivery fee"}
	kwPromo    = []string{"โปรโมชั่น", "โปรโมชัน", "โปร", "โค้ด", "คูปอง", "ส่วนลด", "ลดราคา", "แฟลช", "flash", "sale", "เซล", "ดีล", "coupon", "promo", "discount", "code"}
	kwGreeting = []string{"สวัสดี", "หวัดดี", "ดีครับ", "ดีค่ะ", "hello", "hi", "hey", "ทักทาย"}
	kwThanks   = []string{"ขอบคุณ", "ขอบใจ", "thank", "thx", "แต๊งกิ้ว"}
	kwOffTopic = []string{"ยารักษา", "รักษาโรค", "ป่วย", "หมอ", "อาการ", "วินิจฉัย", "กฎหมาย", "ฟ้อง", "ทนาย", "คดี", "ลงทุน", "หุ้น", "คริปโต", "การเมือง", "เลือกตั้ง", "ดูดวง", "การบ้าน", "เขียนโค้ด", "medical", "lawyer", "invest"}
	kwDetail   = []string{"ตัวนี้", "อันนี้", "ชิ้นนี้", "สินค้านี้", "รุ่นนี้", "ไซส์", "ไซซ์", "size", "สี", "เหลือ", "สต็อก", "สต๊อก", "stock", "มีของ", "ของหมด", "หมดยัง", "รายละเอียด", "ราคาเท่าไหร่", "กี่บาท", "รีวิว"}
)

// prefixes/suffixes stripped from a search request ("มีเสื้อยืดไหมครับ" -> "เสื้อยืด")
var (
	searchPrefixes = []string{"ช่วยหา", "ช่วยแนะนำ", "อยากได้", "อยากซื้อ", "อยากหา", "ขอดู", "ตามหา", "แนะนำ", "สนใจ", "ร้านมี", "ที่ร้านมี", "มีขาย", "หา", "มี", "ขอ", "ซื้อ",
		"do you have", "show me", "i want", "looking for", "search", "find"}
	searchSuffixes = []string{"หรือเปล่า", "รึเปล่า", "หรือไม่", "ไหมครับ", "ไหมคะ", "มั้ยครับ", "มั้ยคะ", "ไหม", "มั้ย", "มั๊ย", "ป่าว", "ครับ", "ค่ะ", "คะ", "คับ", "ค่า", "จ้า", "จ้ะ", "นะ",
		"หน่อย", "บ้าง", "ด้วย", "ขาย", "ราคาเท่าไหร่", "เท่าไหร่", "เท่าไร", "กี่บาท", "ราคา", "please"}
)

func containsAny(s string, kws []string) bool {
	for _, k := range kws {
		if strings.Contains(s, k) {
			return true
		}
	}
	return false
}

// Classify maps one user message to an intent. hasProduct = the page context
// names a product (enables "ตัวนี้มีไซส์อะไรบ้าง").
func Classify(text string, hasProduct bool) Intent {
	raw := strings.TrimSpace(text)
	low := strings.ToLower(raw)
	in := Intent{Kind: IntentUnknown}
	if m := orderNoFind.FindString(raw); m != "" {
		in.OrderNo = strings.ToUpper(m)
	}
	if m := emailFind.FindString(raw); m != "" {
		in.Email = strings.ToLower(m)
	}
	if m := postalFind.FindStringSubmatch(raw); m != nil && in.OrderNo == "" {
		in.Postal = m[1]
	}
	switch {
	case in.OrderNo != "":
		in.Kind = IntentOrder
	case containsAny(low, kwHandoff):
		in.Kind = IntentHandoff
	case containsAny(low, kwOffTopic):
		in.Kind = IntentOffTopic
	case containsAny(low, kwShipping) || (in.Postal != "" && strings.Contains(low, "ส่ง")):
		in.Kind = IntentShipping
	case containsAny(low, kwOrder):
		in.Kind = IntentOrder
	case containsAny(low, kwPromo):
		in.Kind = IntentPromotions
	default:
		if topic := policyTopic(low); topic != "" {
			in.Kind, in.Topic = IntentPolicy, topic
			break
		}
		short := len([]rune(low)) <= 24
		if short && containsAny(low, kwThanks) {
			in.Kind = IntentThanks
			break
		}
		if short && containsAny(low, kwGreeting) && searchQuery(low) == "" {
			in.Kind = IntentGreeting
			break
		}
		if hasProduct && containsAny(low, kwDetail) {
			in.Kind = IntentDetail
			break
		}
		q, maxPrice := extractSearch(low)
		if q != "" {
			in.Kind, in.Query, in.MaxPrice = IntentSearch, q, maxPrice
		}
	}
	return in
}

func policyTopic(low string) string {
	best, bestLen := "", 0
	for _, e := range faq {
		if e.Topic == "contact" {
			continue
		}
		for _, k := range e.Keywords {
			if strings.Contains(low, k) && len(k) > bestLen {
				best, bestLen = e.Topic, len(k)
			}
		}
	}
	return best
}

func extractSearch(low string) (string, int64) {
	var maxPrice int64
	if m := priceCap.FindStringSubmatch(low); m != nil {
		if n, err := strconv.ParseInt(strings.ReplaceAll(m[2], ",", ""), 10, 64); err == nil && n > 0 && n < 10_000_000 {
			maxPrice = n * 100
		}
		low = strings.Replace(low, m[0], " ", 1)
	}
	return searchQuery(low), maxPrice
}

func searchQuery(low string) string {
	s := strings.Join(strings.Fields(punct.Replace(low)), " ")
	for changed := true; changed && s != ""; {
		changed = false
		for _, p := range searchPrefixes {
			if strings.HasPrefix(s, p) && len(s) > len(p) {
				s, changed = strings.TrimSpace(s[len(p):]), true
			}
		}
		for _, x := range searchSuffixes {
			if strings.HasSuffix(s, x) && len(s) > len(x) {
				s, changed = strings.TrimSpace(s[:len(s)-len(x)]), true
			}
		}
	}
	for _, w := range append(append([]string{}, kwGreeting...), "สินค้า", "ของ") {
		if s == w {
			return ""
		}
	}
	if len([]rune(s)) < 2 {
		return ""
	}
	return s
}

// ---------- rule brain ----------

// RuleBrain answers with templates over the tools (no network).
type RuleBrain struct{ T *Tools }

var defaultChips = []string{"โปรโมชันวันนี้", "ค่าส่งเท่าไหร่", "เช็กสถานะคำสั่งซื้อ", "คุยกับทีมงาน"}

func (b *RuleBrain) Reply(ctx context.Context, in Input) (ChatResponse, error) {
	last := in.Messages[len(in.Messages)-1].Content
	it := Classify(last, in.ProductSlug != "")
	// a follow-up that only carries an email / postal code continues the previous question
	if prev := previousUser(in.Messages); prev != "" {
		p := Classify(prev, in.ProductSlug != "")
		if it.Kind == IntentUnknown || it.Kind == IntentSearch && (it.Email != "" || it.Postal != "") {
			switch {
			case p.Kind == IntentOrder && (it.Email != "" || p.OrderNo != ""):
				it.Kind = IntentOrder
				if it.OrderNo == "" {
					it.OrderNo = p.OrderNo
				}
				if it.Email == "" {
					it.Email = p.Email
				}
			case p.Kind == IntentShipping && it.Postal != "":
				it.Kind = IntentShipping
			}
		}
	}
	out := ChatResponse{Source: "rules", Suggestions: defaultChips}
	var err error
	switch it.Kind {
	case IntentGreeting:
		name := ""
		if in.Caller.Name != "" {
			name = " คุณ" + in.Caller.Name
		}
		out.Reply = "สวัสดีค่ะ" + name + " ผู้ช่วย ShopShip ยินดีให้บริการ ช่วยหาสินค้า เช็กโปรโมชัน ค่าส่ง หรือสถานะคำสั่งซื้อได้เลยค่ะ"
		out.Suggestions = []string{"มีโปรอะไรบ้าง", "แนะนำสินค้าขายดี", "ค่าส่งเท่าไหร่", "เช็กสถานะคำสั่งซื้อ"}
	case IntentThanks:
		out.Reply = "ยินดีค่ะ มีอะไรให้ช่วยเพิ่มเติม พิมพ์มาได้เลยนะคะ"
	case IntentHandoff:
		out.Reply = "ได้เลยค่ะ ติดต่อทีมงานได้ตามช่องทางนี้\n" + b.T.contactLines()
		out.Actions = []Action{b.T.ContactAction()}
	case IntentOffTopic:
		out.Reply = "ขออภัยค่ะ ผู้ช่วยตอบได้เฉพาะเรื่องสินค้า โปรโมชัน การจัดส่ง และคำสั่งซื้อของ ShopShip เท่านั้น ไม่สามารถให้คำแนะนำด้านการแพทย์ กฎหมาย หรือการเงินได้ค่ะ"
	case IntentPolicy:
		out.Reply = b.T.Policy(it.Topic)
		if it.Topic == "returns" || it.Topic == "cancel" {
			out.Actions = append(out.Actions, b.T.ContactAction())
		}
		if it.Topic == "cancel" {
			out.Actions = append([]Action{ordersAction(in.Caller)}, out.Actions...)
		}
		if a, ok := PolicyAction(it.Topic); ok {
			out.Actions = append(out.Actions, a)
		}
	case IntentPromotions:
		err = b.promotions(ctx, &out)
	case IntentShipping:
		err = b.shipping(ctx, it, &out)
	case IntentOrder:
		err = b.order(ctx, in.Caller, it, &out)
	case IntentDetail:
		err = b.detail(ctx, in.ProductSlug, &out)
	case IntentSearch:
		err = b.search(ctx, it, &out)
	default:
		out.Reply = "ขออภัยค่ะ ผู้ช่วยยังไม่เข้าใจคำถาม ลองพิมพ์ชื่อสินค้าที่ต้องการ หรือเลือกหัวข้อด้านล่างได้เลยค่ะ หากต้องการคุยกับทีมงาน กด \"คุยกับทีมงาน\" ได้ค่ะ"
	}
	return out, err
}

func previousUser(msgs []Message) string {
	for i := len(msgs) - 2; i >= 0; i-- {
		if msgs[i].Role == "user" {
			return msgs[i].Content
		}
	}
	return ""
}

func ordersAction(c Caller) Action {
	if c.UserID > 0 {
		return Action{Kind: "link", Label: "ดูคำสั่งซื้อของฉัน", Href: "/account/orders"}
	}
	return Action{Kind: "link", Label: "เข้าสู่ระบบเพื่อดูคำสั่งซื้อ", Href: "/login?next=/account/orders"}
}

func (b *RuleBrain) search(ctx context.Context, it Intent, out *ChatResponse) error {
	limit := 6
	if it.MaxPrice > 0 {
		limit = 12
	}
	cards, err := b.T.Search(ctx, it.Query, limit)
	if err != nil {
		return err
	}
	if it.MaxPrice > 0 {
		kept := cards[:0]
		for _, c := range cards {
			if c.PriceSatang <= it.MaxPrice {
				kept = append(kept, c)
			}
		}
		cards = kept
	}
	if len(cards) == 0 {
		out.Reply = fmt.Sprintf("ไม่พบสินค้าที่ตรงกับ \"%s\" ค่ะ ลองใช้คำอื่น หรือดูหมวดหมู่สินค้าทั้งหมดได้นะคะ", it.Query)
		out.Actions = []Action{{Kind: "link", Label: "ดูหมวดหมู่ทั้งหมด", Href: "/categories"}}
		return nil
	}
	if len(cards) > 4 {
		cards = cards[:4]
	}
	var lines []string
	for _, c := range cards {
		lines = append(lines, "• "+c.Name+" — "+priceText(c)+stockNote(c))
	}
	out.Reply = fmt.Sprintf("เจอสินค้าที่เกี่ยวกับ \"%s\" ค่ะ\n%s\nราคาที่แสดงเป็นราคาหน้าร้านสำหรับทุกคน กดดูรายละเอียดได้เลยค่ะ", it.Query, strings.Join(lines, "\n"))
	out.Products = cards
	out.Actions = []Action{{Kind: "link", Label: "ดูผลการค้นหาทั้งหมด", Href: "/search?q=" + urlQuery(it.Query)}}
	out.Suggestions = []string{"มีโปรอะไรบ้าง", "ค่าส่งเท่าไหร่", "คุยกับทีมงาน"}
	return nil
}

func (b *RuleBrain) detail(ctx context.Context, slug string, out *ChatResponse) error {
	p, err := b.T.Product(ctx, slug)
	if err != nil {
		return err
	}
	if p == nil {
		out.Reply = "ขออภัยค่ะ ไม่พบข้อมูลสินค้านี้ ลองพิมพ์ชื่อสินค้าที่ต้องการได้เลยค่ะ"
		return nil
	}
	var in, low, gone []string
	for _, v := range p.Variants {
		switch v.StockLevel {
		case "in_stock":
			in = append(in, v.Name)
		case "low":
			low = append(low, v.Name)
		default:
			gone = append(gone, v.Name)
		}
	}
	lines := []string{p.Name + " — " + priceText(p.Card)}
	if p.FlashEndsAt != nil {
		lines = append(lines, "Flash Sale ถึง "+thaiDateTime(*p.FlashEndsAt))
	}
	if len(p.Variants) > 1 {
		if len(in) > 0 {
			lines = append(lines, "มีของ: "+joinMax(in, 8))
		}
		if len(low) > 0 {
			lines = append(lines, "เหลือน้อย: "+joinMax(low, 8))
		}
		if len(gone) > 0 {
			lines = append(lines, "หมดชั่วคราว: "+joinMax(gone, 8))
		}
	} else if !p.InStock {
		lines = append(lines, "ตอนนี้สินค้าหมดชั่วคราวค่ะ")
	} else if len(low) > 0 {
		lines = append(lines, "สินค้าเหลือน้อยค่ะ")
	} else {
		lines = append(lines, "มีสินค้าพร้อมส่งค่ะ")
	}
	if p.RatingCount > 0 {
		lines = append(lines, fmt.Sprintf("คะแนนรีวิว %.1f/5 จาก %d รีวิว", p.RatingAvg, p.RatingCount))
	}
	if len(p.Badges) > 0 {
		lines = append(lines, "โปรที่ร่วมรายการ: "+strings.Join(p.Badges, ", "))
	}
	lines = append(lines, "ราคาสมาชิก/ราคาส่ง (ถ้ามีสิทธิ์) จะแสดงในหน้าสินค้าหลังเข้าสู่ระบบค่ะ")
	out.Reply = strings.Join(lines, "\n")
	out.Products = []Card{p.Card}
	out.Suggestions = []string{"ค่าส่งเท่าไหร่", "มีโปรอะไรบ้าง", "คืนสินค้าได้ไหม"}
	return nil
}

func (b *RuleBrain) promotions(ctx context.Context, out *ChatResponse) error {
	p, err := b.T.Promotions(ctx)
	if err != nil {
		return err
	}
	var lines []string
	if p.Campaign != "" && p.CampaignTo != nil {
		lines = append(lines, "แคมเปญตอนนี้: "+p.Campaign+" (ถึง "+thaiDateTime(*p.CampaignTo)+")")
	}
	for _, c := range p.Codes {
		l := "• โค้ด " + c.Code + " — " + c.Label
		if strings.Contains(c.Label, c.Code) {
			l = "• " + c.Label
		}
		if c.EndsAt != nil {
			l += " (ใช้ได้ถึง " + thaiDateTime(*c.EndsAt) + ")"
		}
		lines = append(lines, l)
	}
	for _, a := range p.Auto {
		lines = append(lines, "• "+a.Label+" (อัตโนมัติ ไม่ต้องใช้โค้ด)")
	}
	if p.Flash != nil {
		lines = append(lines, "⚡ "+p.Flash.Label+" ถึง "+thaiDateTime(p.Flash.EndsAt)+" จำนวนจำกัด")
		out.Products = p.Flash.Products
		out.Actions = append(out.Actions, Action{Kind: "link", Label: "ดู Flash Sale", Href: "/flash-sale"})
	} else if p.NextFlash != nil {
		lines = append(lines, "⚡ Flash Sale รอบถัดไปเริ่ม "+thaiDateTime(*p.NextFlash))
	}
	if len(lines) == 0 {
		out.Reply = "ตอนนี้ยังไม่มีโปรโมชันที่เปิดให้ทุกคนค่ะ ติดตามได้ที่หน้าโปรโมชันนะคะ"
	} else {
		out.Reply = "โปรโมชันที่ใช้ได้ตอนนี้ค่ะ\n" + strings.Join(lines, "\n") + "\nเงื่อนไขและยอดสุทธิจะคำนวณให้ในตะกร้าค่ะ"
	}
	out.Actions = append(out.Actions, Action{Kind: "link", Label: "ดูโปรโมชันทั้งหมด", Href: "/promotions"})
	out.Suggestions = []string{"ค่าส่งเท่าไหร่", "แนะนำสินค้าขายดี", "ใช้โค้ดยังไง"}
	return nil
}

func (b *RuleBrain) shipping(ctx context.Context, it Intent, out *ChatResponse) error {
	if it.Postal == "" {
		p, err := b.T.Promotions(ctx)
		if err != nil {
			return err
		}
		out.Reply = b.T.Policy("shipping")
		if m := p.FreeShippingMin(); m != nil {
			out.Reply += "\n• ตอนนี้ส่งฟรีเมื่อยอดสินค้าครบ " + pricing.FormatBaht(*m)
		}
		out.Reply += "\nพิมพ์รหัสไปรษณีย์ 5 หลักมาได้เลย ผู้ช่วยจะประเมินค่าส่งให้ค่ะ"
		out.Suggestions = []string{"ส่งไป 10110", "ส่งไป 50200", "คุยกับทีมงาน"}
		return nil
	}
	est, err := b.T.Shipping(ctx, it.Postal, 0)
	if err == errBadPostal {
		out.Reply = "รหัสไปรษณีย์ไม่ถูกต้องค่ะ กรุณาพิมพ์ตัวเลข 5 หลัก"
		return nil
	}
	if err != nil {
		return err
	}
	lines := []string{fmt.Sprintf("ส่งไปรหัสไปรษณีย์ %s: ค่าส่งเริ่มต้น %s (พัสดุไม่เกิน 3 กก.) ถึงภายใน %d–%d วันทำการ",
		est.PostalCode, pricing.FormatBaht(est.FeeSatang), est.EtaDays[0], est.EtaDays[1])}
	if est.Remote {
		lines = append(lines, "พื้นที่นี้เป็นพื้นที่ห่างไกล อาจใช้เวลานานขึ้นเล็กน้อยค่ะ")
	}
	if est.FreeShippingMinSt != nil {
		lines = append(lines, "ส่งฟรีเมื่อยอดสินค้าครบ "+pricing.FormatBaht(*est.FreeShippingMinSt))
	}
	lines = append(lines, "ค่าส่งจริงคำนวณตามน้ำหนักตะกร้าในหน้าชำระเงินค่ะ")
	out.Reply = strings.Join(lines, "\n")
	out.Suggestions = []string{"มีโปรอะไรบ้าง", "ชำระเงินได้ทางไหน", "เช็กสถานะคำสั่งซื้อ"}
	return nil
}

func (b *RuleBrain) order(ctx context.Context, c Caller, it Intent, out *ChatResponse) error {
	res, err := b.T.Orders(ctx, c, it.OrderNo, it.Email)
	if err != nil {
		return err
	}
	out.Actions = []Action{ordersAction(c)}
	switch res.Result {
	case "need_login_or_email":
		if it.OrderNo == "" {
			out.Reply = "เข้าสู่ระบบเพื่อดูคำสั่งซื้อทั้งหมดของคุณได้เลยค่ะ หรือพิมพ์เลขคำสั่งซื้อ (ขึ้นต้นด้วย SS) พร้อมอีเมลที่ใช้สั่งซื้อ"
		} else {
			out.Reply = "เพื่อความปลอดภัย กรุณาพิมพ์อีเมลที่ใช้สั่งซื้อ " + it.OrderNo + " ด้วยค่ะ หรือเข้าสู่ระบบเพื่อดูคำสั่งซื้อของคุณ"
		}
		return nil
	case "invalid_order_no":
		out.Reply = "เลขคำสั่งซื้อไม่ถูกต้องค่ะ เลขคำสั่งซื้อขึ้นต้นด้วย SS เช่น SS261117A7K2"
		return nil
	case "rate_limited":
		out.Reply = "ตรวจสอบคำสั่งซื้อบ่อยเกินไป กรุณารอสักครู่ หรือเข้าสู่ระบบเพื่อดูคำสั่งซื้อของคุณค่ะ"
		return nil
	case "not_found":
		if c.UserID > 0 && it.OrderNo == "" {
			out.Reply = "บัญชีนี้ยังไม่มีคำสั่งซื้อค่ะ เริ่มช้อปได้เลยนะคะ"
		} else {
			out.Reply = "ไม่พบคำสั่งซื้อที่ตรงกับข้อมูลนี้ค่ะ กรุณาตรวจสอบเลขคำสั่งซื้อและอีเมลอีกครั้ง หรือติดต่อทีมงาน"
			out.Actions = append(out.Actions, b.T.ContactAction())
		}
		return nil
	}
	var lines []string
	for _, o := range res.Orders {
		l := fmt.Sprintf("• %s — %s (%d ชิ้น %s สั่งเมื่อ %s)", o.OrderNo, o.StatusText, o.ItemCount,
			pricing.FormatBaht(o.GrandTotalSatang), thaiDateTime(o.CreatedAt))
		if o.PaymentDueAt != nil {
			l += "\n  ชำระเงินภายใน " + thaiDateTime(*o.PaymentDueAt)
		}
		if o.TrackingNo != "" {
			l += "\n  เลขพัสดุ " + o.TrackingNo + " — " + o.ShipmentStatus
		}
		lines = append(lines, l)
	}
	head := "สถานะคำสั่งซื้อของคุณค่ะ"
	if len(res.Orders) > 1 {
		head = "คำสั่งซื้อล่าสุดของคุณค่ะ"
	}
	out.Reply = head + "\n" + strings.Join(lines, "\n")
	if len(res.Orders) == 1 && res.Orders[0].Href != "" {
		out.Actions = []Action{{Kind: "link", Label: "ดูรายละเอียดคำสั่งซื้อ", Href: res.Orders[0].Href}}
	}
	out.Suggestions = []string{"ยกเลิกคำสั่งซื้อได้ไหม", "คืนสินค้าได้ไหม", "คุยกับทีมงาน"}
	return nil
}

// ---------- formatting ----------

func priceText(c Card) string {
	s := pricing.FormatBaht(c.PriceSatang)
	if c.PriceFrom {
		s = "เริ่มต้น " + s
	}
	if c.OnFlashSale {
		s += " (ราคา Flash Sale)"
	}
	return s
}

func stockNote(c Card) string {
	if !c.InStock {
		return " (หมดชั่วคราว)"
	}
	return ""
}

func joinMax(ss []string, n int) string {
	if len(ss) <= n {
		return strings.Join(ss, ", ")
	}
	return strings.Join(ss[:n], ", ") + fmt.Sprintf(" และอีก %d แบบ", len(ss)-n)
}

var bangkok = time.FixedZone("ICT", 7*3600)
var thaiMonths = []string{"ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."}

// thaiDateTime renders "17 พ.ย. 2569 14:30 น." in Bangkok time.
func thaiDateTime(t time.Time) string {
	b := t.In(bangkok)
	return fmt.Sprintf("%d %s %d %02d:%02d น.", b.Day(), thaiMonths[b.Month()-1], b.Year()+543, b.Hour(), b.Minute())
}

func urlQuery(s string) string { return url.QueryEscape(s) }
