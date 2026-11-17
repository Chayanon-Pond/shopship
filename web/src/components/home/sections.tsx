"use client";

import { clsx } from "clsx";
import { Crown, Lock, Mail } from "lucide-react";
import { IntentLink as Link } from "@/components/ui/intent-link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import * as api from "@/lib/api/storefront";
import type { ProductCard } from "@/lib/api/types";
import { promoCopy, tierLabel } from "@/lib/site";
import { useSession } from "@/components/store/session";
import { useOffers } from "@/components/store/personal";
import { useToast } from "@/components/store/toast";
import { ProductRail } from "@/components/product/grid";
import { Reveal } from "@/components/ui/motion";
import { SectionHead } from "@/components/ui/primitives";

/** "Deals for you": personal member / trade prices fetched client-side from /offers (never cached on the server). */
export function DealsForYou({ products, variants }: { products: ProductCard[]; variants: Record<string, number> }) {
  const { me, ready } = useSession();
  const offers = useOffers(products.map((p) => variants[p.slug]).filter(Boolean));
  const personal = products.filter((p) => {
    const o = offers.get(variants[p.slug]);
    return o && (o.price_source.kind !== "list" || o.qty_breaks.length > 0);
  });
  const list = me && personal.length >= 2 ? [...personal, ...products.filter((p) => !personal.includes(p))] : products;
  return (
    <section aria-labelledby="deals-title" className="cv-section container-page py-12 md:py-16">
      <SectionHead
        id="deals-title"
        eyebrow={me ? `${tierLabel[me.tier] ?? "สมาชิก"}${me.group ? ` · ${me.group.name}` : ""}` : "ราคาพิเศษสำหรับสมาชิก"}
        title={me ? `ดีลสำหรับคุณ${me.name ? `, ${me.name.split(" ")[0]}` : ""}` : "ดีลสำหรับคุณ"}
        sub={me ? "ราคาสมาชิกและราคาส่งที่คุณได้รับ คำนวณสด ๆ ตามบัญชีของคุณ" : "เข้าสู่ระบบเพื่อดูราคาสมาชิกและราคาส่งของคุณ"}
        action={
          ready && !me ? (
            <Link href="/login?next=/" className="btn btn-primary">
              <Lock className="size-4" aria-hidden /> เข้าสู่ระบบดูราคาของคุณ
            </Link>
          ) : null
        }
      />
      <ProductRail products={list} variants={variants} personal />
    </section>
  );
}

export function MemberStrip() {
  const { me } = useSession();
  return (
    <section id="member" className="container-page py-6" aria-labelledby="member-title">
      <div className="rounded-[28px] bg-canvas-alt p-8 md:p-12">
        <div className="flex items-center gap-2 text-sm font-semibold text-link">
          <Crown className="size-4" aria-hidden /> ShopShip Member
        </div>
        <h2 id="member-title" className="mt-1 text-[28px] font-semibold tracking-[-0.02em] md:text-[40px]">
          {promoCopy.member.title}
        </h2>
        <ul className="mt-6 grid gap-3 sm:grid-cols-3">
          {promoCopy.member.tiers.map((t, i) => (
            <Reveal as="li" key={t.tier} delay={i * 0.08} className={clsx("rounded-tile bg-white p-5", me?.tier === t.tier && "ring-2 ring-accent")}>
              <p className="text-lg font-semibold">{t.name}</p>
              <p className="mt-1 text-sm text-ink-2">{t.perk}</p>
              {me?.tier === t.tier ? <p className="mt-2 text-xs font-semibold text-link">ระดับของคุณ</p> : null}
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Newsletter() {
  const { me, setMe } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (me) {
      try {
        setMe(await api.updateMe({ marketing_consent: true }));
        setDone(true);
      } catch {
        toast({ tone: "error", text: "บันทึกไม่สำเร็จ กรุณาลองใหม่" });
      }
      return;
    }
    try {
      sessionStorage.setItem("shopship_newsletter_email", email);
    } catch {
      /* ignore */
    }
    router.push("/register?newsletter=1");
  }
  return (
    <section className="cv-section container-page py-16 text-center md:py-24" aria-labelledby="nl-title">
      <Reveal>
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-canvas-alt">
          <Mail className="size-6" aria-hidden />
        </span>
        <h2 id="nl-title" className="mt-4 text-[28px] font-semibold tracking-[-0.02em] md:text-[40px]">
          รับโค้ดลับก่อนใคร
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-ink-2">โค้ดส่วนลดตามเทศกาล แจ้งเตือน Flash Sale และดีลสมาชิก ส่งตรงถึงอีเมลคุณ ยกเลิกได้ทุกเมื่อ</p>
        {done || me?.marketing_consent ? (
          <p className="mt-6 font-semibold text-success">คุณรับข่าวสารจาก ShopShip อยู่แล้ว ขอบคุณค่ะ</p>
        ) : (
          <form onSubmit={submit} className="mx-auto mt-6 flex max-w-md flex-col gap-2 sm:flex-row">
            {me ? null : (
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="อีเมลของคุณ"
                aria-label="อีเมล"
                autoComplete="email"
                className="input flex-1 rounded-pill px-5"
              />
            )}
            <button type="submit" className={clsx("btn btn-primary", me && "mx-auto")}>
              {me ? "รับข่าวสารและโค้ด" : "สมัครรับข่าวสาร"}
            </button>
          </form>
        )}
        <p className="mt-3 text-xs text-ink-3">เราใช้อีเมลเพื่อส่งข่าวสารตามที่คุณยินยอมเท่านั้น</p>
      </Reveal>
    </section>
  );
}
