"use client";

import { Crown, Layers, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { formatBaht, formatBp, parseBahtToSatang } from "@/lib/money";
import {
  createCustomerGroup,
  createPromotion,
  deleteCustomerGroup,
  listCustomerGroups,
  listPromotions,
  listUsers,
  updateCustomerGroup,
  updatePromotion,
  updateUser,
  type CustomerGroup,
} from "@/lib/api/admin";
import type { AdminPromotion, Tier } from "@/lib/api/types";
import { useApi, useDebounced } from "@/lib/admin/hooks";
import { bpToInput, parsePercentToBp, satangToInput, TIER_LABEL } from "@/lib/admin/format";
import { groupSchema, validate } from "@/lib/admin/schemas";
import { IntInput, MoneyInput, PercentInput, PromoStateBadge } from "../../bits";
import { Dialog, errorMessage, useConfirm, useToast } from "../../overlay";
import { useSession } from "../../session";
import { Badge, Button, Card, EmptyState, ErrorState, Field, IconButton, Input, LinkButton, Pagination, Segmented, Select, Table, TableSkeleton, Td, Textarea, Th } from "../../ui";
import { TargetsText } from "./shared";

export function TradeTab() {
  const { can } = useSession();
  const promos = useApi(() => listPromotions({ layer: 1, per_page: 100 }), "l1");
  const groups = useApi(listCustomerGroups, "groups", can("customers:read"));
  const all = promos.data?.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      {can("customers:read") ? <GroupsCard groups={groups} promos={all} /> : null}
      <QtyBreaksCard promos={all.filter((p) => p.kind === "quantity_break")} loading={!promos.data} reload={promos.reload} groups={groups.data?.data ?? []} />
      <TiersCard promos={all.filter((p) => p.kind === "tier_price")} loading={!promos.data} reload={promos.reload} />
      {can("customers:read") ? <AssignCard groups={groups.data?.data ?? []} /> : null}
    </div>
  );
}

function GroupsCard({ groups, promos }: { groups: { data?: { data: CustomerGroup[] }; error?: unknown; reload: () => void }; promos: AdminPromotion[] }) {
  const { can } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Partial<CustomerGroup> | null>(null);
  const canWrite = can("customers:write");
  async function remove(g: CustomerGroup) {
    if (!(await confirm({ title: `ลบกลุ่ม “${g.name}”?`, body: `สมาชิก ${g.member_count} คนจะไม่อยู่ในกลุ่มใด และหมดสิทธิ์ราคากลุ่มทันที`, confirmLabel: "ลบกลุ่ม", danger: true }))) return;
    try {
      await deleteCustomerGroup(g.id);
      toast("ลบกลุ่มแล้ว");
      groups.reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  return (
    <Card
      pad={false}
      title={<span className="flex items-center gap-2"><Users className="size-4 text-ink-2" aria-hidden />กลุ่มลูกค้า (ราคาส่ง/องค์กร)</span>}
      actions={canWrite ? <Button size="sm" variant="outline" icon={Plus} onClick={() => setEditing({})}>เพิ่มกลุ่ม</Button> : null}
    >
      {groups.error ? (
        <ErrorState message={errorMessage(groups.error)} onRetry={groups.reload} />
      ) : !groups.data ? (
        <TableSkeleton rows={3} cols={4} />
      ) : groups.data.data.length === 0 ? (
        <EmptyState icon={Users} title="ยังไม่มีกลุ่มลูกค้า" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>กลุ่ม</Th>
              <Th>ส่วนลดของกลุ่ม</Th>
              <Th align="right">สมาชิก</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {groups.data.data.map((g) => {
              const gp = promos.filter((p) => p.customer_group_ids.includes(g.id));
              return (
                <tr key={g.id}>
                  <Td>
                    <span className="font-medium text-ink">{g.name}</span> <code className="text-xs text-ink-2">{g.code}</code>
                    <span className="block text-xs text-ink-2">{g.description}</span>
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {gp.length === 0 ? <span className="text-xs text-ink-2">—</span> : null}
                      {gp.map((p) => (
                        <Link key={p.id} href={`/admin/promotions/${p.id}`}>
                          <Badge tone={p.kind === "group_price" ? "purple" : "blue"}>
                            {p.kind === "group_price" ? `ลด ${formatBp(p.percent_bp ?? 0)}` : p.label}
                          </Badge>
                        </Link>
                      ))}
                      {can("promotions:write") && !gp.some((p) => p.kind === "group_price") ? (
                        <Link href={`/admin/promotions/new?kind=group_price&group=${g.id}`} className="text-xs text-link hover:underline">
                          + ตั้ง % ส่วนลด
                        </Link>
                      ) : null}
                    </span>
                  </Td>
                  <Td align="right">
                    <Link href={`/admin/customers?group_id=${g.id}`} className="text-link hover:underline">
                      {g.member_count}
                    </Link>
                  </Td>
                  <Td align="right">
                    {canWrite ? (
                      <span className="flex justify-end">
                        <IconButton size="sm" label="แก้ไข" icon={Pencil} onClick={() => setEditing(g)} />
                        <IconButton size="sm" label="ลบ" icon={Trash2} onClick={() => remove(g)} />
                      </span>
                    ) : null}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {editing ? <GroupDialog initial={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), groups.reload())} /> : null}
    </Card>
  );
}

function GroupDialog({ initial, onClose, onSaved }: { initial: Partial<CustomerGroup>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ code: initial.code ?? "", name: initial.name ?? "", description: initial.description ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function save() {
    const v = validate(groupSchema, f);
    if (!v.ok) return setErrors(v.errors);
    setBusy(true);
    try {
      if (initial.id) await updateCustomerGroup(initial.id, f);
      else await createCustomerGroup(f);
      toast("บันทึกกลุ่มแล้ว");
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title={initial.id ? "แก้ไขกลุ่มลูกค้า" : "เพิ่มกลุ่มลูกค้า"} size="sm" footer={<><Button onClick={onClose}>ยกเลิก</Button><Button variant="primary" loading={busy} onClick={save}>บันทึก</Button></>}>
      <div className="grid gap-4">
        <Field label="ชื่อกลุ่ม" required error={errors.name}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={Boolean(errors.name)} placeholder="เช่น ลูกค้าขายส่ง" />
        </Field>
        <Field label="รหัส" required error={errors.code} hint="ใช้อ้างอิงภายใน เช่น wholesale">
          <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} invalid={Boolean(errors.code)} className="font-mono" />
        </Field>
        <Field label="คำอธิบาย">
          <Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}

type TierRow = { min_qty: string; mode: "price" | "percent"; value: string };
function QtyBreaksCard({ promos, loading, reload, groups }: { promos: AdminPromotion[]; loading: boolean; reload: () => void; groups: CustomerGroup[] }) {
  const { can } = useSession();
  return (
    <Card
      pad={false}
      title={<span className="flex items-center gap-2"><Layers className="size-4 text-ink-2" aria-hidden />ราคาตามจำนวน (5+ / 10+ / 50+)</span>}
      actions={can("promotions:write") ? <LinkButton size="sm" variant="outline" icon={Plus} href="/admin/promotions/new?kind=quantity_break">เพิ่มขั้นราคา</LinkButton> : null}
    >
      {loading ? (
        <TableSkeleton rows={2} cols={3} />
      ) : promos.length === 0 ? (
        <EmptyState icon={Layers} title="ยังไม่มีราคาตามจำนวน" body="ตั้งราคาต่อชิ้นที่ถูกลงเมื่อซื้อมาก ต่อสินค้าหรือหมวด" />
      ) : (
        <div className="grid gap-px bg-hairline-soft md:grid-cols-2">
          {promos.map((p) => (
            <QtyBreakEditor key={`${p.id}-${p.updated_at}`} promo={p} reload={reload} groups={groups} />
          ))}
        </div>
      )}
    </Card>
  );
}

function QtyBreakEditor({ promo, reload, groups }: { promo: AdminPromotion; reload: () => void; groups: CustomerGroup[] }) {
  const { can } = useSession();
  const toast = useToast();
  const [rows, setRows] = useState<TierRow[]>(() =>
    promo.qty_tiers.map((t) => (t.unit_price_satang !== null ? { min_qty: String(t.min_qty), mode: "price", value: satangToInput(t.unit_price_satang) } : { min_qty: String(t.min_qty), mode: "percent", value: bpToInput(t.percent_bp) })),
  );
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(rows) !== JSON.stringify(promo.qty_tiers.map((t) => (t.unit_price_satang !== null ? { min_qty: String(t.min_qty), mode: "price", value: satangToInput(t.unit_price_satang) } : { min_qty: String(t.min_qty), mode: "percent", value: bpToInput(t.percent_bp) })));
  async function save() {
    const errs: Record<number, string> = {};
    const out = rows.map((r, i) => {
      const q = Number(r.min_qty);
      if (!/^\d+$/.test(r.min_qty) || q < 2) errs[i] = "จำนวนขั้นต่ำต้อง ≥ 2";
      const price = r.mode === "price" ? parseBahtToSatang(r.value) : null;
      const bp = r.mode === "percent" ? parsePercentToBp(r.value) : null;
      if (r.mode === "price" && (price === null || price <= 0)) errs[i] = "กรอกราคาต่อชิ้น";
      if (r.mode === "percent" && (bp === null || bp <= 0)) errs[i] = "กรอก % ส่วนลด";
      return { min_qty: q, unit_price_satang: price, percent_bp: bp };
    });
    const qs = out.map((o) => o.min_qty);
    if (new Set(qs).size !== qs.length) errs[0] = "จำนวนขั้นต่ำซ้ำกัน";
    if (Object.keys(errs).length) return setErrors(errs);
    setErrors({});
    setBusy(true);
    try {
      await updatePromotion(promo.id, { qty_tiers: out.sort((a, b) => a.min_qty - b.min_qty) });
      toast("บันทึกขั้นราคาแล้ว");
      reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  const canWrite = can("promotions:write");
  return (
    <div className="bg-surface p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/admin/promotions/${promo.id}`} className="font-medium text-ink hover:text-link">
            {promo.name}
          </Link>
          <div className="flex flex-wrap items-center gap-1">
            <TargetsText p={promo} />
            {promo.customer_group_ids.map((g) => (
              <Badge key={g} tone="purple">{groups.find((x) => x.id === g)?.name ?? `กลุ่ม #${g}`}</Badge>
            ))}
          </div>
        </div>
        <PromoStateBadge state={promo.state} />
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-2">
            <th className="py-1 font-medium">ซื้อตั้งแต่ (ชิ้น)</th>
            <th className="py-1 font-medium">แบบ</th>
            <th className="py-1 font-medium">ราคา/ส่วนลด</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const set = (patch: Partial<TierRow>) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <tr key={i}>
                <td className="py-1 pr-2">
                  <IntInput value={r.min_qty} onChange={(v) => set({ min_qty: v })} disabled={!canWrite} className="w-20" aria-label="จำนวนขั้นต่ำ" invalid={Boolean(errors[i])} />
                </td>
                <td className="py-1 pr-2">
                  <Select value={r.mode} onChange={(e) => set({ mode: e.target.value as TierRow["mode"], value: "" })} disabled={!canWrite} className="w-28" aria-label="ประเภท">
                    <option value="price">฿/ชิ้น</option>
                    <option value="percent">ลด %</option>
                  </Select>
                </td>
                <td className="py-1 pr-2">
                  {r.mode === "price" ? <MoneyInput value={r.value} onChange={(v) => set({ value: v })} disabled={!canWrite} aria-label="ราคาต่อชิ้น" invalid={Boolean(errors[i])} /> : <PercentInput value={r.value} onChange={(v) => set({ value: v })} disabled={!canWrite} aria-label="ส่วนลด" invalid={Boolean(errors[i])} />}
                </td>
                <td className="w-8">{canWrite ? <IconButton size="sm" label="ลบขั้น" icon={Trash2} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} /> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {Object.values(errors)[0] ? <p className="mt-1 text-xs text-danger">{Object.values(errors)[0]}</p> : null}
      {canWrite ? (
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setRows((rs) => [...rs, { min_qty: String((Number(rs[rs.length - 1]?.min_qty) || 0) ? Number(rs[rs.length - 1].min_qty) * 2 : 5), mode: rs[rs.length - 1]?.mode ?? "price", value: "" }])}>
            เพิ่มขั้น
          </Button>
          {dirty ? (
            <Button size="sm" variant="primary" loading={busy} onClick={save} className="ml-auto">
              บันทึก
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const TIERS: Exclude<Tier, "standard">[] = ["silver", "gold", "platinum"];
const TIER_COLOR = { silver: "#8E8E93", gold: "#B8860B", platinum: "#5E5CE6" };
function TiersCard({ promos, loading, reload }: { promos: AdminPromotion[]; loading: boolean; reload: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  async function save(tier: Exclude<Tier, "standard">) {
    const bp = parsePercentToBp(draft[tier] ?? "");
    if (bp === null || bp <= 0) return toast("กรอก % ส่วนลด 0–100", "error");
    const existing = promos.find((p) => p.tiers.length === 1 && p.tiers[0] === tier && p.targets.length === 0);
    setBusy(tier);
    try {
      if (existing) await updatePromotion(existing.id, { percent_bp: bp });
      else
        await createPromotion({
          name: `${TIER_LABEL[tier]} ลด ${formatBp(bp)}`,
          label: `สมาชิก ${TIER_LABEL[tier]} ลด ${formatBp(bp)}`,
          kind: "tier_price",
          status: "active",
          auto_apply: true,
          percent_bp: bp,
          tiers: [tier],
          starts_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
          ends_at: null,
          priority: 0,
        });
      toast(`ตั้งส่วนลด ${TIER_LABEL[tier]} แล้ว`);
      setDraft((d) => ({ ...d, [tier]: "" }));
      reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card title={<span className="flex items-center gap-2"><Crown className="size-4 text-ink-2" aria-hidden />ระดับสมาชิก</span>} actions={<span className="text-xs text-ink-2">ใช้ราคาที่ดีที่สุดเพียงแบบเดียว ไม่ซ้อนกับราคาส่ง/Flash</span>}>
      {loading ? (
        <TableSkeleton rows={1} cols={3} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {TIERS.map((t) => {
            const ps = promos.filter((p) => p.tiers.includes(t));
            return (
              <div key={t} className="rounded-[12px] border border-hairline-soft p-4">
                <div className="flex items-center gap-2">
                  <span className="size-3 rounded-full" style={{ background: TIER_COLOR[t] }} aria-hidden />
                  <span className="font-semibold text-ink">{TIER_LABEL[t]}</span>
                </div>
                <ul className="mt-2 space-y-1 text-[13px]">
                  {ps.length === 0 ? <li className="text-ink-2">ยังไม่มีส่วนลด</li> : null}
                  {ps.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2">
                      <Link href={`/admin/promotions/${p.id}`} className="truncate text-ink hover:text-link">
                        ลด {formatBp(p.percent_bp ?? 0)} · <TargetsText p={p} />
                      </Link>
                      <PromoStateBadge state={p.state} />
                    </li>
                  ))}
                </ul>
                {can("promotions:write") ? (
                  <div className="mt-3 flex gap-2">
                    <PercentInput value={draft[t] ?? ""} onChange={(v) => setDraft((d) => ({ ...d, [t]: v }))} placeholder="% ทั้งร้าน" aria-label={`ส่วนลด ${TIER_LABEL[t]}`} />
                    <Button size="md" variant="outline" loading={busy === t} onClick={() => save(t)}>
                      ตั้ง
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function AssignCard({ groups }: { groups: CustomerGroup[] }) {
  const { can } = useSession();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "grouped">("all");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const query = { role: "customer", q: dq || undefined, page, per_page: 10 };
  const res = useApi(() => listUsers(query), JSON.stringify(query));
  const canWrite = can("customers:write");
  async function patch(id: number, body: { group_id?: number | null; tier?: Tier }) {
    try {
      const u = await updateUser(id, body);
      res.mutate((d) => (d ? { ...d, data: d.data.map((x) => (x.id === id ? u : x)) } : d!));
      toast(`อัปเดต ${u.name} แล้ว`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  const rows = (res.data?.data ?? []).filter((u) => filter === "all" || u.group || u.tier !== "standard");
  return (
    <Card pad={false} title="กำหนดกลุ่ม/ระดับให้ลูกค้า">
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline-soft p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-2" aria-hidden />
          <Input type="search" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} placeholder="ค้นหาชื่อ อีเมล เบอร์โทร" className="pl-9" aria-label="ค้นหาลูกค้า" />
        </div>
        <Segmented value={filter} onChange={setFilter} options={[{ value: "all", label: "ทั้งหมด" }, { value: "grouped", label: "มีกลุ่ม/ระดับ" }]} />
      </div>
      {!res.data ? (
        <TableSkeleton rows={5} cols={3} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Users} title="ไม่พบลูกค้า" />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>ลูกค้า</Th>
                <Th>กลุ่ม</Th>
                <Th>ระดับสมาชิก</Th>
                <Th align="right">ยอดซื้อรวม</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <Td>
                    <Link href={`/admin/customers/${u.id}`} className="font-medium text-ink hover:text-link">
                      {u.name}
                    </Link>
                    <span className="block text-xs text-ink-2">{u.email}</span>
                  </Td>
                  <Td>
                    <Select value={u.group?.id ?? ""} disabled={!canWrite} onChange={(e) => patch(u.id, { group_id: e.target.value ? Number(e.target.value) : null })} className="min-w-[150px]" aria-label="กลุ่ม">
                      <option value="">— ไม่มีกลุ่ม —</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <Select value={u.tier} disabled={!canWrite} onChange={(e) => patch(u.id, { tier: e.target.value as Tier })} className="min-w-[120px]" aria-label="ระดับ">
                      {(["standard", "silver", "gold", "platinum"] as Tier[]).map((t) => (
                        <option key={t} value={t}>
                          {TIER_LABEL[t]}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td align="right">{formatBaht(u.total_spent_satang, { decimals: "never" })}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={res.data.meta.page} totalPages={res.data.meta.total_pages} total={res.data.meta.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}
