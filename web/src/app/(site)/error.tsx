"use client";

import { RotateCcw } from "lucide-react";
import Link from "next/link";

export default function SiteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="container-page flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <h1 className="text-[32px] font-semibold tracking-[-0.03em] md:text-[44px]">ขออภัย มีบางอย่างผิดพลาด</h1>
      <p className="mt-2 max-w-md text-ink-2">ระบบขัดข้องชั่วคราว ข้อมูลในตะกร้าของคุณยังอยู่ครบ ลองใหม่อีกครั้งได้เลย</p>
      <div className="mt-8 flex gap-3">
        <button type="button" onClick={reset} className="btn btn-primary">
          <RotateCcw className="size-4" aria-hidden /> ลองใหม่
        </button>
        <Link href="/" className="btn btn-secondary">
          หน้าแรก
        </Link>
      </div>
    </div>
  );
}
