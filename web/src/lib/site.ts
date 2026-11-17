/** Site-wide identity. Domain is not registered yet: override with NEXT_PUBLIC_SITE_URL. */
export const site = {
  name: "ShopShip",
  title: "ShopShip — ช้อปง่าย ส่งไว ของแท้ทุกชิ้น",
  description:
    "ShopShip ร้านค้าออนไลน์ของคนไทย สินค้าคุณภาพหลายหมวด จ่ายง่ายด้วย PromptPay หรือบัตร ส่งไวทั่วไทยด้วย Flash Express พร้อมโค้ดส่วนลดและ Flash Sale ทุกวัน",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  locale: "th_TH",
  email: "support@shopship.example",
  phone: "02-000-0000",
} as const;

/**
 * Marketing copy only. Real amounts always come from the API (quote hints,
 * /offers qty_breaks); these strings explain the programmes on banners.
 */
export const promoCopy = {
  freeShipping: { title: "ส่งฟรีเมื่อช้อปครบ ฿990", body: "ทุกออเดอร์ทั่วไทย ส่งไวด้วย Flash Express 1–3 วัน" },
  trade: {
    eyebrow: "ราคาส่ง",
    title: "ซื้อยิ่งเยอะ ยิ่งถูก",
    tiers: ["ซื้อ 5 ชิ้นลด 5%", "10 ชิ้นลด 10%"],
    body: "สินค้าที่มีป้าย “ราคาส่ง” ลดอัตโนมัติตามจำนวนในตะกร้าเมื่อเข้าสู่ระบบ ลูกค้าขายส่งที่ลงทะเบียนได้ราคาขายส่งทุกชิ้น",
  },
  member: {
    title: "ยิ่งเป็นสมาชิกนาน ยิ่งได้มากกว่า",
    tiers: [
      { tier: "silver", name: "Silver", perk: "ราคาสมาชิกลด 3% ในสินค้าที่ร่วมรายการ" },
      { tier: "gold", name: "Gold", perk: "ราคาสมาชิกลด 5% ในสินค้าที่ร่วมรายการ" },
      { tier: "platinum", name: "Platinum", perk: "ราคาสมาชิกลด 8% ในสินค้าที่ร่วมรายการ" },
    ],
  },
} as const;

export const tierLabel: Record<string, string> = {
  standard: "สมาชิก",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
};
