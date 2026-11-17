"use client";

/** Domain badges and typed inputs shared across admin pages. */
import type { AdminPromotion, OrderStatus } from "@/lib/api/types";
import { ORDER_STATUS_LABEL, type WindowStatus } from "@/lib/admin/format";
import { parseBahtToSatang, formatBaht } from "@/lib/money";
import { Badge, Input, type Tone } from "./ui";
import type { InputHTMLAttributes } from "react";

const orderTone: Record<OrderStatus, Tone> = {
  pending_payment: "orange",
  paid: "blue",
  packing: "purple",
  shipped: "blue",
  delivered: "green",
  completed: "green",
  cancelled: "neutral",
  refunded: "red",
};
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge tone={orderTone[status]} dot>
      {ORDER_STATUS_LABEL[status]}
    </Badge>
  );
}

const promoState: Record<AdminPromotion["state"], [string, Tone]> = {
  running: ["กำลังใช้งาน", "green"],
  scheduled: ["ตั้งเวลาไว้", "blue"],
  ended: ["สิ้นสุดแล้ว", "neutral"],
  draft: ["ฉบับร่าง", "neutral"],
  paused: ["หยุดชั่วคราว", "orange"],
  archived: ["เก็บถาวร", "neutral"],
};
export function PromoStateBadge({ state }: { state: AdminPromotion["state"] }) {
  const [l, t] = promoState[state];
  return (
    <Badge tone={t} dot>
      {l}
    </Badge>
  );
}
export function WindowBadge({ status }: { status: WindowStatus }) {
  return status === "active" ? (
    <Badge tone="green" dot>
      กำลังจัด
    </Badge>
  ) : status === "upcoming" ? (
    <Badge tone="blue" dot>
      เร็วๆ นี้
    </Badge>
  ) : (
    <Badge dot>หมดเขต</Badge>
  );
}
const productStatus = { active: ["เผยแพร่", "green"], draft: ["ฉบับร่าง", "neutral"], hidden: ["ซ่อน", "orange"], archived: ["เก็บถาวร", "neutral"] } as const;
export function ProductStatusBadge({ status }: { status: keyof typeof productStatus }) {
  const [l, t] = productStatus[status];
  return <Badge tone={t}>{l}</Badge>;
}
export function StockBadge({ stock, threshold = 5 }: { stock: number; threshold?: number }) {
  if (stock <= 0) return <Badge tone="red">หมด</Badge>;
  if (stock <= threshold) return <Badge tone="orange">เหลือ {stock}</Badge>;
  return <span className="tabular-nums text-ink">{stock.toLocaleString("th-TH")}</span>;
}

/** Baht text input; the value stays a string, parse with parseBahtToSatang when saving. */
export function MoneyInput({ value, onChange, invalid, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const parsed = value.trim() ? parseBahtToSatang(value) : null;
  return (
    <Input
      inputMode="decimal"
      autoComplete="off"
      prefix="฿"
      value={value}
      invalid={invalid || (value.trim() !== "" && parsed === null)}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => parsed !== null && onChange(formatBaht(parsed, { symbol: false, decimals: parsed % 100 ? "always" : "auto" }))}
      {...rest}
    />
  );
}
export function PercentInput({ value, onChange, invalid, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: string; onChange: (v: string) => void; invalid?: boolean }) {
  return <Input inputMode="decimal" autoComplete="off" suffix="%" value={value} invalid={invalid} onChange={(e) => onChange(e.target.value)} {...rest} />;
}
export function IntInput({ value, onChange, invalid, allowNegative, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: string; onChange: (v: string) => void; invalid?: boolean; allowNegative?: boolean }) {
  return (
    <Input
      inputMode={allowNegative ? "text" : "numeric"}
      autoComplete="off"
      value={value}
      invalid={invalid}
      onChange={(e) => onChange(e.target.value.replace(allowNegative ? /[^\d-]/g : /\D/g, ""))}
      {...rest}
    />
  );
}
