"use client";

import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Download, FileDown, FileSpreadsheet, FileUp, Info, RotateCcw, Upload } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";
import {
  PRODUCTS_EXPORT_PATH,
  PRODUCTS_TEMPLATE_PATH,
  downloadAdminCsv,
  importProductsCsv,
  type ImportAction,
  type ImportIssue,
  type ImportReport,
} from "@/lib/api/admin";
import { formatBaht } from "@/lib/money";
import { errorMessage, useConfirm, useToast } from "../overlay";
import { useSession } from "../session";
import { Badge, Button, Card, EmptyState, LinkButton, PageHeader, Progress, Segmented, Stat, Table, Td, Th, type Tone } from "../ui";

const MAX_BYTES = 8 * 1024 * 1024;
const PAGE = 200;

type Phase = "idle" | "checking" | "preview" | "importing" | "done";
type Filter = "all" | ImportAction;

const ACTION: Record<ImportAction, { label: string; tone: Tone }> = {
  create: { label: "สร้างใหม่", tone: "green" },
  update: { label: "อัปเดต", tone: "blue" },
  skip: { label: "ไม่เปลี่ยน", tone: "neutral" },
  error: { label: "ผิดพลาด", tone: "red" },
};

/** Thai labels for CSV columns (error column + changed fields). */
const COLUMN_TH: Record<string, string> = {
  handle: "handle",
  name_th: "ชื่อ (ไทย)",
  name_en: "ชื่อ (อังกฤษ)",
  subtitle: "คำโปรย",
  description: "รายละเอียด",
  category_slug: "หมวดหมู่",
  brand: "แบรนด์",
  status: "สถานะ",
  featured: "สินค้าแนะนำ",
  tags: "แท็ก",
  options: "ตัวเลือก",
  sku: "SKU",
  price_baht: "ราคา",
  cost_baht: "ต้นทุน",
  stock: "สต็อก",
  low_stock_threshold: "แจ้งเตือนสต็อก",
  weight_grams: "น้ำหนัก",
  barcode: "บาร์โค้ด",
  variant_active: "เปิดขาย",
  image_urls: "รูปภาพ",
  seo_title: "SEO title",
  seo_description: "SEO description",
};
const colTh = (c: string) => COLUMN_TH[c] ?? (c.startsWith("option") ? "ตัวเลือก" : c);

const FORMAT_HELP: [string, string][] = [
  ["handle", "รหัสสินค้าใน URL (a-z 0-9 -) แถวที่ handle เดียวกัน = ตัวเลือกของสินค้าเดียวกัน"],
  ["name_th, category_slug", "จำเป็นสำหรับสินค้าใหม่"],
  ["option1_name / option1_value", "เช่น สี / ขาว (สูงสุด 3 ตัวเลือก)"],
  ["sku", "เว้นว่างได้ ระบบสร้างให้และไม่ซ้ำ"],
  ["price_baht", "ราคาบาท เช่น 590 หรือ 1,290.50 (ปัดเศษสตางค์ขึ้นที่ .005)"],
  ["stock", "ตั้งค่าสต็อกเป็นจำนวนนี้ (เว้นว่าง = คงเดิม)"],
  ["image_urls", "ลิงก์ https คั่นด้วย | (ไม่ดาวน์โหลดรูป ใช้ลิงก์ตรง)"],
];

function bkkStamp(): string {
  const d = new Date(Date.now() + 7 * 3600_000);
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

export function ProductImportPage() {
  const { can } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  const [downloading, setDownloading] = useState<"" | "export" | "template">("");
  const canWrite = can("catalog:write");

  const issuesByRow = useMemo(() => {
    const m = new Map<number, ImportIssue[]>();
    for (const e of report?.errors ?? []) m.set(e.row, [...(m.get(e.row) ?? []), e]);
    return m;
  }, [report]);
  const fileIssues = (report?.errors ?? []).filter((e) => e.row === 0);
  const rows = useMemo(() => (report?.rows ?? []).filter((r) => filter === "all" || r.action === filter), [report, filter]);

  async function download(kind: "export" | "template") {
    setDownloading(kind);
    try {
      if (kind === "export") await downloadAdminCsv(PRODUCTS_EXPORT_PATH, `shopship-products-${bkkStamp()}.csv`);
      else await downloadAdminCsv(PRODUCTS_TEMPLATE_PATH, "shopship-products-template.csv");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setDownloading("");
    }
  }

  async function check(f: File) {
    setFileError("");
    if (!/\.(csv|txt)$/i.test(f.name)) {
      setFileError(/\.xlsx?$/i.test(f.name) ? "ไฟล์ Excel ต้องบันทึกเป็น CSV UTF-8 ก่อน (File → Save As → CSV UTF-8)" : "รองรับเฉพาะไฟล์ .csv");
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError("ไฟล์ใหญ่เกิน 8 MB กรุณาแบ่งเป็นหลายไฟล์");
      return;
    }
    setFile(f);
    setReport(null);
    setFilter("all");
    setShown(PAGE);
    setPhase("checking");
    try {
      const rep = await importProductsCsv(f, true);
      setReport(rep);
      setPhase("preview");
      if (rep.summary.error_rows > 0) setFilter("error");
    } catch (e) {
      setFileError(errorMessage(e));
      setPhase("idle");
    }
  }

  async function runImport() {
    if (!file || !report) return;
    const s = report.summary;
    const ok = await confirm({
      title: "ยืนยันการนำเข้าสินค้า?",
      body: (
        <div className="space-y-2">
          <p>
            สินค้าใหม่ {s.products_create} · อัปเดต {s.products_update} รายการ · ตัวเลือกใหม่ {s.variants_create} · แก้ไข {s.variants_update}
            {s.images_add ? ` · รูป ${s.images_add}` : ""}
          </p>
          <p>บันทึกทั้งไฟล์ในครั้งเดียว หากมีข้อผิดพลาดระหว่างบันทึกจะไม่บันทึกข้อมูลใด ๆ เลย ค่าสต็อกในไฟล์จะแทนที่สต็อกปัจจุบัน</p>
        </div>
      ),
      confirmLabel: "นำเข้า",
    });
    if (!ok) return;
    setPhase("importing");
    try {
      const rep = await importProductsCsv(file, false);
      setReport(rep);
      if (rep.applied) {
        setPhase("done");
        toast(`นำเข้าสำเร็จ ${(rep.summary.products_create + rep.summary.products_update).toLocaleString("th-TH")} สินค้า`);
      } else {
        setPhase("preview");
        setFilter("error");
        toast("นำเข้าไม่สำเร็จ ข้อมูลเปลี่ยนไประหว่างตรวจสอบ ยังไม่มีการบันทึก", "error");
      }
    } catch (e) {
      setPhase("preview");
      toast(errorMessage(e), "error");
    }
  }

  function reset() {
    setPhase("idle");
    setFile(null);
    setReport(null);
    setFileError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && phase !== "checking" && phase !== "importing") void check(f);
  }

  const s = report?.summary;
  const pending = s ? s.products_create + s.products_update : 0; // products_update includes variant-only changes
  const blocked = !report || report.errors.length > 0 || pending === 0;

  return (
    <div>
      <PageHeader
        title="นำเข้า/ส่งออก CSV"
        subtitle="เพิ่มหรือแก้ไขสินค้าทีละหลายร้อยรายการจากไฟล์ Excel (บันทึกเป็น CSV UTF-8)"
        back={{ href: "/admin/products", label: "สินค้า" }}
        actions={
          <>
            <Button variant="outline" icon={FileSpreadsheet} loading={downloading === "template"} onClick={() => download("template")}>
              ไฟล์ตัวอย่าง
            </Button>
            <Button icon={FileDown} loading={downloading === "export"} onClick={() => download("export")}>
              ส่งออกสินค้าทั้งหมด
            </Button>
          </>
        }
      />

      {!canWrite ? (
        <Card>
          <EmptyState icon={Info} title="บัญชีนี้ส่งออกได้อย่างเดียว" body="การนำเข้าสินค้าต้องมีสิทธิ์แก้ไขแคตตาล็อก (ผู้ดูแลหรือเจ้าของร้าน)" />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {phase === "done" && report ? (
              <Card>
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <CheckCircle2 className="size-12 text-success" aria-hidden />
                  <p className="text-lg font-semibold text-ink">นำเข้าเรียบร้อย</p>
                  <p className="max-w-md text-sm text-ink-2">
                    สินค้าใหม่ {report.summary.products_create} · อัปเดต {report.summary.products_update} · ไม่เปลี่ยน {report.summary.products_skip} · ตัวเลือกใหม่{" "}
                    {report.summary.variants_create} · แก้ไข {report.summary.variants_update}
                    {report.summary.images_add ? ` · รูป ${report.summary.images_add}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap justify-center gap-2">
                    <LinkButton href="/admin/products" variant="primary">
                      ดูรายการสินค้า
                    </LinkButton>
                    <Button icon={RotateCcw} onClick={reset}>
                      นำเข้าไฟล์อื่น
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
              <Card title="1. เลือกไฟล์ CSV">
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv,.txt"
                  className="sr-only"
                  id="csv-file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void check(f);
                  }}
                />
                <label
                  htmlFor="csv-file"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  className={clsx(
                    "flex min-h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed px-6 py-8 text-center transition-colors",
                    dragging ? "border-accent bg-accent-soft" : "border-hairline hover:border-accent hover:bg-canvas-alt",
                    (phase === "checking" || phase === "importing") && "pointer-events-none opacity-60",
                  )}
                >
                  <Upload className="size-8 text-ink-2" aria-hidden />
                  <span className="font-medium text-ink">{file ? file.name : "ลากไฟล์มาวางที่นี่ หรือแตะเพื่อเลือกไฟล์"}</span>
                  <span className="text-[13px] text-ink-2">
                    {file ? `${(file.size / 1024).toLocaleString("th-TH", { maximumFractionDigits: 1 })} KB · แตะเพื่อเปลี่ยนไฟล์` : "ไฟล์ .csv ไม่เกิน 8 MB · สูงสุด 5,000 แถว · รองรับ UTF-8 (มี/ไม่มี BOM) และไฟล์ไทยจาก Excel"}
                  </span>
                </label>
                {fileError ? (
                  <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-danger">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {fileError}
                  </p>
                ) : null}
                {phase === "checking" || phase === "importing" ? (
                  <div className="mt-4 space-y-2" aria-live="polite">
                    <p className="text-sm text-ink-2">{phase === "checking" ? "กำลังตรวจสอบไฟล์ (ยังไม่บันทึกข้อมูล)…" : "กำลังนำเข้า บันทึกทั้งไฟล์ในครั้งเดียว กรุณาอย่าปิดหน้านี้…"}</p>
                    <Progress value={phase === "checking" ? 1 : 2} max={3} label="ความคืบหน้า" />
                  </div>
                ) : null}
              </Card>
            )}

            {report && phase !== "done" ? (
              <Card
                pad={false}
                title="2. ตรวจสอบก่อนนำเข้า"
                actions={
                  <Button variant="primary" icon={FileUp} disabled={blocked} loading={phase === "importing"} onClick={runImport}>
                    ยืนยันนำเข้า
                  </Button>
                }
              >
                <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
                  <Stat label="สินค้าใหม่" value={s!.products_create.toLocaleString("th-TH")} sub={`ตัวเลือกใหม่ ${s!.variants_create.toLocaleString("th-TH")}`} />
                  <Stat label="อัปเดต" value={s!.products_update.toLocaleString("th-TH")} sub={`ตัวเลือกที่แก้ ${s!.variants_update.toLocaleString("th-TH")}`} />
                  <Stat label="ไม่เปลี่ยนแปลง" value={s!.products_skip.toLocaleString("th-TH")} sub={`ตัวเลือก ${s!.variants_skip.toLocaleString("th-TH")}`} />
                  <Stat label="แถวที่ผิดพลาด" value={<span className={s!.error_rows ? "text-danger" : undefined}>{s!.error_rows.toLocaleString("th-TH")}</span>} sub={`จาก ${s!.rows.toLocaleString("th-TH")} แถว`} />
                </div>

                {report.errors.length > 0 ? (
                  <div role="alert" className="mx-4 mb-4 rounded-[12px] border border-[#f5c2c7] bg-[#fdecee] p-3 text-sm text-danger">
                    <p className="flex items-center gap-2 font-medium">
                      <AlertTriangle className="size-4" aria-hidden />
                      พบข้อผิดพลาด {report.errors.length.toLocaleString("th-TH")} รายการ{report.truncated ? " (แสดงบางส่วน)" : ""} แก้ไขไฟล์แล้วอัปโหลดใหม่ ยังไม่มีการบันทึกข้อมูล
                    </p>
                    {fileIssues.length ? (
                      <ul className="mt-1 list-disc pl-6">
                        {fileIssues.map((e, i) => (
                          <li key={i}>{e.message}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : pending === 0 && report.rows.length > 0 ? (
                  <p className="mx-4 mb-4 rounded-[12px] bg-canvas-alt p-3 text-sm text-ink-2">ข้อมูลในไฟล์ตรงกับสินค้าในร้านทั้งหมด ไม่มีอะไรต้องนำเข้า</p>
                ) : null}

                {report.warnings.length > 0 ? (
                  <details className="mx-4 mb-4 rounded-[12px] border border-hairline-soft bg-sale-soft p-3 text-sm text-ink">
                    <summary className="cursor-pointer font-medium text-sale">คำเตือน {report.warnings.length} รายการ (นำเข้าได้)</summary>
                    <ul className="mt-2 space-y-1">
                      {report.warnings.map((w, i) => (
                        <li key={i}>
                          {w.row ? <span className="font-medium">แถว {w.row}: </span> : null}
                          {w.column ? <span className="text-ink-2">[{colTh(w.column)}] </span> : null}
                          {w.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                <div className="border-t border-hairline-soft p-3">
                  <Segmented<Filter>
                    size="sm"
                    value={filter}
                    onChange={(v) => {
                      setFilter(v);
                      setShown(PAGE);
                    }}
                    options={[
                      { value: "all", label: `ทั้งหมด ${report.rows.length}` },
                      { value: "error", label: `ผิดพลาด ${s!.error_rows}` },
                      { value: "create", label: `ใหม่ ${s!.variants_create}` },
                      { value: "update", label: `อัปเดต ${s!.variants_update}` },
                      { value: "skip", label: `ไม่เปลี่ยน ${s!.variants_skip}` },
                    ]}
                  />
                </div>
                <Table>
                  <thead>
                    <tr>
                      <Th className="w-16">แถว</Th>
                      <Th>สินค้า / ตัวเลือก</Th>
                      <Th>SKU</Th>
                      <Th align="right">ราคา</Th>
                      <Th align="right">สต็อก</Th>
                      <Th>ผล</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <Td colSpan={6} className="py-8 text-center text-ink-2">
                          ไม่มีแถวในกลุ่มนี้
                        </Td>
                      </tr>
                    ) : null}
                    {rows.slice(0, shown).map((r) => {
                      const issues = issuesByRow.get(r.row) ?? [];
                      const bad = r.action === "error";
                      return (
                        <tr key={r.row} className={clsx(bad && "bg-[#fdecee]/60")}>
                          <Td className="tabular-nums text-ink-2">{r.row}</Td>
                          <Td>
                            <div className="font-medium text-ink">{r.name || <span className="text-ink-2">—</span>}</div>
                            <div className="text-xs text-ink-2">
                              {r.handle}
                              {r.variant ? ` · ${r.variant}` : ""}
                            </div>
                            {issues.length ? (
                              <ul className="mt-1 space-y-0.5 text-xs text-danger">
                                {issues.map((e, i) => (
                                  <li key={i}>
                                    {e.column ? <span className="font-medium">[{colTh(e.column)}] </span> : null}
                                    {e.message}
                                  </li>
                                ))}
                              </ul>
                            ) : r.changes.length ? (
                              <div className="mt-1 text-xs text-link">แก้: {r.changes.map(colTh).join(", ")}</div>
                            ) : null}
                          </Td>
                          <Td className="font-mono text-xs">
                            {r.sku || "—"}
                            {r.sku_generated ? (
                              <Badge tone="purple" className="ml-1">
                                อัตโนมัติ
                              </Badge>
                            ) : null}
                          </Td>
                          <Td align="right">{r.price_satang != null ? formatBaht(r.price_satang) : "—"}</Td>
                          <Td align="right">{r.stock != null ? r.stock.toLocaleString("th-TH") : "—"}</Td>
                          <Td>
                            <Badge tone={ACTION[r.action].tone} dot>
                              {ACTION[r.action].label}
                            </Badge>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
                {rows.length > shown ? (
                  <div className="flex justify-center border-t border-hairline-soft p-3">
                    <Button size="sm" onClick={() => setShown((n) => n + PAGE)}>
                      แสดงเพิ่ม ({(rows.length - shown).toLocaleString("th-TH")} แถว)
                    </Button>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline-soft p-3">
                  <Button variant="ghost" icon={RotateCcw} onClick={reset} disabled={phase === "importing"}>
                    เลือกไฟล์ใหม่
                  </Button>
                  <Button variant="primary" icon={FileUp} disabled={blocked} loading={phase === "importing"} onClick={runImport}>
                    {blocked && report.errors.length > 0 ? "แก้ข้อผิดพลาดก่อนนำเข้า" : "ยืนยันนำเข้า"}
                  </Button>
                </div>
              </Card>
            ) : null}
          </div>

          <Card title="รูปแบบไฟล์" className="h-fit">
            <p className="text-sm text-ink-2">หนึ่งแถว = หนึ่งตัวเลือกสินค้า (เช่น สีขาว ไซซ์ M) ช่องที่เว้นว่างตอนอัปเดตจะคงค่าเดิมไว้</p>
            <dl className="mt-3 space-y-2.5 text-sm">
              {FORMAT_HELP.map(([k, v]) => (
                <div key={k}>
                  <dt className="font-mono text-xs text-ink">{k}</dt>
                  <dd className="text-ink-2">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-ink-2">ไม่มีช่องราคาเปรียบเทียบ: ราคาขีดฆ่าคำนวณจากราคาต่ำสุด 30 วันโดยอัตโนมัติ ราคาส่ง/สมาชิกตั้งในหน้าโปรโมชัน</p>
            <Button variant="outline" size="sm" icon={Download} className="mt-4 w-full" loading={downloading === "template"} onClick={() => download("template")}>
              ดาวน์โหลดไฟล์ตัวอย่าง
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}
