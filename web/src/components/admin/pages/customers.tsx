"use client";

import { Search, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { formatBaht } from "@/lib/money";
import { getUser, listCustomerGroups, listUsers, updateUser, type AdminUser } from "@/lib/api/admin";
import type { Role, Tier } from "@/lib/api/types";
import { useApi, useUrlState } from "@/lib/admin/hooks";
import { fmtDate, fmtDateTime, ROLE_LABEL, TIER_LABEL } from "@/lib/admin/format";
import { OrderStatusBadge } from "../bits";
import { errorMessage, useConfirm, useToast } from "../overlay";
import { useSession } from "../session";
import { Badge, Card, EmptyState, ErrorState, Field, Input, PageFallback, PageHeader, Pagination, Select, Switch, Table, TableSkeleton, Td, Th } from "../ui";

export function CustomersPage({ staff = false }: { staff?: boolean }) {
  const { can } = useSession();
  const { values, set, page } = useUrlState(["q", "tier", "group_id"] as const);
  const [q, setQ] = useState(values.q);
  const query = { role: staff ? "staff,admin,owner" : "customer", q: values.q || undefined, tier: values.tier || undefined, group_id: values.group_id ? Number(values.group_id) : undefined, page, per_page: 20 };
  const res = useApi(() => listUsers(query), JSON.stringify(query));
  const groups = useApi(listCustomerGroups, "groups", !staff);
  const rows = res.data?.data ?? [];
  return (
    <div>
      <PageHeader
        title={staff ? "ผู้ใช้หลังร้าน" : "ลูกค้า"}
        subtitle={staff ? (can("staff:manage") ? "เจ้าของร้านเปลี่ยนบทบาทได้ที่หน้ารายละเอียดของแต่ละคน" : "เฉพาะเจ้าของร้านเปลี่ยนบทบาทได้") : res.data ? `${res.data.meta.total.toLocaleString("th-TH")} คน` : " "}
      />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline-soft p-3">
          <form className="relative min-w-[200px] flex-1" onSubmit={(e) => (e.preventDefault(), set({ q }))}>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-2" aria-hidden />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => q !== values.q && set({ q })} placeholder="ชื่อ อีเมล เบอร์โทร" className="pl-9" aria-label="ค้นหา" />
          </form>
          {!staff ? (
            <>
              <Select value={values.tier} onChange={(e) => set({ tier: e.target.value })} className="w-auto min-w-[120px]" aria-label="ระดับ">
                <option value="">ทุกระดับ</option>
                {(["standard", "silver", "gold", "platinum"] as Tier[]).map((t) => (
                  <option key={t} value={t}>
                    {TIER_LABEL[t]}
                  </option>
                ))}
              </Select>
              <Select value={values.group_id} onChange={(e) => set({ group_id: e.target.value })} className="w-auto min-w-[140px]" aria-label="กลุ่ม">
                <option value="">ทุกกลุ่ม</option>
                {(groups.data?.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </>
          ) : null}
        </div>
        {res.error ? (
          <ErrorState message={errorMessage(res.error)} onRetry={res.reload} />
        ) : !res.data ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState icon={staff ? ShieldCheck : Users} title="ไม่พบผู้ใช้" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>ชื่อ</Th>
                  {staff ? <Th>บทบาท</Th> : <Th>กลุ่ม / ระดับ</Th>}
                  {staff ? null : <Th align="right">คำสั่งซื้อ</Th>}
                  {staff ? null : <Th align="right">ยอดซื้อรวม</Th>}
                  <Th>เข้าใช้ล่าสุด</Th>
                  <Th>สถานะ</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="hover:bg-surface-2">
                    <Td>
                      <Link href={`/admin/customers/${u.id}`} className="font-medium text-ink hover:text-link">
                        {u.name || "—"}
                      </Link>
                      <span className="block text-xs text-ink-2">{u.email}</span>
                    </Td>
                    {staff ? (
                      <Td>
                        <Badge tone={u.role === "owner" ? "purple" : u.role === "admin" ? "blue" : "neutral"}>{ROLE_LABEL[u.role]}</Badge>
                      </Td>
                    ) : (
                      <Td>
                        <span className="flex flex-wrap gap-1">
                          {u.group ? <Badge tone="purple">{u.group.name}</Badge> : null}
                          {u.tier !== "standard" ? <Badge tone="orange">{TIER_LABEL[u.tier]}</Badge> : null}
                          {!u.group && u.tier === "standard" ? <span className="text-xs text-ink-2">—</span> : null}
                        </span>
                      </Td>
                    )}
                    {staff ? null : <Td align="right">{u.order_count}</Td>}
                    {staff ? null : <Td align="right">{formatBaht(u.total_spent_satang, { decimals: "never" })}</Td>}
                    <Td className="whitespace-nowrap text-ink-2">{fmtDateTime(u.last_login_at)}</Td>
                    <Td>{u.is_active ? <Badge tone="green">ใช้งาน</Badge> : <Badge tone="red">ระงับ</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={res.data.meta.page} totalPages={res.data.meta.total_pages} total={res.data.meta.total} onPage={(p) => set({ page: p }, false)} />
          </>
        )}
      </Card>
    </div>
  );
}

export function StaffPage() {
  return <CustomersPage staff />;
}

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, me } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const res = useApi(() => getUser(Number(id)), `u${id}`);
  const groups = useApi(listCustomerGroups, "groups", can("customers:read"));
  if (res.error) return <ErrorState message={errorMessage(res.error)} onRetry={res.reload} />;
  const u = res.data;
  if (!u) return <PageFallback />;
  const canWrite = can("customers:write");
  const isStaff = u.role !== "customer";

  async function patch(body: Partial<Pick<AdminUser, "tier" | "is_active" | "role">> & { group_id?: number | null }, msg: string) {
    try {
      const next = await updateUser(u!.id, body);
      res.mutate({ ...u!, ...next });
      toast(msg);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  async function changeRole(role: Role) {
    if (role === u!.role) return;
    const ok = await confirm({
      title: `เปลี่ยนบทบาทของ ${u!.name} เป็น “${ROLE_LABEL[role]}”?`,
      body: role === "customer" ? "ผู้ใช้จะเข้าหลังร้านไม่ได้อีก" : role === "owner" ? "เจ้าของร้านมีสิทธิ์ทุกอย่าง รวมถึงจัดการบทบาทของคนอื่น" : "สิทธิ์จะเปลี่ยนทันทีในการใช้งานครั้งถัดไป",
      confirmLabel: "เปลี่ยนบทบาท",
      danger: role === "owner" || u!.role === "owner",
    });
    if (ok) patch({ role }, "เปลี่ยนบทบาทแล้ว");
  }
  async function toggleActive(v: boolean) {
    if (!v && !(await confirm({ title: `ระงับบัญชี ${u!.name}?`, body: "ผู้ใช้จะเข้าสู่ระบบไม่ได้จนกว่าจะเปิดใหม่", confirmLabel: "ระงับบัญชี", danger: true }))) return;
    patch({ is_active: v }, v ? "เปิดใช้บัญชีแล้ว" : "ระงับบัญชีแล้ว");
  }

  return (
    <div>
      <PageHeader back={isStaff ? { href: "/admin/staff", label: "ผู้ใช้หลังร้าน" } : { href: "/admin/customers", label: "ลูกค้า" }} title={u.name || u.email} subtitle={`${u.email}${u.phone ? ` · ${u.phone}` : ""} · สมัคร ${fmtDate(u.created_at)}`} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card>
              <p className="text-xs text-ink-2">คำสั่งซื้อ</p>
              <p className="text-2xl font-semibold tabular-nums">{u.order_count}</p>
            </Card>
            <Card>
              <p className="text-xs text-ink-2">ยอดซื้อรวม</p>
              <p className="text-2xl font-semibold tabular-nums">{formatBaht(u.total_spent_satang, { decimals: "never" })}</p>
            </Card>
            <Card className="col-span-2 sm:col-span-1">
              <p className="text-xs text-ink-2">เข้าใช้ล่าสุด</p>
              <p className="text-base font-medium">{fmtDateTime(u.last_login_at)}</p>
            </Card>
          </div>
          <Card title="คำสั่งซื้อล่าสุด" pad={false}>
            {u.recent_orders.length === 0 ? (
              <EmptyState title="ยังไม่มีคำสั่งซื้อ" />
            ) : (
              <ul className="divide-y divide-hairline-soft">
                {u.recent_orders.map((o) => (
                  <li key={o.order_no}>
                    <Link href={`/admin/orders/${o.order_no}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2">
                      <span className="w-32 font-medium tabular-nums">{o.order_no}</span>
                      <span className="hidden flex-1 text-ink-2 sm:block">{fmtDateTime(o.created_at)}</span>
                      <OrderStatusBadge status={o.status} />
                      <span className="ml-auto w-24 text-right tabular-nums">{formatBaht(o.grand_total_satang)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="ที่อยู่">
            {u.addresses.length === 0 ? (
              <p className="text-sm text-ink-2">ยังไม่มีที่อยู่</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {u.addresses.map((a) => (
                  <li key={a.id} className="rounded-[10px] border border-hairline-soft p-3 text-sm">
                    <p className="font-medium">
                      {a.label} {a.is_default ? <Badge tone="blue">ค่าเริ่มต้น</Badge> : null}
                    </p>
                    <p className="text-ink-2">
                      {a.recipient_name} · {a.phone}
                      <br />
                      {a.line1} {a.subdistrict} {a.district} {a.province} {a.postal_code}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title="สิทธิ์และราคา">
            <fieldset disabled={!canWrite} className="flex flex-col gap-4">
              <Field label="กลุ่มลูกค้า" hint="ได้ราคากลุ่ม/ราคาส่งตามโปรของกลุ่ม">
                <Select value={u.group?.id ?? ""} onChange={(e) => patch({ group_id: e.target.value ? Number(e.target.value) : null }, "อัปเดตกลุ่มแล้ว")}>
                  <option value="">— ไม่มีกลุ่ม —</option>
                  {(groups.data?.data ?? []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="ระดับสมาชิก">
                <Select value={u.tier} onChange={(e) => patch({ tier: e.target.value as Tier }, "อัปเดตระดับแล้ว")}>
                  {(["standard", "silver", "gold", "platinum"] as Tier[]).map((t) => (
                    <option key={t} value={t}>
                      {TIER_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Switch checked={u.is_active} onChange={toggleActive} label="บัญชีใช้งานได้" disabled={u.id === me.id} />
            </fieldset>
          </Card>
          {can("staff:manage") ? (
            <Card title="บทบาท (เฉพาะเจ้าของร้าน)">
              <Select value={u.role} onChange={(e) => changeRole(e.target.value as Role)} disabled={u.id === me.id} aria-label="บทบาท">
                {(["customer", "staff", "admin", "owner"] as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
              <ul className="mt-3 space-y-1 text-xs text-ink-2">
                <li>พนักงาน: แพ็คของ จัดส่ง ปรับสต็อก ดูโปร</li>
                <li>แอดมิน: + แก้สินค้า โปร ลูกค้า แบนเนอร์ รีวิว ยกเลิก/คืนเงิน</li>
                <li>เจ้าของร้าน: + จัดการบทบาท</li>
              </ul>
              {u.id === me.id ? <p className="mt-2 text-xs text-warning">เปลี่ยนบทบาทของตัวเองไม่ได้</p> : null}
            </Card>
          ) : (
            <Card>
              <p className="text-sm">
                บทบาท: <Badge>{ROLE_LABEL[u.role]}</Badge>
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
