import Link from "next/link";
import { LogoMark } from "@/components/layout/logo";

export default function NotFound() {
  return (
    <div className="container-page flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <LogoMark className="size-14 opacity-90" />
      <p className="mt-6 text-sm font-semibold text-ink-2">404</p>
      <h1 className="mt-1 text-[36px] font-semibold tracking-[-0.03em] md:text-[56px]">ไม่พบหน้าที่คุณค้นหา</h1>
      <p className="mt-2 max-w-md text-lg text-ink-2">สินค้าอาจถูกนำออกจากร้าน หรือลิงก์อาจไม่ถูกต้อง ลองค้นหาหรือกลับไปหน้าแรก</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn btn-primary">
          กลับหน้าแรก
        </Link>
        <Link href="/search" className="btn btn-secondary">
          ค้นหาสินค้า
        </Link>
      </div>
    </div>
  );
}
