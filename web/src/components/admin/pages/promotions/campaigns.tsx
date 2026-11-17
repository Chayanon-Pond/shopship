"use client";

import { CalendarRange, ImagePlus, Pencil, Plus, Trash2, Zap } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  createBanner,
  createCampaign,
  deleteCampaign,
  listBanners,
  listCampaigns,
  listFlashSales,
  listPromotions,
  updateBanner,
  updateCampaign,
  uploadFile,
  type AdminBanner,
  type AdminCampaign,
  type CampaignInput,
} from "@/lib/api/admin";
import { useApi } from "@/lib/admin/hooks";
import { bkkDay, daysLeft, daysUntil, fmtDate, fromBkkInput, slugify, toBkkInput, windowStatus } from "@/lib/admin/format";
import { campaignSchema, validate } from "@/lib/admin/schemas";
import { IntInput, PromoStateBadge, WindowBadge } from "../../bits";
import { Dialog, errorMessage, useConfirm, useToast } from "../../overlay";
import { useSession } from "../../session";
import { Badge, Button, Card, EmptyState, ErrorState, Field, IconButton, Input, Segmented, Select, Skeleton, Switch } from "../../ui";

const SEASONS = [
  { tag: "11-11", name: "11.11", accent: "#0071E3" },
  { tag: "12-12", name: "12.12", accent: "#D70015" },
  { tag: "new-year", name: "ปีใหม่", accent: "#9A5B00" },
  { tag: "songkran", name: "สงกรานต์", accent: "#0066CC" },
  { tag: "6-6", name: "6.6", accent: "#1D7A3A" },
  { tag: "9-9", name: "9.9", accent: "#6E3FBF" },
  { tag: "black-friday", name: "Black Friday", accent: "#1D1D1F" },
];
const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export function CampaignsTab() {
  const { can } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const camps = useApi(() => listCampaigns(), "camps");
  const promos = useApi(() => listPromotions({ per_page: 100 }), "allpromos");
  const flash = useApi(() => listFlashSales({ per_page: 100 }), "flash");
  const banners = useApi(() => listBanners(), "banners", can("banners:write"));
  const [view, setView] = useState<"timeline" | "list">("timeline");
  const [year, setYear] = useState(() => Number(bkkDay(Date.now()).slice(0, 4)));
  const [editing, setEditing] = useState<Partial<AdminCampaign> | null>(null);
  const [now] = useState(() => Date.now());
  const rows = useMemo(() => [...(camps.data?.data ?? [])].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)), [camps.data]);

  async function remove(c: AdminCampaign) {
    const n = (promos.data?.data ?? []).filter((p) => p.campaign?.id === c.id).length;
    if (!(await confirm({ title: `ลบแคมเปญ “${c.name}”?`, body: n ? `โปร/โค้ด ${n} รายการที่ผูกไว้จะไม่ถูกลบ แต่จะไม่อยู่ในแคมเปญใด` : "ลบแล้วกู้คืนไม่ได้", confirmLabel: "ลบแคมเปญ", danger: true }))) return;
    try {
      await deleteCampaign(c.id);
      toast("ลบแคมเปญแล้ว");
      camps.reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  if (camps.error) return <ErrorState message={errorMessage(camps.error)} onRetry={camps.reload} />;
  const yearStart = Date.parse(`${year}-01-01T00:00:00+07:00`);
  const yearEnd = Date.parse(`${year + 1}-01-01T00:00:00+07:00`);
  const span = yearEnd - yearStart;
  const inYear = rows.filter((c) => Date.parse(c.ends_at) > yearStart && Date.parse(c.starts_at) < yearEnd);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={view} onChange={setView} options={[{ value: "timeline", label: "ไทม์ไลน์ทั้งปี" }, { value: "list", label: "รายการ" }]} />
        {view === "timeline" ? (
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-auto" aria-label="ปี">
            {[year - 1, year, year + 1].map((y) => (
              <option key={y} value={y}>
                {y + 543} ({y})
              </option>
            ))}
          </Select>
        ) : null}
        {can("promotions:write") ? (
          <Button variant="primary" icon={Plus} className="ml-auto" onClick={() => setEditing({})}>
            สร้างแคมเปญ
          </Button>
        ) : null}
      </div>

      {view === "timeline" ? (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <div className="relative min-w-[760px] p-4">
              <div className="grid grid-cols-12 border-b border-hairline-soft pb-2 text-xs text-ink-2">
                {MONTHS.map((m) => (
                  <span key={m} className="border-l border-hairline-soft pl-1.5 first:border-l-0">
                    {m}
                  </span>
                ))}
              </div>
              <div className="relative mt-3 flex flex-col gap-2" style={{ minHeight: 80 }}>
                {!camps.data ? (
                  <Skeleton className="h-24" />
                ) : inYear.length === 0 ? (
                  <EmptyState icon={CalendarRange} title={`ยังไม่มีแคมเปญในปี ${year + 543}`} />
                ) : (
                  inYear.map((c) => {
                    const s = Math.max(Date.parse(c.starts_at), yearStart);
                    const e = Math.min(Date.parse(c.ends_at), yearEnd);
                    const left = ((s - yearStart) / span) * 100;
                    const width = Math.max(1.2, ((e - s) / span) * 100);
                    const st = windowStatus(c.starts_at, c.ends_at, now);
                    return (
                      <div key={c.id} className="relative h-9">
                        <button
                          type="button"
                          onClick={() => setEditing(c)}
                          title={`${c.name}: ${fmtDate(c.starts_at)} – ${fmtDate(c.ends_at)}`}
                          className="absolute top-0 flex h-9 items-center rounded-[8px] px-2 text-left text-xs font-medium text-white shadow-sm transition-transform hover:-translate-y-0.5"
                          style={{ left: `${left}%`, minWidth: 8, width: `${width}%`, background: c.theme.accent, opacity: st === "expired" ? 0.45 : 1 }}
                        >
                          <span className={`whitespace-nowrap ${width < 6 ? (left > 75 ? "absolute right-full mr-2 text-ink" : "absolute left-full ml-2 text-ink") : ""}`}>{c.name}</span>
                        </button>
                      </div>
                    );
                  })
                )}
                {now >= yearStart && now < yearEnd ? (
                  <div className="pointer-events-none absolute -top-3 bottom-0 w-px bg-danger" style={{ left: `${((now - yearStart) / span) * 100}%` }}>
                    <span className="absolute -top-4 -translate-x-1/2 whitespace-nowrap rounded bg-danger px-1 text-[10px] text-white">วันนี้</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {!camps.data
          ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-44 rounded-[12px]" />)
          : (view === "timeline" ? rows.filter((c) => windowStatus(c.starts_at, c.ends_at, now) !== "expired") : rows).map((c) => {
              const st = windowStatus(c.starts_at, c.ends_at, now);
              const attached = (promos.data?.data ?? []).filter((p) => p.campaign?.id === c.id);
              const fs = (flash.data?.data ?? []).filter((f) => f.campaign_id === c.id);
              return (
                <Card key={c.id} pad={false} className="overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3" style={{ background: c.theme.background, borderTop: `4px solid ${c.theme.accent}` }}>
                    <span className="rounded-[6px] px-2 py-0.5 text-xs font-bold" style={{ background: c.theme.accent, color: c.theme.accent_contrast }}>
                      {c.theme.badge_text || c.season_tag}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink">{c.name}</span>
                    <WindowBadge status={st} />
                  </div>
                  <div className="px-4 pb-3 text-[13px]">
                    <p className="text-ink-2">
                      {fmtDate(c.starts_at)} – {fmtDate(c.ends_at)} ·{" "}
                      <span className={st === "active" ? "font-medium text-success" : ""}>{st === "active" ? `เหลือ ${daysLeft(c.ends_at, now)} วัน` : st === "upcoming" ? `เริ่มในอีก ${daysUntil(c.starts_at, now)} วัน` : "จบแล้ว"}</span>
                    </p>
                    <ul className="mt-2 space-y-1">
                      {attached.map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-2">
                          <Link href={`/admin/promotions/${p.id}`} className="truncate text-ink hover:text-link">
                            {p.codes[0] ? <code className="mr-1 rounded bg-canvas-alt px-1 text-xs">{p.codes[0].code}</code> : null}
                            {p.label}
                          </Link>
                          <PromoStateBadge state={p.state} />
                        </li>
                      ))}
                      {fs.map((f) => (
                        <li key={`f${f.id}`} className="flex items-center gap-1 text-ink">
                          <Zap className="size-3.5 text-sale" aria-hidden />
                          <Link href={`/admin/flash-sales/${f.id}`} className="truncate hover:text-link">
                            {f.name} ({f.items.length} รายการ)
                          </Link>
                        </li>
                      ))}
                      {attached.length + fs.length === 0 ? <li className="text-ink-2">ยังไม่มีโปรผูกกับแคมเปญนี้</li> : null}
                    </ul>
                    {can("promotions:write") ? (
                      <div className="mt-3 flex items-center gap-1 border-t border-hairline-soft pt-2">
                        <Link href={`/admin/promotions/new?mode=code&campaign=${c.id}`} className="text-[13px] text-link hover:underline">
                          + โค้ดของแคมเปญ
                        </Link>
                        <span className="ml-auto flex">
                          <IconButton size="sm" label="แก้ไข" icon={Pencil} onClick={() => setEditing(c)} />
                          <IconButton size="sm" label="ลบ" icon={Trash2} onClick={() => remove(c)} />
                        </span>
                      </div>
                    ) : null}
                  </div>
                </Card>
              );
            })}
      </div>
      {editing ? (
        <CampaignDialog
          initial={editing}
          heroBanner={(banners.data?.data ?? []).find((b) => b.campaign_id === editing.id && b.placement === "home_hero") ?? null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            camps.reload();
            banners.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function CampaignDialog({ initial, heroBanner, onClose, onSaved }: { initial: Partial<AdminCampaign>; heroBanner: AdminBanner | null; onClose: () => void; onSaved: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const t = initial.theme;
  const [f, setF] = useState({
    name: initial.name ?? "",
    slug: initial.slug ?? "",
    season_tag: initial.season_tag ?? "",
    starts_at: toBkkInput(initial.starts_at),
    ends_at: toBkkInput(initial.ends_at),
    accent: t?.accent ?? "#0071E3",
    accent_contrast: t?.accent_contrast ?? "#FFFFFF",
    background: t?.background ?? "#FFFFFF",
    badge_text: t?.badge_text ?? "",
    hero_image_url: t?.hero_image_url ?? "",
    priority: String(initial.priority ?? 5),
    is_active: initial.is_active ?? true,
  });
  const [hero, setHero] = useState({ title: heroBanner?.title ?? "", subtitle: heroBanner?.subtitle ?? "", cta_label: heroBanner?.cta_label ?? "ช้อปเลย", link_url: heroBanner?.link_url ?? "/flash-sale" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const canWrite = can("promotions:write");

  function pickSeason(tag: string) {
    const s = SEASONS.find((x) => x.tag === tag);
    setF((x) => ({ ...x, season_tag: tag, accent: s?.accent ?? x.accent, badge_text: x.badge_text || s?.name || "", name: x.name || (s ? `${s.name} ${new Date().getFullYear()}` : x.name), slug: x.slug || (s ? `${tag}-${new Date().getFullYear()}` : x.slug) }));
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const u = await uploadFile(file);
      setF((x) => ({ ...x, hero_image_url: u.url }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setUploading(false);
    }
  }
  async function save() {
    const v = validate(campaignSchema, f);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    const body: CampaignInput = {
      name: f.name,
      slug: f.slug,
      season_tag: f.season_tag,
      starts_at: fromBkkInput(f.starts_at)!,
      ends_at: fromBkkInput(f.ends_at)!,
      priority: Number(f.priority),
      is_active: f.is_active,
      theme: { accent: f.accent.toUpperCase(), accent_contrast: f.accent_contrast.toUpperCase(), background: f.background.toUpperCase(), badge_text: f.badge_text, hero_image_url: f.hero_image_url },
    };
    setBusy(true);
    try {
      const c = initial.id ? await updateCampaign(initial.id, body) : await createCampaign(body);
      if (can("banners:write") && hero.title.trim()) {
        const b = { placement: "home_hero" as const, title: hero.title, subtitle: hero.subtitle, cta_label: hero.cta_label, link_url: hero.link_url, image_url: f.hero_image_url, image_mobile_url: "", image_alt: f.name, campaign_id: c.id, starts_at: body.starts_at, ends_at: body.ends_at, is_active: f.is_active, sort_order: 1, category_id: null };
        if (heroBanner) await updateBanner(heroBanner.id, b);
        else await createBanner(b);
      }
      toast(initial.id ? "บันทึกแคมเปญแล้ว" : "สร้างแคมเปญแล้ว");
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  const color = (k: "accent" | "accent_contrast" | "background", label: string) => (
    <Field label={label} error={errors[k]}>
      <div className="flex items-center gap-2">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(f[k]) ? f[k] : "#000000"} onChange={(e) => setF({ ...f, [k]: e.target.value.toUpperCase() })} className="h-10 w-12 shrink-0 cursor-pointer rounded-[8px] border border-hairline bg-surface p-1" aria-label={label} disabled={!canWrite} />
        <Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="font-mono uppercase" invalid={Boolean(errors[k])} />
      </div>
    </Field>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={initial.id ? `แคมเปญ ${initial.name}` : "สร้างแคมเปญ"}
      footer={
        canWrite ? (
          <>
            <Button onClick={onClose}>ยกเลิก</Button>
            <Button variant="primary" loading={busy} onClick={save}>
              บันทึก
            </Button>
          </>
        ) : undefined
      }
    >
      <fieldset disabled={!canWrite} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid content-start gap-4 sm:grid-cols-2">
          <Field label="ฤดูกาล" className="sm:col-span-2">
            <div className="flex flex-wrap gap-1.5">
              {SEASONS.map((s) => (
                <button key={s.tag} type="button" onClick={() => pickSeason(s.tag)} className={`h-8 rounded-full border px-3 text-[13px] ${f.season_tag === s.tag ? "border-accent bg-accent-soft text-link" : "border-hairline-soft text-ink hover:border-hairline"}`}>
                  {s.name}
                </button>
              ))}
            </div>
          </Field>
          <Field label="ชื่อแคมเปญ" required error={errors.name}>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={Boolean(errors.name)} />
          </Field>
          <Field label="Slug" required error={errors.slug}>
            <Input value={f.slug} onChange={(e) => setF({ ...f, slug: slugify(e.target.value).replace(/[ก-๙]/g, "") })} invalid={Boolean(errors.slug)} className="font-mono" />
          </Field>
          <Field label="เริ่ม (เวลาไทย)" required error={errors.starts_at}>
            <Input type="datetime-local" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} invalid={Boolean(errors.starts_at)} />
          </Field>
          <Field label="สิ้นสุด (เวลาไทย)" required error={errors.ends_at}>
            <Input type="datetime-local" value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} invalid={Boolean(errors.ends_at)} />
          </Field>
          {color("accent", "สีหลัก")}
          {color("accent_contrast", "สีตัวอักษรบนสีหลัก")}
          {color("background", "สีพื้นหลัง")}
          <Field label="ป้าย (badge)">
            <Input value={f.badge_text} onChange={(e) => setF({ ...f, badge_text: e.target.value })} placeholder="11.11" />
          </Field>
          <Field label="ลำดับความสำคัญ" hint="ถ้ามีหลายแคมเปญพร้อมกัน หน้าร้านใช้ค่ามากสุด">
            <IntInput value={f.priority} onChange={(v) => setF({ ...f, priority: v })} />
          </Field>
          <div className="flex items-end pb-2">
            <Switch checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="เปิดใช้งาน" />
          </div>
          <div className="sm:col-span-2">
            <p className="mb-2 text-[13px] font-medium text-ink">ข้อความแบนเนอร์หลัก (hero)</p>
            {can("banners:write") ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input value={hero.title} onChange={(e) => setHero({ ...hero, title: e.target.value })} placeholder="หัวข้อ เช่น 11.11 ลดสูงสุด 50%" aria-label="หัวข้อ" />
                <Input value={hero.subtitle} onChange={(e) => setHero({ ...hero, subtitle: e.target.value })} placeholder="คำโปรย" aria-label="คำโปรย" />
                <Input value={hero.cta_label} onChange={(e) => setHero({ ...hero, cta_label: e.target.value })} placeholder="ปุ่ม" aria-label="ข้อความปุ่ม" />
                <Input value={hero.link_url} onChange={(e) => setHero({ ...hero, link_url: e.target.value })} placeholder="/flash-sale" aria-label="ลิงก์ปุ่ม" />
              </div>
            ) : (
              <p className="text-xs text-ink-2">ต้องมีสิทธิ์จัดการแบนเนอร์</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-[13px] font-medium text-ink">ตัวอย่างหน้าแรก</p>
          <div className="overflow-hidden rounded-[16px] border border-hairline-soft" style={{ background: f.background }}>
            <div className="relative aspect-[16/10] bg-canvas-alt">
              {f.hero_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.hero_image_url} alt="" className="absolute inset-0 size-full object-cover" />
              ) : null}
              <div className="absolute inset-0 flex flex-col items-center justify-end bg-gradient-to-t from-black/40 to-transparent p-4 text-center text-white">
                {f.badge_text ? (
                  <span className="mb-2 rounded-[6px] px-2 py-0.5 text-xs font-bold" style={{ background: f.accent, color: f.accent_contrast }}>
                    {f.badge_text}
                  </span>
                ) : null}
                <p className="text-lg font-semibold leading-tight">{hero.title || f.name || "หัวข้อแคมเปญ"}</p>
                <p className="text-xs opacity-90">{hero.subtitle}</p>
                <span className="mt-2 rounded-full px-4 py-1.5 text-xs font-medium" style={{ background: f.accent, color: f.accent_contrast }}>
                  {hero.cta_label || "ช้อปเลย"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button icon={ImagePlus} loading={uploading} onClick={() => fileRef.current?.click()}>
              อัปโหลดรูป hero
            </Button>
            <Input value={f.hero_image_url} onChange={(e) => setF({ ...f, hero_image_url: e.target.value })} placeholder="/mock/hero-1111.svg" aria-label="URL รูป" />
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
          <p className="text-xs text-ink-2">
            <Badge tone="blue">ทิป</Badge> โค้ดตามฤดูกาล = โค้ดส่วนลดที่มีช่วงเวลาและผูกกับแคมเปญนี้ สร้างได้จากการ์ดแคมเปญ “+ โค้ดของแคมเปญ”
          </p>
        </div>
      </fieldset>
    </Dialog>
  );
}
