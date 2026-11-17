"use client";

import { ChevronDown, ChevronUp, FolderTree, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { createCategory, deleteCategory, listCategories, updateCategory, type AdminCategory, type CategoryInput } from "@/lib/api/admin";
import { useApi } from "@/lib/admin/hooks";
import { slugify } from "@/lib/admin/format";
import { categorySchema, validate } from "@/lib/admin/schemas";
import { errorMessage, useConfirm, useToast, Dialog } from "../overlay";
import { useSession } from "../session";
import { Badge, Button, Card, EmptyState, ErrorState, Field, IconButton, Input, PageHeader, Select, Switch, TableSkeleton, Textarea } from "../ui";

export function CategoriesPage() {
  const { can } = useSession();
  const canWrite = can("catalog:write");
  const toast = useToast();
  const confirm = useConfirm();
  const res = useApi(listCategories, "cats");
  const [editing, setEditing] = useState<Partial<AdminCategory> | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const all = res.data?.data ?? [];
  const sorted = (pid: number | null) => all.filter((c) => c.parent_id === pid).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

  async function reorder(pid: number | null, fromId: number, toIndex: number) {
    const sibs = sorted(pid);
    const from = sibs.findIndex((c) => c.id === fromId);
    if (from < 0 || toIndex < 0 || toIndex >= sibs.length || from === toIndex) return;
    const next = [...sibs];
    const [x] = next.splice(from, 1);
    next.splice(toIndex, 0, x);
    const changed = next.map((c, i) => ({ c, order: i + 1 })).filter(({ c, order }) => c.sort_order !== order);
    res.mutate((d) => (d ? { ...d, data: d.data.map((c) => ({ ...c, sort_order: changed.find((x) => x.c.id === c.id)?.order ?? c.sort_order })) } : d!));
    try {
      await Promise.all(changed.map(({ c, order }) => updateCategory(c.id, { sort_order: order })));
      toast("บันทึกลำดับแล้ว");
    } catch (e) {
      toast(errorMessage(e), "error");
      res.reload();
    }
  }
  async function remove(c: AdminCategory) {
    const ok = await confirm({ title: `ลบหมวด “${c.name}”?`, body: "ลบได้เฉพาะหมวดที่ไม่มีสินค้าและไม่มีหมวดย่อย", confirmLabel: "ลบ", danger: true });
    if (!ok) return;
    try {
      await deleteCategory(c.id);
      toast("ลบหมวดแล้ว");
      res.reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const row = (c: AdminCategory, level: 0 | 1, index: number, count: number) => (
    <div
      key={c.id}
      draggable={canWrite}
      onDragStart={() => setDrag(c.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => {
        if (drag !== null && all.find((x) => x.id === drag)?.parent_id === c.parent_id) reorder(c.parent_id, drag, index);
        setDrag(null);
      }}
      className={`flex items-center gap-2 border-b border-hairline-soft py-2 pr-3 ${level ? "pl-10" : "pl-3"} ${drag === c.id ? "opacity-40" : ""} hover:bg-surface-2`}
    >
      {canWrite ? <GripVertical className="size-4 shrink-0 cursor-grab text-ink-3" aria-hidden /> : null}
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${level ? "text-ink" : "font-medium text-ink"}`}>{c.name}</span>
        <span className="text-xs text-ink-2">/c/{c.slug}</span>
      </span>
      {!c.is_active ? <Badge>ซ่อน</Badge> : null}
      <span className="hidden w-20 text-right text-xs text-ink-2 sm:block">{c.product_count ?? 0} สินค้า</span>
      {canWrite ? (
        <span className="flex items-center">
          <IconButton size="sm" label="เลื่อนขึ้น" icon={ChevronUp} disabled={index === 0} onClick={() => reorder(c.parent_id, c.id, index - 1)} />
          <IconButton size="sm" label="เลื่อนลง" icon={ChevronDown} disabled={index === count - 1} onClick={() => reorder(c.parent_id, c.id, index + 1)} />
          <IconButton size="sm" label="แก้ไข" icon={Pencil} onClick={() => setEditing(c)} />
          <IconButton size="sm" label="ลบ" icon={Trash2} onClick={() => remove(c)} />
        </span>
      ) : null}
    </div>
  );

  const parents = sorted(null);
  return (
    <div>
      <PageHeader
        title="หมวดหมู่"
        subtitle="จัดได้ 2 ชั้น (หมวดหลัก › หมวดย่อย) · ลากหรือกดลูกศรเพื่อเรียงลำดับ"
        actions={canWrite ? <Button variant="primary" icon={Plus} onClick={() => setEditing({ parent_id: null, is_active: true })}>เพิ่มหมวด</Button> : null}
      />
      <Card pad={false}>
        {res.error ? (
          <ErrorState message={errorMessage(res.error)} onRetry={res.reload} />
        ) : !res.data ? (
          <TableSkeleton rows={8} cols={3} />
        ) : parents.length === 0 ? (
          <EmptyState icon={FolderTree} title="ยังไม่มีหมวดหมู่" />
        ) : (
          parents.map((p, i) => {
            const kids = sorted(p.id);
            return (
              <div key={p.id}>
                {row(p, 0, i, parents.length)}
                {kids.map((k, j) => row(k, 1, j, kids.length))}
                {canWrite ? (
                  <button type="button" onClick={() => setEditing({ parent_id: p.id, is_active: true })} className="flex w-full items-center gap-1.5 border-b border-hairline-soft py-2 pl-10 text-[13px] text-link hover:bg-surface-2">
                    <Plus className="size-3.5" aria-hidden /> เพิ่มหมวดย่อยใน {p.name}
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </Card>
      {editing ? (
        <CategoryDialog
          initial={editing}
          parents={parents}
          siblings={all.filter((c) => c.parent_id === (editing.parent_id ?? null)).length}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            res.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function CategoryDialog({ initial, parents, siblings, onClose, onSaved }: { initial: Partial<AdminCategory>; parents: AdminCategory[]; siblings: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: initial.name ?? "",
    slug: initial.slug ?? "",
    parent_id: initial.parent_id ? String(initial.parent_id) : "",
    description: initial.description ?? "",
    icon: initial.icon ?? "",
    is_active: initial.is_active ?? true,
    sort_order: String(initial.sort_order ?? siblings + 1),
    seo_title: initial.seo_title ?? "",
    seo_description: initial.seo_description ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function save() {
    const v = validate(categorySchema, f);
    if (!v.ok) return setErrors(v.errors);
    const body: CategoryInput = { ...f, parent_id: f.parent_id ? Number(f.parent_id) : null, sort_order: Number(f.sort_order), image_url: initial.image_url ?? "" };
    setBusy(true);
    try {
      if (initial.id) await updateCategory(initial.id, body);
      else await createCategory(body);
      toast(initial.id ? "บันทึกหมวดแล้ว" : "เพิ่มหมวดแล้ว");
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={initial.id ? `แก้ไขหมวด ${initial.name}` : "เพิ่มหมวด"}
      footer={
        <>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            บันทึก
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="ชื่อหมวด" required error={errors.name}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={Boolean(errors.name)} />
        </Field>
        <Field label="Slug" required error={errors.slug} hint={`/c/${f.slug || "…"}`}>
          <Input value={f.slug} onChange={(e) => setF({ ...f, slug: slugify(e.target.value).replace(/[ก-๙]/g, "") })} invalid={Boolean(errors.slug)} placeholder="shirts" />
        </Field>
        <Field label="อยู่ใต้หมวด" hint="หมวดย่อยมีได้ชั้นเดียว">
          <Select value={f.parent_id} onChange={(e) => setF({ ...f, parent_id: e.target.value })}>
            <option value="">— เป็นหมวดหลัก —</option>
            {parents
              .filter((p) => p.id !== initial.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="ไอคอน (lucide)" hint="เช่น Shirt, Watch, Coffee">
          <Input value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} />
        </Field>
        <Field label="คำอธิบาย" className="sm:col-span-2">
          <Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="SEO title">
          <Input value={f.seo_title} onChange={(e) => setF({ ...f, seo_title: e.target.value })} />
        </Field>
        <Field label="SEO description">
          <Input value={f.seo_description} onChange={(e) => setF({ ...f, seo_description: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Switch checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="แสดงบนหน้าร้าน" />
        </div>
      </div>
    </Dialog>
  );
}
