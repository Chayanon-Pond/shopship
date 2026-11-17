package demo

// Demo catalog: fictional brands only, Thai + English names, prices in baht
// (converted to satang on insert). opts: "สี=ขาว,ดำ|ไซซ์=S,M,L" (empty = one variant).

type catDef struct {
	slug, name, icon string
	children         []catDef
}

var categories = []catDef{
	{"fashion", "แฟชั่น", "Shirt", []catDef{{"tshirts", "เสื้อยืด", "Shirt", nil}, {"shirts", "เสื้อเชิ้ต", "Shirt", nil}, {"bags", "กระเป๋า", "ShoppingBag", nil}, {"shoes", "รองเท้า", "Footprints", nil}}},
	{"beauty", "ความงาม", "Sparkles", []catDef{{"skincare", "สกินแคร์", "Droplet", nil}, {"makeup", "เมคอัพ", "Palette", nil}, {"haircare", "ดูแลเส้นผม", "Wind", nil}}},
	{"gadgets", "แกดเจ็ต", "Headphones", []catDef{{"audio", "หูฟังและลำโพง", "Headphones", nil}, {"wearables", "อุปกรณ์สวมใส่", "Watch", nil}, {"phone-accessories", "อุปกรณ์เสริมมือถือ", "Smartphone", nil}}},
	{"home", "บ้านและครัว", "Sofa", []catDef{{"kitchen", "ครัว", "CookingPot", nil}, {"bedding", "เครื่องนอน", "BedDouble", nil}, {"decor", "ของแต่งบ้าน", "Lamp", nil}}},
	{"sports", "กีฬา", "Dumbbell", []catDef{{"fitness", "ฟิตเนส", "Dumbbell", nil}, {"running", "วิ่ง", "Footprints", nil}, {"outdoor", "แคมปิ้ง", "Tent", nil}}},
	{"kids", "แม่และเด็ก", "Baby", []catDef{{"toys", "ของเล่น", "Puzzle", nil}, {"kids-clothing", "เสื้อผ้าเด็ก", "Shirt", nil}}},
	{"food-snacks", "อาหารและขนม", "Cookie", []catDef{{"snacks", "ขนมขบเคี้ยว", "Cookie", nil}, {"drinks", "เครื่องดื่ม", "Coffee", nil}, {"local-goods", "ของฝากท้องถิ่น", "Gift", nil}}},
	{"stationery", "เครื่องเขียน", "PenTool", []catDef{{"notebooks", "สมุดโน้ต", "Notebook", nil}, {"pens", "ปากกา", "Pen", nil}, {"art-supplies", "อุปกรณ์ศิลปะ", "Brush", nil}}},
}

type prodDef struct {
	slug, name, nameEN, subtitle, brand, cat string
	price                                    int64 // baht
	opts                                     string
	tags                                     string
	weight                                   int // grams per unit
}

var products = []prodDef{
	// fashion
	{"cotton-tee-classic", "เสื้อยืดคอตตอนคลาสสิก", "Classic Cotton Tee", "คอตตอน 100% นุ่ม ไม่ย้วย", "ShopShip Basics", "tshirts", 290, "สี=ขาว,ดำ,กรมท่า|ไซซ์=S,M,L,XL", "basic,cotton", 220},
	{"oversize-tee-graphic", "เสื้อยืดโอเวอร์ไซซ์ลายกราฟิก", "Oversize Graphic Tee", "ลายสกรีนช้างไทย สไตล์สตรีท", "Siam Thread", "tshirts", 390, "สี=ครีม,ดำ|ไซซ์=M,L,XL", "streetwear,graphic", 260},
	{"linen-shirt", "เสื้อเชิ้ตลินิน", "Linen Shirt", "ผ้าลินินแท้ ใส่สบาย", "ShopShip Basics", "shirts", 590, "สี=ขาว,กรมท่า|ไซซ์=M,L", "linen,shirt", 300},
	{"oxford-shirt", "เสื้อเชิ้ตอ็อกซ์ฟอร์ด", "Oxford Shirt", "ทรงสลิม รีดง่าย ใส่ทำงานได้", "Siam Thread", "shirts", 690, "สี=ฟ้า,ขาว|ไซซ์=S,M,L,XL", "office,shirt", 320},
	{"canvas-tote-bag", "ถุงผ้าแคนวาส", "Canvas Tote Bag", "แคนวาสหนา 12 ออนซ์", "ShopShip Basics", "bags", 250, "สี=ธรรมชาติ,ดำ", "eco,bag", 280},
	{"mini-crossbody-bag", "กระเป๋าสะพายข้างมินิ", "Mini Crossbody Bag", "หนังเทียมกันน้ำ ใส่มือถือได้", "Siam Thread", "bags", 790, "สี=ดำ,น้ำตาล,ครีม", "bag,crossbody", 350},
	{"travel-backpack-25l", "กระเป๋าเป้เดินทาง 25 ลิตร", "Travel Backpack 25L", "ช่องโน้ตบุ๊ก 15 นิ้ว กันละอองน้ำ", "Kinetik", "bags", 1290, "สี=ดำ,เทา", "travel,backpack", 900},
	{"canvas-sneakers", "รองเท้าผ้าใบแคนวาส", "Canvas Sneakers", "พื้นยางกันลื่น ใส่ได้ทุกวัน", "Siam Thread", "shoes", 890, "สี=ขาว,ดำ|ไซซ์=38,39,40,41,42", "sneakers,shoes", 700},
	// beauty
	{"vitamin-c-serum", "เซรั่มวิตามินซี", "Vitamin C Serum", "ผิวกระจ่างใส ลดจุดด่างดำ", "Lanna Leaf", "skincare", 450, "ขนาด=15 มล.,30 มล.", "serum,brightening", 120},
	{"aloe-soothing-gel", "เจลว่านหางจระเข้", "Aloe Soothing Gel", "ปลอบผิวหลังออกแดด", "Lanna Leaf", "skincare", 190, "ขนาด=100 มล.,250 มล.", "aloe,aftersun", 200},
	{"sunscreen-spf50", "ครีมกันแดด SPF50 PA++++", "Sunscreen SPF50 PA++++", "เนื้อบางเบา ไม่เหนียวเหนอะหนะ", "Lanna Leaf", "skincare", 390, "", "sunscreen,spf50", 80},
	{"rice-water-toner", "โทนเนอร์น้ำนมข้าว", "Rice Water Toner", "ข้าวหอมมะลิ ผิวชุ่มชื้น", "Lanna Leaf", "skincare", 320, "", "toner,rice", 250},
	{"matte-lip-tint", "ลิปทินต์เนื้อแมตต์", "Matte Lip Tint", "ติดทนนาน ไม่ตกร่อง", "Petal Lab", "makeup", 199, "สี=ชมพูนู้ด,แดงอิฐ,ส้มพีช,เบอร์รี่", "lip,matte", 30},
	{"cushion-foundation", "คุชชั่นรองพื้น", "Cushion Foundation", "ปกปิดเนียน คุมมัน 8 ชั่วโมง", "Petal Lab", "makeup", 590, "เฉดสี=21 ผิวขาว,23 ผิวสองสี", "cushion,foundation", 90},
	{"herbal-shampoo", "แชมพูสมุนไพรอัญชัน", "Butterfly Pea Herbal Shampoo", "ลดผมร่วง สูตรอ่อนโยน", "Lanna Leaf", "haircare", 250, "ขนาด=300 มล.,500 มล.", "shampoo,herbal", 400},
	// gadgets
	{"wireless-earbuds-pro", "หูฟังไร้สาย Pro", "Wireless Earbuds Pro", "ตัดเสียงรบกวน ANC", "Sonar", "audio", 1200, "สี=ดำ,ขาว", "earbuds,anc", 150},
	{"bluetooth-speaker-mini", "ลำโพงบลูทูธมินิ", "Mini Bluetooth Speaker", "กันน้ำ IPX7 เบสแน่น", "Sonar", "audio", 890, "สี=ดำ,น้ำเงิน,แดง", "speaker,waterproof", 350},
	{"over-ear-headphones", "หูฟังครอบหู", "Over-Ear Headphones", "แบต 40 ชั่วโมง พับเก็บได้", "Sonar", "audio", 1890, "สี=ดำ,เบจ", "headphones,wireless", 280},
	{"smart-watch-lite", "สมาร์ทวอทช์ Lite", "Smart Watch Lite", "จอ AMOLED แบต 7 วัน", "Kinetik", "wearables", 890, "สี=ดำ,ชมพู", "smartwatch,fitness", 60},
	{"fitness-band", "สายรัดข้อมือฟิตเนส", "Fitness Band", "นับก้าว วัดการนอน กันน้ำ", "Kinetik", "wearables", 590, "สี=ดำ,เขียว", "band,fitness", 40},
	{"fast-charger-20w", "หัวชาร์จเร็ว 20W", "20W Fast Charger", "USB-C PD ปลอดภัย มี มอก.", "Volt", "phone-accessories", 290, "", "charger,usb-c", 90},
	{"power-bank-10000", "พาวเวอร์แบงก์ 10000mAh", "Power Bank 10000mAh", "บางเบา ชาร์จเร็ว 2 ทาง", "Volt", "phone-accessories", 590, "สี=ขาว,ดำ", "powerbank", 220},
	{"usb-c-cable-braided", "สาย USB-C ถักไนลอน", "Braided USB-C Cable", "ทนทาน ชาร์จเร็ว 60W", "Volt", "phone-accessories", 159, "ความยาว=1 ม.,2 ม.", "cable,usb-c", 60},
	// home
	{"ceramic-mug", "แก้วมัคเซรามิก", "Ceramic Mug", "เคลือบด้าน 350 มล.", "Baan Craft", "kitchen", 220, "สี=ขาว,เขียวเซลาดอน,ฟ้า", "mug,ceramic", 380},
	{"celadon-plate-set", "ชุดจานเซลาดอน 4 ใบ", "Celadon Plate Set (4 pcs)", "เครื่องเคลือบศิลาดลเชียงใหม่", "Baan Craft", "kitchen", 990, "", "celadon,plate", 2200},
	{"stainless-tumbler", "แก้วเก็บความเย็นสแตนเลส", "Stainless Tumbler", "เย็นนาน 24 ชั่วโมง 900 มล.", "Kinetik", "kitchen", 450, "สี=ดำ,ขาว,ชมพู,เขียว", "tumbler,stainless", 450},
	{"bamboo-cutting-board", "เขียงไม้ไผ่", "Bamboo Cutting Board", "ไม้ไผ่ธรรมชาติ ไม่ขึ้นรา", "Baan Craft", "kitchen", 290, "ขนาด=กลาง,ใหญ่", "bamboo,kitchen", 800},
	{"cotton-bedsheet-set", "ชุดผ้าปูที่นอนคอตตอน", "Cotton Bedsheet Set", "ทอ 400 เส้นด้าย นุ่มลื่น", "Baan Craft", "bedding", 1290, "ขนาด=3.5 ฟุต,5 ฟุต,6 ฟุต|สี=ขาว,เทา", "bedsheet,cotton", 1500},
	{"latex-pillow", "หมอนยางพารา", "Natural Latex Pillow", "ยางพาราแท้จากภาคใต้", "Baan Craft", "bedding", 890, "", "pillow,latex", 1100},
	{"scented-candle", "เทียนหอมตะไคร้", "Lemongrass Scented Candle", "ไขถั่วเหลือง จุดได้ 30 ชั่วโมง", "Lanna Leaf", "decor", 350, "กลิ่น=ตะไคร้,มะลิ,ชาเขียว", "candle,aroma", 300},
	{"rattan-basket", "ตะกร้าหวาย", "Rattan Basket", "งานจักสานมือ อเนกประสงค์", "Baan Craft", "decor", 490, "ขนาด=เล็ก,กลาง", "rattan,handmade", 500},
	// sports
	{"yoga-mat-6mm", "เสื่อโยคะ 6 มม.", "Yoga Mat 6mm", "TPE กันลื่น 2 ด้าน", "Kinetik", "fitness", 590, "สี=ม่วง,เขียว,เทา", "yoga,mat", 900},
	{"adjustable-dumbbell", "ดัมเบลปรับน้ำหนัก", "Adjustable Dumbbell", "ปรับ 2-10 กก. ประหยัดพื้นที่", "Kinetik", "fitness", 1590, "", "dumbbell,gym", 10500},
	{"resistance-band-set", "ยางยืดออกกำลังกาย 5 ระดับ", "Resistance Band Set", "ครบ 5 แรงต้าน พร้อมถุงพกพา", "Kinetik", "fitness", 350, "", "resistance,band", 400},
	{"running-shoes-air", "รองเท้าวิ่ง Air", "Air Running Shoes", "พื้นโฟมเด้ง ระบายอากาศ", "Kinetik", "running", 1890, "ไซซ์=39,40,41,42,43", "running,shoes", 650},
	{"dry-fit-running-shirt", "เสื้อวิ่งดรายฟิต", "Dry-Fit Running Shirt", "แห้งไว ไม่อับชื้น", "Kinetik", "running", 390, "สี=ส้ม,ดำ,ฟ้า|ไซซ์=S,M,L,XL", "running,dryfit", 150},
	{"camping-tent-2p", "เต็นท์แคมปิ้ง 2 คน", "2-Person Camping Tent", "กางง่าย 5 นาที กันฝน", "Kinetik", "outdoor", 2490, "", "tent,camping", 2800},
	{"camping-chair", "เก้าอี้แคมปิ้งพับได้", "Folding Camping Chair", "รับน้ำหนัก 120 กก.", "Kinetik", "outdoor", 790, "สี=เขียวขี้ม้า,ดำ", "chair,camping", 1800},
	// kids
	{"wooden-blocks", "บล็อกไม้ตัวต่อ 50 ชิ้น", "Wooden Building Blocks (50 pcs)", "ไม้ยางพารา สีปลอดสารพิษ", "Little Elephant", "toys", 490, "", "toy,wooden", 1200},
	{"plush-elephant", "ตุ๊กตาช้างน้อย", "Plush Baby Elephant", "ผ้านุ่ม ซักเครื่องได้", "Little Elephant", "toys", 350, "ขนาด=30 ซม.,50 ซม.", "plush,elephant", 300},
	{"jigsaw-thailand-map", "จิ๊กซอว์แผนที่ประเทศไทย", "Thailand Map Jigsaw", "100 ชิ้น เรียนรู้ 77 จังหวัด", "Little Elephant", "toys", 290, "", "jigsaw,education", 450},
	{"kids-cotton-pajamas", "ชุดนอนเด็กคอตตอน", "Kids Cotton Pajamas", "ผ้านุ่ม ไม่ระคายเคือง", "Little Elephant", "kids-clothing", 390, "ไซซ์=2-3 ปี,4-5 ปี,6-7 ปี|ลาย=ช้าง,ไดโนเสาร์", "pajamas,kids", 200},
	{"kids-sun-hat", "หมวกกันแดดเด็ก", "Kids Sun Hat", "UPF50+ มีสายรัดคาง", "Little Elephant", "kids-clothing", 250, "สี=เหลือง,ฟ้า,ชมพู", "hat,kids", 80},
	// food & snacks
	{"durian-chips", "ทุเรียนทอดกรอบ", "Crispy Durian Chips", "หมอนทองจันทบุรี ทอดใหม่", "Chao Phraya Snacks", "snacks", 189, "ขนาด=100 กรัม,250 กรัม", "durian,chips", 150},
	{"seaweed-snack", "สาหร่ายอบกรอบ", "Crispy Seaweed Snack", "รสต้นตำรับ อบไม่ทอด", "Chao Phraya Snacks", "snacks", 59, "รส=ออริจินัล,ต้มยำ,ลาบ", "seaweed,snack", 40},
	{"cashew-honey-roasted", "เม็ดมะม่วงหิมพานต์อบน้ำผึ้ง", "Honey Roasted Cashews", "เม็ดเต็ม จากระนอง", "Chao Phraya Snacks", "snacks", 249, "ขนาด=200 กรัม,500 กรัม", "cashew,nuts", 250},
	{"thai-tea-mix", "ชาไทยปรุงสำเร็จ", "Thai Tea Mix", "หอมเข้ม สูตรต้นตำรับ", "Chao Phraya Snacks", "drinks", 159, "ขนาด=400 กรัม,1 กก.", "thaitea,drink", 450},
	{"drip-coffee-doi-chang", "กาแฟดริปดอยช้าง", "Doi Chang Drip Coffee", "อาราบิก้า 100% คั่วกลาง 10 ซอง", "Lanna Leaf", "drinks", 220, "", "coffee,arabica", 150},
	{"butterfly-pea-tea", "ชาอัญชันมะนาว", "Butterfly Pea Lemon Tea", "เปลี่ยนสีได้ ไม่มีคาเฟอีน", "Lanna Leaf", "drinks", 129, "", "tea,herbal", 100},
	{"chiang-mai-sausage", "ไส้อั่วเชียงใหม่สูญญากาศ", "Chiang Mai Sai Ua Sausage", "สมุนไพรเต็มคำ แพ็กสูญญากาศ", "Lanna Leaf", "local-goods", 179, "", "local,northern", 500},
	{"khanom-pia", "ขนมเปี๊ยะไส้ถั่วไข่เค็ม", "Khanom Pia Mung Bean & Salted Egg", "แป้งบางกรอบ 6 ชิ้น", "Chao Phraya Snacks", "local-goods", 120, "ไส้=ถั่วไข่เค็ม,ทุเรียน", "khanompia,local", 400},
	{"mango-sticky-rice-dried", "มะม่วงอบแห้ง", "Dried Mango", "น้ำดอกไม้ หวานธรรมชาติ", "Chao Phraya Snacks", "local-goods", 99, "ขนาด=100 กรัม,500 กรัม", "mango,dried", 120},
	// stationery
	{"dot-grid-notebook", "สมุดโน้ตจุด A5", "A5 Dot Grid Notebook", "กระดาษ 100 แกรม 160 หน้า", "Inkwell", "notebooks", 189, "สี=ดำ,ครีม,เขียว", "notebook,bullet-journal", 300},
	{"kraft-planner-2027", "แพลนเนอร์ปกคราฟต์ 2027", "2027 Kraft Planner", "รายวัน-รายเดือน ภาษาไทย", "Inkwell", "notebooks", 259, "", "planner,2027", 350},
	{"gel-pen-set", "ชุดปากกาเจล 10 สี", "Gel Pen Set (10 colours)", "หัว 0.5 มม. เขียนลื่น", "Inkwell", "pens", 129, "", "pen,gel", 120},
	{"fountain-pen-classic", "ปากกาหมึกซึมคลาสสิก", "Classic Fountain Pen", "หัว F เปลี่ยนหลอดหมึกได้", "Inkwell", "pens", 590, "สี=ดำ,น้ำเงิน,แดง", "fountain-pen", 60},
	{"highlighter-pastel", "ปากกาไฮไลต์สีพาสเทล", "Pastel Highlighters", "6 สี ไม่ซึมกระดาษ", "Inkwell", "pens", 99, "", "highlighter,pastel", 80},
	{"watercolor-set-24", "สีน้ำ 24 สี", "Watercolor Set (24 colours)", "พกพาง่าย พร้อมพู่กัน", "Inkwell", "art-supplies", 450, "", "watercolor,art", 400},
	{"sketchbook-a4", "สมุดสเก็ตช์ A4", "A4 Sketchbook", "กระดาษ 150 แกรม 50 แผ่น", "Inkwell", "art-supplies", 159, "", "sketchbook,art", 600},
	{"acrylic-paint-12", "สีอะคริลิก 12 สี", "Acrylic Paint (12 colours)", "กันน้ำ สีสด ติดทน", "Inkwell", "art-supplies", 290, "", "acrylic,paint", 500},
}

var reviewPool = map[int][]struct{ title, body string }{
	5: {{"ดีมาก", "คุณภาพดีเกินราคา ส่งไวมาก แพ็กของดี"}, {"ประทับใจ", "ใช้มาสองอาทิตย์ ยังดีอยู่ จะกลับมาซื้ออีก"}, {"", "ตรงปก สีสวยเหมือนในรูปเลยค่ะ"}, {"แนะนำเลย", "ซื้อเป็นของขวัญ ผู้รับชอบมาก"}, {"", "ของดี ราคาโอเค ร้านตอบไว"}},
	4: {{"โดยรวมดี", "ใช้งานได้ดี แต่จัดส่งช้าไปหนึ่งวัน"}, {"", "คุ้มค่า มีจุดเล็กน้อยแต่รับได้"}, {"ดีครับ", "ตามที่คาดหวัง ไซซ์ตรง"}},
	3: {{"พอใช้", "ใช้ได้ตามราคา ไม่ได้ว้าวมาก"}, {"", "สีอ่อนกว่าในรูปนิดหน่อย"}},
	2: {{"ไม่ค่อยประทับใจ", "กล่องบุบมาเล็กน้อย ตัวสินค้ายังโอเค"}},
	1: {{"ผิดหวัง", "ได้ของไม่ตรงสีที่สั่ง แต่ร้านเปลี่ยนให้"}},
}

var reviewerNames = []string{"ส***า", "ป***ท", "N***n", "ก***ย", "ม***ี", "J***e", "อ***ร", "พ***ล", "W***a", "ธ***ช"}

var palette = map[string][2]string{
	"fashion": {"#F2E8DF", "#8A5A44"}, "beauty": {"#FBE4EC", "#B04A6F"}, "gadgets": {"#E3ECF7", "#2D5D9B"},
	"home": {"#E8F1E4", "#4C7A45"}, "sports": {"#FFF0DC", "#C2671B"}, "kids": {"#FFF7CC", "#B8900C"},
	"food-snacks": {"#FDE9D9", "#A8522A"}, "stationery": {"#ECE7F7", "#5E4A9B"},
}
