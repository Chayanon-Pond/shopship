"use client";

import { Eye, EyeOff, MessageSquareText, Reply, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { listReviews, moderateReview, type AdminReview } from "@/lib/api/admin";
import { useApi, useUrlState } from "@/lib/admin/hooks";
import { fmtDateTime } from "@/lib/admin/format";
import { Dialog, errorMessage, useConfirm, useToast } from "../overlay";
import { Badge, Button, Card, EmptyState, ErrorState, Field, PageHeader, Pagination, Segmented, Select, TableSkeleton, Textarea } from "../ui";

export function ReviewsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { values, set, page } = useUrlState(["status", "rating"] as const);
  const query = { status: values.status || undefined, rating: values.rating ? Number(values.rating) : undefined, page };
  const res = useApi(() => listReviews(query), JSON.stringify(query));
  const [replying, setReplying] = useState<AdminReview | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = res.data?.data ?? [];

  async function setStatus(r: AdminReview, status: "published" | "hidden") {
    if (status === "hidden" && !(await confirm({ title: "ซ่อนรีวิวนี้?", body: "รีวิวจะไม่แสดงบนหน้าสินค้าและไม่นับในคะแนนเฉลี่ย เปิดกลับได้ภายหลัง", confirmLabel: "ซ่อน", danger: true }))) return;
    try {
      const n = await moderateReview(r.id, { status });
      res.mutate((d) => (d ? { ...d, data: d.data.map((x) => (x.id === r.id ? n : x)) } : d!));
      toast(status === "hidden" ? "ซ่อนรีวิวแล้ว" : "แสดงรีวิวแล้ว");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  async function sendReply() {
    if (!replying) return;
    setBusy(true);
    try {
      const n = await moderateReview(replying.id, { reply_body: reply.trim() });
      res.mutate((d) => (d ? { ...d, data: d.data.map((x) => (x.id === n.id ? n : x)) } : d!));
      toast(reply.trim() ? "ตอบกลับแล้ว" : "ลบคำตอบแล้ว");
      setReplying(null);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="รีวิว" subtitle="ซ่อนรีวิวที่ไม่เหมาะสมและตอบกลับลูกค้า" />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline-soft p-3">
          <Segmented value={values.status} onChange={(v) => set({ status: v })} options={[{ value: "", label: "ทั้งหมด" }, { value: "published", label: "แสดงอยู่" }, { value: "hidden", label: "ซ่อนแล้ว" }]} />
          <Select value={values.rating} onChange={(e) => set({ rating: e.target.value })} className="w-auto" aria-label="คะแนน">
            <option value="">ทุกคะแนน</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} ดาว
              </option>
            ))}
          </Select>
        </div>
        {res.error ? (
          <ErrorState message={errorMessage(res.error)} onRetry={res.reload} />
        ) : !res.data ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState icon={MessageSquareText} title="ไม่มีรีวิว" />
        ) : (
          <>
            <ul className="divide-y divide-hairline-soft">
              {rows.map((r) => (
                <li key={r.id} className={`flex flex-col gap-2 px-4 py-3 sm:flex-row ${r.status === "hidden" ? "bg-surface-2" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex" aria-label={`${r.rating} ดาว`}>
                        {Array.from({ length: 5 }, (_, i) => (
                          <Star key={i} className={`size-4 ${i < r.rating ? "fill-[#f5a623] text-[#f5a623]" : "text-hairline"}`} aria-hidden />
                        ))}
                      </span>
                      <Link href={`/admin/products/${r.product.id}`} className="text-sm font-medium text-ink hover:text-link">
                        {r.product.name}
                      </Link>
                      <span className="text-xs text-ink-2">{r.variant_name}</span>
                      {r.status === "hidden" ? <Badge tone="red">ซ่อนอยู่</Badge> : null}
                    </div>
                    {r.title ? <p className="mt-1 font-medium text-ink">{r.title}</p> : null}
                    <p className="text-sm text-ink">{r.body}</p>
                    <p className="text-xs text-ink-2">
                      {r.author_name} · {fmtDateTime(r.created_at)}
                    </p>
                    {r.reply ? <p className="mt-2 rounded-[10px] bg-canvas-alt px-3 py-2 text-[13px] text-ink"><b>ร้านตอบ:</b> {r.reply.body}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    <Button size="sm" variant="outline" icon={Reply} onClick={() => (setReplying(r), setReply(r.reply?.body ?? ""))}>
                      {r.reply ? "แก้คำตอบ" : "ตอบกลับ"}
                    </Button>
                    {r.status === "published" ? (
                      <Button size="sm" variant="ghost" icon={EyeOff} onClick={() => setStatus(r, "hidden")}>
                        ซ่อน
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" icon={Eye} onClick={() => setStatus(r, "published")}>
                        แสดง
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={res.data.meta.page} totalPages={res.data.meta.total_pages} total={res.data.meta.total} onPage={(p) => set({ page: p }, false)} />
          </>
        )}
      </Card>
      <Dialog open={Boolean(replying)} onClose={() => setReplying(null)} title="ตอบกลับรีวิว" size="sm" footer={<><Button onClick={() => setReplying(null)}>ยกเลิก</Button><Button variant="primary" loading={busy} onClick={sendReply}>บันทึก</Button></>}>
        <p className="mb-3 text-sm text-ink-2">“{replying?.body}”</p>
        <Field label="คำตอบของร้าน" hint="แสดงต่อสาธารณะใต้รีวิว · เว้นว่างเพื่อลบคำตอบ">
          <Textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={1000} />
        </Field>
      </Dialog>
    </div>
  );
}
