import { A, entity, Fill, LegalDoc, legalMetadata, P, Table, UL, type LegalSection } from "../_components/legal-doc";

export const metadata = legalMetadata(
  "shipping",
  "การจัดส่ง",
  "ShopShip จัดส่งทั่วไทยด้วย Flash Express: ระยะเวลาเตรียมและส่งสินค้า ค่าจัดส่ง ส่งฟรีเมื่อช้อปครบ การติดตามพัสดุ และกรณีพัสดุเสียหาย",
);

const sections: LegalSection[] = [
  {
    id: "carrier",
    title: "ขนส่งและพื้นที่จัดส่ง",
    body: <P>เราจัดส่งทั่วประเทศไทยด้วย Flash Express ขณะนี้ยังไม่จัดส่งไปต่างประเทศ และยังไม่มีบริการเก็บเงินปลายทาง</P>,
  },
  {
    id: "time",
    title: "ระยะเวลา",
    body: (
      <Table
        head={["ขั้นตอน", "ระยะเวลาโดยประมาณ"]}
        rows={[
          ["เตรียมและแพ็กสินค้า", <><Fill>[1–2]</Fill> วันทำการหลังชำระเงินสำเร็จ</>],
          ["ขนส่งทั่วไป", "1–3 วันทำการ"],
          ["พื้นที่ห่างไกล (เช่น แม่ฮ่องสอน ตาก ปัตตานี ยะลา นราธิวาส)", "2–5 วันทำการ"],
        ]}
      />
    ),
  },
  {
    id: "fees",
    title: "ค่าจัดส่ง",
    body: (
      <UL
        items={[
          "ค่าจัดส่งคำนวณตามน้ำหนักพัสดุ และแสดงในตะกร้าก่อนชำระเงินเสมอ",
          <>
            ส่งฟรีเมื่อช้อปครบตามยอดที่ประกาศในโปรโมชัน (ปัจจุบัน ฿990) ดูได้ที่ <A href="/promotions">โปรโมชัน</A>
          </>,
        ]}
      />
    ),
  },
  {
    id: "tracking",
    title: "ติดตามพัสดุ",
    body: (
      <P>
        เมื่อจัดส่งแล้ว เราจะส่งเลขพัสดุทางอีเมล และคุณดูสถานะล่าสุดได้ใน <A href="/account/orders">คำสั่งซื้อของฉัน</A>
      </P>
    ),
  },
  {
    id: "problems",
    title: "ส่งไม่สำเร็จ หรือพัสดุเสียหาย",
    body: (
      <UL
        items={[
          "ตรวจชื่อ ที่อยู่ และเบอร์โทรศัพท์ให้ถูกต้องก่อนสั่งซื้อ เปลี่ยนที่อยู่ได้ก่อนเราจัดส่งเท่านั้น โดยติดต่อเรา",
          "หากผู้ส่งติดต่อไม่ได้หลายครั้ง พัสดุอาจถูกตีกลับ เราจะติดต่อคุณเพื่อส่งใหม่ หรือคืนเงินค่าสินค้า",
          <>
            หากพัสดุเสียหาย สูญหาย หรือล่าช้าผิดปกติ แจ้งเราที่ <Fill>{entity.email}</Fill> พร้อมรูปถ่าย เราจะส่งใหม่หรือคืนเงินให้ ดู{" "}
            <A href="/legal/returns">นโยบายการคืนสินค้าและคืนเงิน</A>
          </>,
        ]}
      />
    ),
  },
];

export default function ShippingPage() {
  return (
    <LegalDoc
      slug="shipping"
      title="การจัดส่ง"
      summaryEn="Nationwide delivery in Thailand with Flash Express: handling time, delivery time, fees, free-shipping threshold, tracking and damaged parcels."
      intro={<p>ส่งทั่วไทยด้วย Flash Express ส่วนใหญ่ถึงมือคุณใน 1–3 วันทำการ</p>}
      sections={sections}
    />
  );
}
