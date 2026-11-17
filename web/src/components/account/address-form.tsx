"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api/client";
import * as api from "@/lib/api/storefront";
import type { Address, AddressInput } from "@/lib/api/types";
import { errorText } from "@/components/store/cart";

const EMPTY: AddressInput = { label: "", recipient_name: "", phone: "", line1: "", line2: "", subdistrict: "", district: "", province: "", postal_code: "", is_default: false };

const FIELDS: { k: keyof AddressInput; label: string; auto?: string; half?: boolean; mode?: "numeric" | "tel"; optional?: boolean }[] = [
  { k: "recipient_name", label: "ชื่อผู้รับ", auto: "name" },
  { k: "phone", label: "เบอร์โทรศัพท์", auto: "tel", mode: "tel" },
  { k: "line1", label: "บ้านเลขที่ หมู่บ้าน ถนน", auto: "address-line1" },
  { k: "line2", label: "รายละเอียดเพิ่มเติม (ถ้ามี)", auto: "address-line2", optional: true },
  { k: "subdistrict", label: "แขวง / ตำบล", half: true },
  { k: "district", label: "เขต / อำเภอ", half: true, auto: "address-level2" },
  { k: "province", label: "จังหวัด", half: true, auto: "address-level1" },
  { k: "postal_code", label: "รหัสไปรษณีย์", half: true, auto: "postal-code", mode: "numeric" },
  { k: "label", label: "ชื่อเรียกที่อยู่ เช่น บ้าน, ที่ทำงาน (ถ้ามี)", optional: true },
];

export function AddressForm({ initial, onSaved }: { initial?: Address; onSaved: (a: Address) => void }) {
  const [v, setV] = useState<AddressInput>(initial ? { ...EMPTY, ...initial } : EMPTY);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  function validate() {
    const e: Record<string, string> = {};
    for (const f of FIELDS) if (!f.optional && !String(v[f.k] ?? "").trim()) e[f.k] = "จำเป็นต้องกรอก";
    if (v.postal_code && !/^[1-9][0-9]{4}$/.test(v.postal_code)) e.postal_code = "รหัสไปรษณีย์ 5 หลัก";
    const digits = v.phone.replace(/[\s-]/g, "");
    if (v.phone && !/^\d{9,15}$/.test(digits)) e.phone = "เบอร์โทร 9–15 หลัก";
    return e;
  }
  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrs(e);
    setMsg("");
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const a = initial ? await api.updateAddress(initial.id, v) : await api.createAddress(v);
      onSaved(a);
    } catch (er) {
      if (er instanceof ApiError && er.fields) setErrs(er.fields);
      setMsg(errorText(er));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-2 gap-3">
      {FIELDS.map((f) => (
        <label key={f.k} className={f.half ? "col-span-1" : "col-span-2"}>
          <span className="mb-1 block text-sm font-medium">{f.label}</span>
          <input
            className="input"
            value={String(v[f.k] ?? "")}
            onChange={(e) => setV({ ...v, [f.k]: e.target.value })}
            autoComplete={f.auto}
            inputMode={f.mode}
            aria-invalid={!!errs[f.k]}
            aria-describedby={errs[f.k] ? `err-${f.k}` : undefined}
          />
          {errs[f.k] ? (
            <span id={`err-${f.k}`} className="mt-1 block text-xs text-danger">
              {errs[f.k]}
            </span>
          ) : null}
        </label>
      ))}
      <label className="col-span-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!v.is_default} onChange={(e) => setV({ ...v, is_default: e.target.checked })} className="size-4 accent-[var(--accent)]" />
        ตั้งเป็นที่อยู่หลัก
      </label>
      {msg ? <p className="col-span-2 text-sm text-danger" role="alert">{msg}</p> : null}
      <button type="submit" className="btn btn-primary col-span-2 mt-1" disabled={busy}>
        {busy ? "กำลังบันทึก…" : "บันทึกที่อยู่"}
      </button>
    </form>
  );
}

export function addressLines(a: Omit<Address, "id">) {
  return [a.line1, a.line2, a.subdistrict, a.district, a.province, a.postal_code].filter(Boolean).join(" ");
}
