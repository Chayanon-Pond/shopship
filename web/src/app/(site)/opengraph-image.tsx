import { ogCard, ogSize } from "@/components/og";

export const alt = "ShopShip — ช้อปง่าย ส่งไว ของแท้ทุกชิ้น";
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogCard({ eyebrow: "ร้านค้าออนไลน์ของคนไทย", title: "ช้อปง่าย ส่งไว ของแท้ทุกชิ้น", line: "Flash Sale · โค้ดเทศกาล · ราคาส่ง" });
}
