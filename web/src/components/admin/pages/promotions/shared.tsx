"use client";

/** Shared pieces for the promotions hub: promo table, code generator, audience chips. */
import { Copy, KeyRound, Pause, Pencil, Play, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { addCodes, deletePromotion, updatePromotion, type CouponCode } from "@/lib/api/admin";
import type { AdminPromotion } from "@/lib/api/types";
import { fmtDate, generateCodes, TIER_LABEL } from "@/lib/admin/format";
import { promoValue, usageText } from "@/lib/admin/promo";
import { codeGenSchema, validate } from "@/lib/admin/schemas";
import { IntInput, PromoStateBadge } from "../../bits";
import { Dialog, errorMessage, useConfirm, useToast } from "../../overlay";
import { useSession } from "../../session";
import { Badge, Button, EmptyState, Field, IconButton, Input, Progress, Table, TableSkeleton, Td, Th } from "../../ui";

export function AudienceChips({ p, groups }: { p: AdminPromotion; groups?: { id: number; name: string }[] }) {
  if (!p.customer_group_ids.length && !p.tiers.length) return <span className="text-xs text-ink-2">ทุกคน</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {p.customer_group_ids.map((g) => (
        <Badge key={`g${g}`} tone="purple">
          {groups?.find((x) => x.id === g)?.name ?? `กลุ่ม #${g}`}
        </Badge>
      ))}
      {p.tiers.map((t) => (
        <Badge key={t} tone="orange">
          {TIER_LABEL[t]}
        </Badge>
      ))}
    </span>
  );
}

export function TargetsText({ p }: { p: AdminPromotion }) {
  if (!p.targets.length) return <span className="text-xs text-ink-2">ทั้งร้าน</span>;
  return <span className="text-xs text-ink-2">{p.targets.map((t) => t.name).join(", ")}</span>;
}

export function PromoTable({ rows, loading, groups, onChanged, showCodes, empty }: { rows: AdminPromotion[] | undefined; loading?: boolean; groups?: { id: number; name: string }[]; onChanged: () => void; showCodes?: boolean; empty: React.ReactNode }) {
  const { can } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [gen, setGen] = useState<AdminPromotion | null>(null);
  const canWrite = can("promotions:write");
  if (!rows) return <TableSkeleton />;
  if (rows.length === 0) return <>{empty}</>;

  async function toggle(p: AdminPromotion) {
    const to = p.status === "active" ? "paused" : "active";
    if (to === "active" && p.status === "draft") {
      const ok = await confirm({ title: `เปิดใช้ “${p.name}”?`, body: "แนะนำให้ทดสอบในแท็บ “จำลองตะกร้า” ก่อนเปิดใช้จริง", confirmLabel: "เปิดใช้" });
      if (!ok) return;
    }
    try {
      await updatePromotion(p.id, { status: to });
      toast(to === "active" ? "เปิดใช้โปรแล้ว" : "หยุดโปรชั่วคราวแล้ว");
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  async function remove(p: AdminPromotion) {
    const ok = await confirm({ title: `ลบ “${p.name}”?`, body: p.used_count > 0 ? `โปรนี้ถูกใช้ไปแล้ว ${p.used_count} ครั้ง ระบบจะเก็บถาวรแทนการลบ` : "ลบแล้วกู้คืนไม่ได้", confirmLabel: p.used_count > 0 ? "เก็บถาวร" : "ลบ", danger: true });
    if (!ok) return;
    try {
      await deletePromotion(p.id);
      toast(p.used_count > 0 ? "เก็บถาวรแล้ว" : "ลบแล้ว");
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  return (
    <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
      <Table>
        <thead>
          <tr>
            <Th>โปรโมชัน</Th>
            {showCodes ? <Th>โค้ด</Th> : null}
            <Th>มูลค่า</Th>
            <Th>กลุ่มเป้าหมาย</Th>
            <Th>ใช้ไป</Th>
            <Th>ช่วงเวลา</Th>
            <Th>สถานะ</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="hover:bg-surface-2">
              <Td>
                <Link href={`/admin/promotions/${p.id}`} className="font-medium text-ink hover:text-link">
                  {p.name}
                </Link>
                <span className="block text-xs text-ink-2">{p.label}</span>
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {p.exclusive ? <Badge tone="red">ใช้ร่วมไม่ได้</Badge> : null}
                  {p.campaign ? <Badge tone="blue">{p.campaign.name}</Badge> : null}
                </span>
              </Td>
              {showCodes ? (
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {p.codes.slice(0, 2).map((c) => (
                      <code key={c.id} className={`rounded-[6px] px-1.5 py-0.5 text-xs ${c.is_active ? "bg-canvas-alt text-ink" : "bg-canvas-alt text-ink-3 line-through"}`}>
                        {c.code}
                      </code>
                    ))}
                    {p.codes.length > 2 ? <span className="text-xs text-ink-2">+{p.codes.length - 2}</span> : null}
                  </span>
                </Td>
              ) : null}
              <Td className="max-w-[220px] text-[13px]">
                {promoValue(p)}
                <div>
                  <TargetsText p={p} />
                </div>
              </Td>
              <Td>
                <AudienceChips p={p} groups={groups} />
              </Td>
              <Td className="min-w-[110px] text-[13px]">
                {usageText(p)}
                {p.usage_limit !== null ? <Progress value={p.used_count} max={p.usage_limit} className="mt-1" tone={p.used_count / p.usage_limit > 0.8 ? "orange" : "blue"} /> : null}
              </Td>
              <Td className="whitespace-nowrap text-[13px] text-ink-2">
                {fmtDate(p.starts_at)} – {p.ends_at ? fmtDate(p.ends_at) : "ไม่มีกำหนด"}
              </Td>
              <Td>
                <PromoStateBadge state={p.state} />
              </Td>
              <Td align="right">
                <span className="flex justify-end">
                  {canWrite && p.layer === 4 ? <IconButton size="sm" label="สร้างโค้ดจำนวนมาก" icon={Wand2} onClick={() => setGen(p)} /> : null}
                  {canWrite && p.status !== "archived" ? <IconButton size="sm" label={p.status === "active" ? "หยุดชั่วคราว" : "เปิดใช้"} icon={p.status === "active" ? Pause : Play} onClick={() => toggle(p)} /> : null}
                  <Link href={`/admin/promotions/${p.id}`} aria-label="แก้ไข" title="แก้ไข" className="flex size-8 items-center justify-center rounded-[10px] text-ink-2 hover:bg-canvas-alt hover:text-ink">
                    <Pencil className="size-[18px]" aria-hidden />
                  </Link>
                  {canWrite ? <IconButton size="sm" label="ลบ" icon={Trash2} onClick={() => remove(p)} /> : null}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {gen ? <CodeGenerator promo={gen} onClose={() => setGen(null)} onDone={onChanged} /> : null}
    </div>
  );
}

export function CodeGenerator({ promo, onClose, onDone }: { promo: AdminPromotion; onClose: () => void; onDone: (codes: CouponCode[]) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ count: "50", prefix: promo.codes[0]?.code.replace(/[^A-Z]/g, "").slice(0, 6) || "SHOP", length: "6" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CouponCode[] | null>(null);
  const v = validate(codeGenSchema, f);
  const sample = v.ok ? generateCodes(3, f.prefix, Number(f.length)) : [];
  async function run() {
    if (!v.ok) return setErrors(v.errors);
    setBusy(true);
    try {
      const codes = await addCodes(promo.id, { generate: { count: Number(f.count), prefix: f.prefix.toUpperCase(), length: Number(f.length) } });
      setResult(codes);
      toast(`สร้าง ${codes.length} โค้ดแล้ว`);
      onDone(codes);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  const copyAll = () => {
    navigator.clipboard?.writeText((result ?? []).map((c) => c.code).join("\n")).then(
      () => toast("คัดลอกโค้ดทั้งหมดแล้ว"),
      () => toast("คัดลอกไม่ได้", "error"),
    );
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`สร้างโค้ดจำนวนมาก · ${promo.name}`}
      size="sm"
      footer={
        result ? (
          <>
            <Button icon={Copy} onClick={copyAll}>
              คัดลอกทั้งหมด
            </Button>
            <Button variant="primary" onClick={onClose}>
              เสร็จ
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>ยกเลิก</Button>
            <Button variant="primary" icon={KeyRound} loading={busy} onClick={run}>
              สร้าง {v.ok ? f.count : ""} โค้ด
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="max-h-72 overflow-y-auto rounded-[10px] bg-canvas-alt p-3 font-mono text-[13px] leading-7">
          {result.map((c) => (
            <div key={c.id}>{c.code}</div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4">
          <p className="text-sm text-ink-2">แต่ละโค้ดใช้เงื่อนไขเดียวกับโปรนี้ (ขีดจำกัดการใช้รวมนับทุกโค้ด) เหมาะกับแจกเฉพาะคน เช่น การ์ดในกล่องพัสดุ</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="จำนวน" error={errors.count}>
              <IntInput value={f.count} onChange={(x) => setF({ ...f, count: x })} invalid={Boolean(errors.count)} />
            </Field>
            <Field label="คำนำหน้า" error={errors.prefix}>
              <Input value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value.toUpperCase() })} invalid={Boolean(errors.prefix)} className="font-mono" />
            </Field>
            <Field label="ความยาวสุ่ม" error={errors.length}>
              <IntInput value={f.length} onChange={(x) => setF({ ...f, length: x })} invalid={Boolean(errors.length)} />
            </Field>
          </div>
          {sample.length ? (
            <div>
              <p className="mb-1 text-xs text-ink-2">ตัวอย่าง (ไม่ใช้ตัว 0/O/1/I เพื่อกันสับสน)</p>
              <div className="flex flex-wrap gap-1.5">
                {sample.map((s) => (
                  <code key={s} className="rounded-[6px] bg-canvas-alt px-2 py-1 text-[13px]">
                    {s}
                  </code>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

export function EmptyPromos({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return <EmptyState icon={KeyRound} title={title} body={body} action={action} />;
}
