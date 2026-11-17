"use client";

import { ChevronDown, ChevronUp, ImageIcon, ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { createBanner, deleteBanner, listBanners, listCampaigns, listCategories, updateBanner, uploadFile, type AdminBanner, type BannerInput } from "@/lib/api/admin";
import { useApi } from "@/lib/admin/hooks";
import { fmtDate, fromBkkInput, toBkkInput, windowStatus } from "@/lib/admin/format";
import { bannerSchema, validate } from "@/lib/admin/schemas";
import { IntInput, WindowBadge } from "../bits";
import { Dialog, errorMessage, useConfirm, useToast } from "../overlay";
import { Badge, Button, Card, EmptyState, ErrorState, Field, IconButton, Input, PageHeader, Select, Skeleton, Switch } from "../ui";

const PLACEMENTS = [
  { id: "home_hero", label: "หน้าแรก · ภาพใหญ่ (hero)", hint: "แนะนำ 1920×800 และรูปมือถือ 800×1000" },
  { id: "home_strip", label: "หน้าแรก · แถบประกาศ", hint: "ข้อความสั้น รูปไม่บังคับ" },
  { id: "category_top", label: "หัวหน้าหมวดหมู่", hint: "1600×400 ต่อหมวด" },
] as const;

export function BannersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const res = useApi(() => listBanners(), "banners");
  const [editing, setEditing] = useState<Partial<AdminBanner> | null>(null);
  const all = res.data?.data ?? [];

  async function patch(b: AdminBanner, body: Partial<BannerInput>, msg: string) {
    try {
      await updateBanner(b.id, body);
      toast(msg);
      res.reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  async function move(list: AdminBanner[], i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    try {
      await Promise.all([updateBanner(list[i].id, { sort_order: list[j].sort_order }), updateBanner(list[j].id, { sort_order: list[i].sort_order === list[j].sort_order ? list[i].sort_order + d : list[i].sort_order })]);
      res.reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  async function remove(b: AdminBanner) {
    if (!(await confirm({ title: `ลบแบนเนอร์ “${b.title}”?`, body: "ลบแล้วกู้คืนไม่ได้ ถ้าแค่ไม่อยากแสดง ให้ปิดสวิตช์แทน", confirmLabel: "ลบ", danger: true }))) return;
    try {
      await deleteBanner(b.id);
      toast("ลบแบนเนอร์แล้ว");
      res.reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <div>
      <PageHeader title="แบนเนอร์" subtitle="เปลี่ยนรูป ลิงก์ และช่วงเวลาแสดงได้เอง" actions={<Button variant="primary" icon={Plus} onClick={() => setEditing({ placement: "home_hero", is_active: true })}>เพิ่มแบนเนอร์</Button>} />
      {res.error ? <ErrorState message={errorMessage(res.error)} onRetry={res.reload} /> : null}
      <div className="flex flex-col gap-4">
        {PLACEMENTS.map((pl) => {
          const list = all.filter((b) => b.placement === pl.id).sort((a, b) => a.sort_order - b.sort_order);
          return (
            <Card key={pl.id} title={pl.label} pad={false} actions={<span className="text-xs text-ink-2">{pl.hint}</span>}>
              {!res.data ? (
                <Skeleton className="m-4 h-24" />
              ) : list.length === 0 ? (
                <EmptyState icon={ImageIcon} title="ยังไม่มีแบนเนอร์" action={<Button size="sm" icon={Plus} onClick={() => setEditing({ placement: pl.id, is_active: true })}>เพิ่ม</Button>} />
              ) : (
                <ul className="divide-y divide-hairline-soft">
                  {list.map((b, i) => (
                    <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
                      <div className="flex flex-col">
                        <IconButton size="sm" label="เลื่อนขึ้น" icon={ChevronUp} disabled={i === 0} onClick={() => move(list, i, -1)} />
                        <IconButton size="sm" label="เลื่อนลง" icon={ChevronDown} disabled={i === list.length - 1} onClick={() => move(list, i, 1)} />
                      </div>
                      <div className="h-16 w-28 shrink-0 overflow-hidden rounded-[8px] border border-hairline-soft bg-canvas-alt">
                        {b.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={b.image_url} alt={b.image_alt} className="size-full object-cover" />
                        ) : (
                          <span className="flex size-full items-center justify-center text-xs text-ink-3">ไม่มีรูป</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-ink">{b.title}</p>
                        <p className="truncate text-xs text-ink-2">
                          {b.subtitle} {b.link_url ? `→ ${b.link_url}` : ""}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
                          {b.starts_at || b.ends_at ? (
                            <>
                              <WindowBadge status={windowStatus(b.starts_at ?? "1970-01-01T00:00:00Z", b.ends_at)} />
                              {fmtDate(b.starts_at)} – {b.ends_at ? fmtDate(b.ends_at) : "ไม่มีกำหนด"}
                            </>
                          ) : (
                            <span>แสดงตลอด</span>
                          )}
                          {b.campaign_id ? <Badge tone="blue">แคมเปญ #{b.campaign_id}</Badge> : null}
                        </p>
                      </div>
                      <Switch checked={b.is_active} onChange={(v) => patch(b, { is_active: v }, v ? "เปิดแสดงแล้ว" : "ซ่อนแล้ว")} label={<span className="sr-only">แสดง</span>} />
                      <IconButton label="แก้ไข" icon={Pencil} onClick={() => setEditing(b)} />
                      <IconButton label="ลบ" icon={Trash2} onClick={() => remove(b)} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
      {editing ? <BannerDialog initial={editing} count={all.filter((b) => b.placement === editing.placement).length} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), res.reload())} /> : null}
    </div>
  );
}

function BannerDialog({ initial, count, onClose, onSaved }: { initial: Partial<AdminBanner>; count: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const camps = useApi(() => listCampaigns(), "camps");
  const cats = useApi(listCategories, "cats");
  const fileRef = useRef<HTMLInputElement>(null);
  const mobileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({
    placement: initial.placement ?? "home_hero",
    title: initial.title ?? "",
    subtitle: initial.subtitle ?? "",
    cta_label: initial.cta_label ?? "",
    link_url: initial.link_url ?? "",
    image_url: initial.image_url ?? "",
    image_mobile_url: initial.image_mobile_url ?? "",
    image_alt: initial.image_alt ?? "",
    starts_at: toBkkInput(initial.starts_at),
    ends_at: toBkkInput(initial.ends_at),
    sort_order: String(initial.sort_order ?? count + 1),
    is_active: initial.is_active ?? true,
    campaign_id: initial.campaign_id ? String(initial.campaign_id) : "",
    category_id: initial.category_id ? String(initial.category_id) : "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<"" | "main" | "mobile">("");
  async function upload(file: File | undefined, which: "main" | "mobile") {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024) return toast("ใช้ JPEG/PNG/WebP ไม่เกิน 8 MB", "error");
    setUploading(which);
    try {
      const u = await uploadFile(file);
      setF((x) => ({ ...x, [which === "main" ? "image_url" : "image_mobile_url"]: u.url }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setUploading("");
    }
  }
  async function save() {
    const v = validate(bannerSchema, f);
    const errs = v.ok ? {} : { ...v.errors };
    if (f.placement === "home_hero" && !f.image_url) errs.image_url = "แบนเนอร์ hero ต้องมีรูป";
    if (f.placement === "category_top" && !f.category_id) errs.category_id = "เลือกหมวดหมู่";
    if (Object.keys(errs).length) return setErrors(errs);
    setBusy(true);
    const body: BannerInput = {
      placement: f.placement as AdminBanner["placement"],
      title: f.title,
      subtitle: f.subtitle,
      cta_label: f.cta_label,
      link_url: f.link_url,
      image_url: f.image_url,
      image_mobile_url: f.image_mobile_url,
      image_alt: f.image_alt || f.title,
      starts_at: fromBkkInput(f.starts_at),
      ends_at: fromBkkInput(f.ends_at),
      sort_order: Number(f.sort_order),
      is_active: f.is_active,
      campaign_id: f.campaign_id ? Number(f.campaign_id) : null,
      category_id: f.category_id ? Number(f.category_id) : null,
    };
    try {
      if (initial.id) await updateBanner(initial.id, body);
      else await createBanner(body);
      toast("บันทึกแบนเนอร์แล้ว");
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} size="lg" title={initial.id ? "แก้ไขแบนเนอร์" : "เพิ่มแบนเนอร์"} footer={<><Button onClick={onClose}>ยกเลิก</Button><Button variant="primary" loading={busy} onClick={save}>บันทึก</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="ตำแหน่ง">
          <Select value={f.placement} onChange={(e) => setF({ ...f, placement: e.target.value as AdminBanner["placement"] })}>
            {PLACEMENTS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        {f.placement === "category_top" ? (
          <Field label="หมวดหมู่" error={errors.category_id}>
            <Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })} invalid={Boolean(errors.category_id)}>
              <option value="">เลือกหมวดหมู่</option>
              {(cats.data?.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parent_id ? "— " : ""}
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="ผูกกับแคมเปญ">
            <Select value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })}>
              <option value="">— ไม่ผูก —</option>
              {(camps.data?.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="หัวข้อ" required error={errors.title}>
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} invalid={Boolean(errors.title)} />
        </Field>
        <Field label="คำโปรย" error={errors.subtitle}>
          <Input value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} />
        </Field>
        <Field label="ข้อความปุ่ม" error={errors.cta_label}>
          <Input value={f.cta_label} onChange={(e) => setF({ ...f, cta_label: e.target.value })} placeholder="ช้อปเลย" />
        </Field>
        <Field label="ลิงก์" error={errors.link_url} hint="เช่น /flash-sale หรือ https://…">
          <Input value={f.link_url} onChange={(e) => setF({ ...f, link_url: e.target.value })} invalid={Boolean(errors.link_url)} />
        </Field>
        {(["main", "mobile"] as const).map((w) => {
          const key = w === "main" ? "image_url" : "image_mobile_url";
          return (
            <Field key={w} label={w === "main" ? "รูป (เดสก์ท็อป)" : "รูปมือถือ (ไม่บังคับ)"} error={errors[key]}>
              <div className="flex items-center gap-2">
                <div className="h-14 w-24 shrink-0 overflow-hidden rounded-[8px] border border-hairline-soft bg-canvas-alt">
                  {f[key] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f[key]} alt="" className="size-full object-cover" />
                  ) : null}
                </div>
                <Button size="sm" icon={ImagePlus} loading={uploading === w} onClick={() => (w === "main" ? fileRef : mobileRef).current?.click()}>
                  อัปโหลด
                </Button>
              </div>
            </Field>
          );
        })}
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => upload(e.target.files?.[0], "main")} />
        <input ref={mobileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => upload(e.target.files?.[0], "mobile")} />
        <Field label="คำอธิบายรูป (alt)" className="sm:col-span-2" hint="ช่วย SEO และผู้ใช้โปรแกรมอ่านหน้าจอ">
          <Input value={f.image_alt} onChange={(e) => setF({ ...f, image_alt: e.target.value })} />
        </Field>
        <Field label="เริ่มแสดง (เวลาไทย)" hint="ว่าง = ทันที">
          <Input type="datetime-local" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} />
        </Field>
        <Field label="หยุดแสดง (เวลาไทย)" error={errors.ends_at} hint="ว่าง = ไม่มีกำหนด">
          <Input type="datetime-local" value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} invalid={Boolean(errors.ends_at)} />
        </Field>
        <Field label="ลำดับ" error={errors.sort_order}>
          <IntInput value={f.sort_order} onChange={(v) => setF({ ...f, sort_order: v })} />
        </Field>
        <div className="flex items-end pb-2">
          <Switch checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="เปิดแสดง" />
        </div>
      </div>
    </Dialog>
  );
}
