import json, hashlib, os, sys
OUT = sys.argv[1]
def img(i, key, alt, w=800, h=800):
    return {"id": i, "url": f"/mock/{key}.svg", "alt": alt, "width": w, "height": h}
def dump(name, obj):
    with open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2); f.write("\n")
def h(s): return hashlib.sha256(s.encode()).hexdigest()

cats = [
 {"id":1,"slug":"fashion","name":"แฟชั่น","description":"","image_url":"","icon":"Shirt","parent_id":None,"sort_order":1,"product_count":3,
  "children":[{"id":11,"slug":"shirts","name":"เสื้อ","description":"","image_url":"","icon":"Shirt","parent_id":1,"sort_order":1,"product_count":1,"children":[]},
              {"id":12,"slug":"bags","name":"กระเป๋า","description":"","image_url":"","icon":"ShoppingBag","parent_id":1,"sort_order":2,"product_count":1,"children":[]},
              {"id":13,"slug":"socks","name":"ถุงเท้า","description":"","image_url":"","icon":"Footprints","parent_id":1,"sort_order":3,"product_count":1,"children":[]}]},
 {"id":2,"slug":"electronics","name":"อิเล็กทรอนิกส์","description":"","image_url":"","icon":"Headphones","parent_id":None,"sort_order":2,"product_count":2,
  "children":[{"id":21,"slug":"audio","name":"เครื่องเสียง","description":"","image_url":"","icon":"Headphones","parent_id":2,"sort_order":1,"product_count":1,"children":[]},
              {"id":22,"slug":"wearables","name":"อุปกรณ์สวมใส่","description":"","image_url":"","icon":"Watch","parent_id":2,"sort_order":2,"product_count":1,"children":[]}]},
 {"id":3,"slug":"home","name":"บ้านและครัว","description":"","image_url":"","icon":"Sofa","parent_id":None,"sort_order":3,"product_count":1,
  "children":[{"id":31,"slug":"kitchen","name":"ครัว","description":"","image_url":"","icon":"Coffee","parent_id":3,"sort_order":1,"product_count":1,"children":[]}]},
]
dump("categories.json", {"data": cats})

FLASH_END = "2026-11-17T15:00:00Z"
# name_en: optional English name (additive, approved Wave 1) — searchable, shown in admin.
NAME_EN = {11:"Canvas Tote Bag",12:"Linen Shirt",13:"Wireless Earbuds Pro",14:"Smart Watch Lite",15:"Cotton Socks",16:"Ceramic Mug"}
def card(pid, slug, name, sub, brand, key, lo, hi, rating, rc, sold, badges=None, flash=None, in_stock=True):
    return {"id":pid,"slug":slug,"name":name,"name_en":NAME_EN.get(pid,""),"subtitle":sub,"brand":brand,"image":img(pid*10+1,key,name),
            "min_price_satang":lo,"max_price_satang":hi,"flash":flash,"rating_avg":rating,"rating_count":rc,
            "sold_count":sold,"in_stock":in_stock,"badges":badges or []}
cards = [
 card(14,"smart-watch-lite","สมาร์ทวอทช์ Lite","จอ AMOLED แบต 7 วัน","ShopShip","smart-watch-lite",89000,89000,4.6,212,1840,
      flash={"flash_sale_id":7,"sale_price_satang":59000,"list_price_satang":89000,"ends_at":FLASH_END,"remaining_qty":38,"lowest_30d_satang":85000}),
 card(12,"linen-shirt","เสื้อเชิ้ตลินิน","ผ้าลินินแท้ ใส่สบาย","ShopShip Basics","linen-shirt-white",59000,59000,4.8,96,640),
 card(13,"wireless-earbuds-pro","หูฟังไร้สาย Pro","ตัดเสียงรบกวน ANC","Sonar","earbuds-pro",120000,120000,4.7,318,2210),
 card(11,"canvas-tote-bag","ถุงผ้าแคนวาส","แคนวาสหนา 12 ออนซ์","ShopShip Basics","canvas-tote",25000,25000,4.5,58,3120,badges=["ราคาส่งเมื่อซื้อ 10 ใบขึ้นไป"]),
 card(15,"cotton-socks","ถุงเท้าคอตตอน","คอตตอน 80% ระบายอากาศ","ShopShip Basics","cotton-socks",9900,9900,4.4,41,980,badges=["ซื้อ 2 แถม 1"]),
 card(16,"ceramic-mug","แก้วเซรามิก","350 ml เข้าไมโครเวฟได้","Kiln","ceramic-mug",29000,29000,0,0,0,in_stock=False),
]
dump("product-list.json", {"data": cards, "meta": {"page":1,"per_page":24,"total":6,"total_pages":1}})

detail = dict(next(c for c in cards if c["id"]==12))
detail.update({
 "description":"เสื้อเชิ้ตผ้าลินินแท้ 100% ทอแน่น ระบายอากาศดี เหมาะกับอากาศเมืองไทย\n\n- ผ้าลินิน 100%\n- ซักเครื่องได้ (ถุงซัก)\n- ผลิตในประเทศไทย",
 "category":{"id":11,"slug":"shirts","name":"เสื้อ"},
 "breadcrumbs":[{"id":1,"slug":"fashion","name":"แฟชั่น"},{"id":11,"slug":"shirts","name":"เสื้อ"}],
 "options":[{"name":"สี","values":["ขาว","กรมท่า"]},{"name":"ไซซ์","values":["M","L"]}],
 "variants":[
  {"id":205,"sku":"LIN-WHT-M","name":"ขาว / M","option_values":{"สี":"ขาว","ไซซ์":"M"},"price_satang":59000,"in_stock":True,"stock_level":"in_stock","image_id":121},
  {"id":206,"sku":"LIN-WHT-L","name":"ขาว / L","option_values":{"สี":"ขาว","ไซซ์":"L"},"price_satang":59000,"in_stock":True,"stock_level":"low","image_id":121},
  {"id":207,"sku":"LIN-NVY-M","name":"กรมท่า / M","option_values":{"สี":"กรมท่า","ไซซ์":"M"},"price_satang":59000,"in_stock":False,"stock_level":"out","image_id":122},
  {"id":208,"sku":"LIN-NVY-L","name":"กรมท่า / L","option_values":{"สี":"กรมท่า","ไซซ์":"L"},"price_satang":59000,"in_stock":True,"stock_level":"in_stock","image_id":122}],
 "images":[img(121,"linen-shirt-white","เสื้อเชิ้ตลินิน สีขาว"), img(122,"linen-shirt-navy","เสื้อเชิ้ตลินิน สีกรมท่า")],
 "reviews_summary":{"rating_avg":4.8,"rating_count":96,"histogram":{"1":1,"2":1,"3":3,"4":10,"5":81},"with_images_count":12},
 "tags":["linen","shirt"],
 "seo":{"title":"เสื้อเชิ้ตลินิน | ShopShip","description":"เสื้อเชิ้ตผ้าลินินแท้ 100% ใส่สบาย ส่งไว"},
})
detail["image"] = img(121,"linen-shirt-white","เสื้อเชิ้ตลินิน สีขาว")
dump("product-detail.json", {"data": detail})

dump("product-reviews.json", {"data":[
 {"id":901,"rating":5,"title":"ผ้าดีมาก","body":"ใส่สบาย ไม่ร้อน ซักแล้วไม่หด","author_name":"ป***า","variant_name":"ขาว / M","images":[],"created_at":"2026-11-10T08:12:00Z",
  "reply":{"body":"ขอบคุณมากค่ะ","replied_at":"2026-11-10T10:00:00Z"}},
 {"id":902,"rating":4,"title":"","body":"ไซซ์ตรง สีสวยตามรูป","author_name":"S***n","variant_name":"กรมท่า / L","images":[img(9021,"linen-shirt-navy","รูปจากผู้ซื้อ")],"created_at":"2026-11-02T14:40:00Z","reply":None}],
 "meta":{"page":1,"per_page":10,"total":2,"total_pages":1}})

# ---------- quotes ----------
def line(vid, qty, lst, unit, src, adj=None, alloc=0, low=None, avail=None):
    adj = adj or []
    lt = qty*unit - sum(a["amount_satang"] for a in adj)
    return {"variant_id":vid,"qty":qty,"list_unit_price_satang":lst,"unit_price_satang":unit,"price_source":src,
            "adjustments":adj,"line_total_satang":lt,"allocated_discount_satang":alloc,"lowest_30d_satang":low,
            "availability":avail or {"status":"ok","available_qty":max(qty,50)}}
def quote(name, lines, adjs, ship, coupon, hints):
    lst = sum(l["qty"]*l["list_unit_price_satang"] for l in lines)
    sub = sum(l["line_total_satang"] for l in lines)
    disc = sum(a["amount_satang"] for a in adjs)
    assert sum(l["allocated_discount_satang"] for l in lines) == disc, name
    shipn = ship["fee_satang"] - ship["discount_satang"]
    return {"lines":lines,"adjustments":adjs,"shipping":ship,
         "totals":{"list_subtotal_satang":lst,"subtotal_satang":sub,"discount_satang":disc,"shipping_satang":shipn,
                   "savings_satang":lst-sub+disc+ship["discount_satang"],"grand_total_satang":sub-disc+shipn},
         "coupon":coupon,"hints":hints,"quote_hash":h(name),"expires_at":"2026-11-17T03:10:00Z"}
LIST = {"kind":"list","label":""}
FREESHIP = {"fee_satang":4000,"discount_satang":4000,"promotion_id":31,"label":"ส่งฟรีเมื่อช้อปครบ ฿999"}

# A: trade tier (layer 1) + non-exclusive code (layer 4) + free shipping (layer 5); signed-in trade customer
qa = quote("trade_code_freeship",
  [line(101,12,25000,21000,{"kind":"quantity_break","label":"ราคาส่ง 10 ชิ้นขึ้นไป","promotion_id":11},alloc=12600,low=25000),
   line(205,1,59000,59000,LIST,alloc=2950)],
  [{"promotion_id":41,"layer":4,"label":"โค้ด TRADE5 ลด 5%","amount_satang":15550,"coupon_code":"TRADE5"}],
  FREESHIP, {"code":"TRADE5","status":"applied","reason_code":"","message":"ใช้โค้ด TRADE5 แล้ว ลด ฿155.50"},
  [{"kind":"quantity_break_gap","message":"หยิบเพิ่มอีก 38 ชิ้น รับราคาส่ง ฿190/ชิ้น","promotion_id":11,"variant_id":101,"qty_needed":38,"unit_price_satang":19000}])
assert qa["totals"]["grand_total_satang"] == 295450
dump("cart-quote-trade-code-freeship.json", {"data": qa})

# B: exclusive code (10% capped 100) loses to automatic layer 3 (150 off)
qb = quote("exclusive_loses",
  [line(301,1,120000,120000,LIST,alloc=15000)],
  [{"promotion_id":21,"layer":3,"label":"ช้อปครบ ฿1,000 ลด ฿150","amount_satang":15000}],
  FREESHIP, {"code":"SAVE10X","status":"not_applied","reason_code":"exclusive_not_better",
             "message":"โค้ด SAVE10X ใช้ร่วมกับโปรอื่นไม่ได้ และลดน้อยกว่าโปร 'ช้อปครบ ฿1,000 ลด ฿150' ที่ได้รับอยู่แล้ว"}, [])
dump("cart-quote-exclusive-loses.json", {"data": qb})

# C: flash line (layer 1) + buy-2-get-1 on another line (layer 2); guest; under free-shipping threshold
qc = quote("flash_line",
  [line(401,1,89000,59000,{"kind":"flash_sale","label":"Flash Sale 11.11","flash_sale_item_id":71},low=85000,
        avail={"status":"ok","available_qty":38}),
   line(502,3,9900,9900,LIST,adj=[{"promotion_id":15,"layer":2,"label":"ซื้อ 2 แถม 1","amount_satang":9900}])],
  [], {"fee_satang":4000,"discount_satang":0},
  None, [{"kind":"free_shipping_gap","message":"ช้อปเพิ่มอีก ฿211 รับส่งฟรี","amount_satang":21100,"promotion_id":31},
         {"kind":"login_for_member_price","message":"เข้าสู่ระบบเพื่อดูราคาสมาชิก"}])
assert qc["totals"]["subtotal_satang"] == 78800 and qc["totals"]["grand_total_satang"] == 82800
dump("cart-quote-flash.json", {"data": qc})

# D: expired seasonal code
qd = quote("invalid_seasonal",
  [line(205,2,59000,59000,LIST)], [], FREESHIP,
  {"code":"SONGKRAN26","status":"invalid","reason_code":"expired","message":"โค้ด SONGKRAN26 หมดอายุแล้ว (สิ้นสุด 16 เม.ย. 2026)"}, [])
dump("cart-quote-invalid-seasonal.json", {"data": qd})

# ---------- cart ----------
dump("cart.json", {"data":{"items":[
  {"variant_id":401,"qty":1,"product":{"id":14,"slug":"smart-watch-lite","name":"สมาร์ทวอทช์ Lite","image":img(141,"smart-watch-lite","สมาร์ทวอทช์ Lite")},
   "variant":{"sku":"SW-LITE-BLK","name":"ดำ","option_values":{"สี":"ดำ"}},"list_unit_price_satang":89000,"stock_level":"low","max_qty":1},
  {"variant_id":502,"qty":3,"product":{"id":15,"slug":"cotton-socks","name":"ถุงเท้าคอตตอน","image":img(151,"cotton-socks","ถุงเท้าคอตตอน")},
   "variant":{"sku":"SOCK-WHT-F","name":"ขาว / ฟรีไซซ์","option_values":{"สี":"ขาว","ไซซ์":"ฟรีไซซ์"}},"list_unit_price_satang":9900,"stock_level":"in_stock","max_qty":120}],
 "coupon_code":None,"item_count":4,"quote":qc}})

# ---------- order detail (scenario A, paid) ----------
t = qa["totals"]
order = {"order_no":"SS261117A7K2","status":"paid",
 "items":[
  {"variant_id":101,"product_slug":"canvas-tote-bag","sku":"TOTE-NAT","product_name":"ถุงผ้าแคนวาส","variant_name":"สีธรรมชาติ","image_url":"/mock/canvas-tote.svg","qty":12,
   "list_unit_price_satang":25000,"unit_price_satang":21000,"price_source":{"kind":"quantity_break","label":"ราคาส่ง 10 ชิ้นขึ้นไป"},
   "line_discount_satang":0,"line_total_satang":252000,"allocated_discount_satang":12600,"lowest_30d_satang":25000},
  {"variant_id":205,"product_slug":"linen-shirt","sku":"LIN-WHT-M","product_name":"เสื้อเชิ้ตลินิน","variant_name":"ขาว / M","image_url":"/mock/linen-shirt-white.svg","qty":1,
   "list_unit_price_satang":59000,"unit_price_satang":59000,"price_source":{"kind":"list","label":""},
   "line_discount_satang":0,"line_total_satang":59000,"allocated_discount_satang":2950,"lowest_30d_satang":None}],
 "adjustments":qa["adjustments"],
 "totals":{"list_subtotal_satang":t["list_subtotal_satang"],"subtotal_satang":t["subtotal_satang"],"discount_satang":t["discount_satang"],
           "shipping_fee_satang":4000,"shipping_discount_satang":4000,"savings_satang":t["savings_satang"],"grand_total_satang":t["grand_total_satang"]},
 "coupon_code":"TRADE5","payment_method":"promptpay",
 "shipping_address":{"label":"ร้าน","recipient_name":"สมชาย ใจดี","phone":"0812345678","line1":"99/9 ซอยสุขุมวิท 50","line2":"",
   "subdistrict":"พระโขนง","district":"คลองเตย","province":"กรุงเทพมหานคร","postal_code":"10110","country":"TH","is_default":True},
 "email":"somchai@example.com","customer_note":"",
 "payment":{"status":"successful","method":"promptpay","charge_id":"chrg_mock_5v8q2k","expires_at":"2026-11-17T03:15:00Z"},
 "shipment":None,
 "timeline":[{"status":"pending_payment","at":"2026-11-17T03:00:00Z","note":""},{"status":"paid","at":"2026-11-17T03:02:41Z","note":"PromptPay"}],
 "payment_due_at":"2026-11-17T03:15:00Z","paid_at":"2026-11-17T03:02:41Z","cancelled_at":None,"created_at":"2026-11-17T03:00:00Z"}
dump("order-detail.json", {"data": order})
dump("order-list.json", {"data":[{"order_no":"SS261117A7K2","status":"paid","item_count":13,"grand_total_satang":295450,"created_at":"2026-11-17T03:00:00Z",
  "first_item_image":img(111,"canvas-tote","ถุงผ้าแคนวาส")}],"meta":{"page":1,"per_page":24,"total":1,"total_pages":1}})

dump("payment-charge-promptpay.json", {"data":{"charge_id":"chrg_mock_5v8q2k","order_no":"SS261117A7K2","method":"promptpay","status":"pending","amount_satang":295450,
  "promptpay":{"qr_payload":"00020101021230570016A000000677010112011501055600000000002150SS261117A7K253037645407295450.5802TH6304ABCD","qr_image_url":None,"expires_at":"2026-11-17T03:15:00Z"},
  "authorize_uri":None,"failure_code":None,"failure_message":None}})

dump("me.json", {"data":{"id":501,"email":"somchai@example.com","name":"สมชาย ใจดี","phone":"0812345678","role":"customer","tier":"gold",
  "group":{"id":2,"code":"trade","name":"ลูกค้าขายส่ง"},"marketing_consent":False,"email_verified":True,"created_at":"2026-10-01T05:00:00Z","perms":[],"csrf_token":"mock-csrf-token"}})
dump("me-admin.json", {"data":{"id":1,"email":"owner@shopship.local","name":"เจ้าของร้าน","phone":"","role":"owner","tier":"standard","group":None,
  "marketing_consent":False,"email_verified":True,"created_at":"2026-11-01T00:00:00Z",
  "perms":["dashboard:read","catalog:read","inventory:write","orders:read","orders:fulfil","promotions:read","catalog:write","orders:manage","promotions:write",
           "customers:read","customers:write","banners:write","reviews:moderate","audit:read","staff:manage"],"csrf_token":"mock-csrf-token"}})
banners = [{"id":1,"placement":"home_hero","title":"11.11 ลดสูงสุด 50%","subtitle":"เฉพาะวันนี้ถึงเที่ยงคืน","cta_label":"ช้อปเลย","link_url":"/flash-sale",
            "image_url":"/mock/hero-1111.svg","image_mobile_url":"","image_alt":"แคมเปญ 11.11","campaign_id":3},
           {"id":2,"placement":"home_hero","title":"ของใช้ทุกวัน ราคาส่ง","subtitle":"ซื้อ 10 ชิ้นขึ้นไป ราคาถูกลงทันที","cta_label":"ดูสินค้า","link_url":"/c/bags",
            "image_url":"/mock/hero-songkran.svg","image_mobile_url":"","image_alt":"ราคาส่ง","campaign_id":None}]
dump("banners.json", {"data": banners})
dump("campaign-active.json", {"data":{"id":3,"slug":"11-11-2026","name":"11.11 Big Sale","season_tag":"11-11",
  "theme":{"accent":"#0071E3","accent_contrast":"#FFFFFF","background":"#FFFFFF","hero_image_url":"/mock/hero-1111.svg","badge_text":"11.11"},
  "starts_at":"2026-11-10T17:00:00Z","ends_at":"2026-11-17T17:00:00Z","banners":[banners[0]],
  "promo_codes":[{"code":"SAVE10X","label":"โค้ด SAVE10X ลด 10%","description":"ลด 10% สูงสุด ฿100 ใช้ร่วมกับโปรช้อปครบไม่ได้ (1 สิทธิ์/บัญชี)",
                  "ends_at":"2026-11-17T17:00:00Z"}]}})
dump("flash-sale-current.json", {"data":{"current":{"id":7,"label":"Flash Sale 11.11","starts_at":"2026-11-17T03:00:00Z","ends_at":FLASH_END,
  "items":[{"flash_sale_item_id":71,"product":cards[0],"variant_id":401,"variant_name":"ดำ","sale_price_satang":59000,"list_price_satang":89000,
            "lowest_30d_satang":85000,"qty_limit":100,"sold_qty":62,"remaining_qty":38,"per_customer_limit":1}]},
  "next":{"id":8,"label":"Flash Sale 12.12","starts_at":"2026-12-12T03:00:00Z","ends_at":"2026-12-12T15:00:00Z","items":[]}}})
dump("offers.json", {"data":[
  {"variant_id":101,"list_price_satang":25000,"price_satang":25000,"price_source":{"kind":"list","label":""},"lowest_30d_satang":None,
   "qty_breaks":[{"min_qty":10,"unit_price_satang":21000},{"min_qty":50,"unit_price_satang":19000}],"badges":["ราคาส่งเมื่อซื้อ 10 ใบขึ้นไป"]},
  {"variant_id":205,"list_price_satang":59000,"price_satang":53100,"price_source":{"kind":"tier_price","label":"สมาชิก Gold ลด 10%"},"lowest_30d_satang":59000,
   "qty_breaks":[],"badges":[]}]})

def promo(**k):
    base = {"description":"","status":"active","starts_at":"2026-11-01T00:00:00Z","ends_at":None,"priority":0,"exclusive":False,"auto_apply":True,
            "percent_bp":None,"amount_satang":None,"buy_qty":None,"get_qty":None,"get_percent_bp":None,
            "min_spend_satang":0,"max_discount_satang":None,"usage_limit":None,"per_customer_limit":None,"used_count":0,
            "customer_group_ids":[],"tiers":[],"qty_tiers":[],"targets":[],"codes":[],"campaign":None,"season_tag":"",
            "created_at":"2026-11-01T00:00:00Z","updated_at":"2026-11-01T00:00:00Z","state":"running"}
    base.update(k); return base
camp = {"id":3,"slug":"11-11-2026","name":"11.11 Big Sale"}
promos = [
 promo(id=11,name="ราคาส่งถุงผ้า",label="ราคาส่ง 10 ชิ้นขึ้นไป",kind="quantity_break",layer=1,customer_group_ids=[2],
       qty_tiers=[{"min_qty":10,"unit_price_satang":21000,"percent_bp":None},{"min_qty":50,"unit_price_satang":19000,"percent_bp":None}],
       targets=[{"type":"product","id":11,"name":"ถุงผ้าแคนวาส"}]),
 promo(id=12,name="ลูกค้าขายส่ง ลด 8%",label="ราคาขายส่ง",kind="group_price",layer=1,percent_bp=800,customer_group_ids=[2],priority=1),
 promo(id=13,name="Gold ลด 10%",label="สมาชิก Gold ลด 10%",kind="tier_price",layer=1,percent_bp=1000,tiers=["gold","platinum"],
       targets=[{"type":"category","id":1,"name":"แฟชั่น"}]),
 promo(id=15,name="ถุงเท้า 2 แถม 1",label="ซื้อ 2 แถม 1",kind="buy_x_get_y",layer=2,buy_qty=2,get_qty=1,get_percent_bp=10000,
       targets=[{"type":"category","id":13,"name":"ถุงเท้า"}]),
 promo(id=21,name="ครบ 1000 ลด 150",label="ช้อปครบ ฿1,000 ลด ฿150",kind="cart_amount",layer=3,amount_satang=15000,min_spend_satang=100000,campaign=camp,season_tag="11-11",
       ends_at="2026-11-17T17:00:00Z"),
 promo(id=31,name="ส่งฟรี 999",label="ส่งฟรีเมื่อช้อปครบ ฿999",kind="free_shipping",layer=5,min_spend_satang=99900),
 promo(id=41,name="โค้ดขายส่ง 5%",label="โค้ด TRADE5 ลด 5%",kind="cart_percent",layer=4,auto_apply=False,percent_bp=500,max_discount_satang=20000,
       per_customer_limit=10,used_count=37,customer_group_ids=[2],codes=[{"id":401,"code":"TRADE5","is_active":True}]),
 promo(id=42,name="โค้ด 11.11 exclusive",label="โค้ด SAVE10X ลด 10%",kind="cart_percent",layer=4,auto_apply=False,exclusive=True,
       description="ลด 10% สูงสุด ฿100 ใช้ร่วมกับโปรช้อปครบไม่ได้ (1 สิทธิ์/บัญชี)",percent_bp=1000,
       max_discount_satang=10000,usage_limit=1000,used_count=412,per_customer_limit=1,campaign=camp,season_tag="11-11",
       ends_at="2026-11-17T17:00:00Z",codes=[{"id":402,"code":"SAVE10X","is_active":True}]),
 promo(id=43,name="สงกรานต์ 2026",label="โค้ดสงกรานต์ ลด ฿100",kind="cart_amount",layer=4,auto_apply=False,amount_satang=10000,min_spend_satang=50000,
       usage_limit=500,used_count=500,season_tag="songkran",starts_at="2026-04-10T17:00:00Z",ends_at="2026-04-16T17:00:00Z",state="ended",
       codes=[{"id":403,"code":"SONGKRAN26","is_active":True}]),
]
dump("admin-promotion-list.json", {"data": promos, "meta":{"page":1,"per_page":50,"total":len(promos),"total_pages":1}})
print("ok")
