import { ChevronRight } from "lucide-react";
import { IntentLink as Link } from "@/components/ui/intent-link";
import type { Campaign } from "@/lib/api/types";
import { Countdown, CopyCode } from "@/components/ui/motion";
import { Img } from "@/components/ui/primitives";

/** Readable text colour on an arbitrary campaign accent (hex). */
function safeAccent(hex: string | undefined) {
  return /^#[0-9a-f]{6}$/i.test(hex ?? "") ? hex! : "#0071e3";
}

/**
 * Apple-style scroll-driven hero for the ACTIVE seasonal campaign (`/campaigns/active`).
 * Headline + code chips stay crisp; the big product image scales up and the copy
 * parallaxes away as you scroll (transform/opacity only; static under reduced motion).
 * The parallax is a CSS scroll-driven animation (`.fx-hero-copy` / `.fx-hero-img`, globals.css) — no JS on scroll;
 * browsers without `animation-timeline` show the static first frame.
 */
export function CampaignHero({ campaign }: { campaign: Campaign | null }) {
  if (!campaign || (!campaign.banners.length && !campaign.theme.hero_image_url)) {
    // no seasonal campaign (or the always-on campaign without a banner): default hero + any advertised codes
    const codes = campaign?.promo_codes ?? [];
    return (
      <section className="bg-canvas-alt">
        <div className="container-page py-20 text-center md:py-28">
          <h1 className="text-[44px] font-semibold leading-[1.05] tracking-[-0.03em] md:text-[80px]">ช้อปง่าย ส่งไว</h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-ink-2 md:text-2xl">ของแท้ทุกชิ้น ราคาสมาชิกและราคาส่งสำหรับคุณ</p>
          <div className="mt-8 flex justify-center gap-3">
            <Link href="/search" className="btn btn-primary">
              เริ่มช้อป
            </Link>
            <Link href="/promotions" className="btn btn-secondary">
              ดูโปรโมชัน
            </Link>
          </div>
          {codes.length ? (
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {codes.slice(0, 2).map((c) => (
                <div key={c.code} className="flex flex-col items-center gap-1">
                  <CopyCode code={c.code} />
                  <span className="text-xs text-ink-2">{c.label}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  const accent = safeAccent(campaign.theme.accent);
  const contrast = safeAccent(campaign.theme.accent_contrast) === "#0071e3" ? "#ffffff" : campaign.theme.accent_contrast;
  // darker shade of the campaign accent for small text on the tinted background and the CTA fill (WCAG AA 4.5:1)
  const accentInk = `color-mix(in srgb, ${accent} 72%, black)`;
  const banner = campaign.banners[0];
  const codes = campaign.promo_codes ?? [];
  const hero = campaign.theme.hero_image_url || banner?.image_url;

  return (
    <section
      className="relative overflow-hidden"
      style={{ background: campaign.theme.background || "#fff", ["--c-accent" as string]: accent, ["--c-contrast" as string]: contrast }}
      aria-labelledby="campaign-title"
    >
      <div className="fx-hero-copy container-page relative z-10 pt-12 text-center md:pt-20">
        <p
          className="fx-rise inline-flex items-center gap-2 rounded-pill px-3 py-1 text-sm font-semibold"
          style={{ background: `color-mix(in srgb, ${accent} 12%, white)`, color: accentInk }}
        >
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ background: accent }} />
            <span className="relative inline-flex size-2 rounded-full" style={{ background: accent }} />
          </span>
          แคมเปญตอนนี้ · {campaign.theme.badge_text || campaign.season_tag}
        </p>
        <h1 id="campaign-title" className="mx-auto mt-4 max-w-4xl text-[44px] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[64px] md:text-[88px]">
          {/* padding-bottom (cancelled by the negative margin) gives descenders room inside the clipped gradient: system fonts such as Segoe UI descend below the tight 1.04 line box */}
          <span className="-mb-[0.14em] block bg-clip-text pb-[0.14em] text-transparent" style={{ backgroundImage: `linear-gradient(100deg, #1d1d1f 20%, ${accent} 90%)` }}>
            {campaign.name}
          </span>
        </h1>
        {banner ? (
          <p className="mx-auto mt-3 max-w-2xl text-[19px] leading-snug text-ink-2 md:text-[26px]">
            {banner.title}
            {banner.subtitle ? <span className="block text-ink-2 md:inline"> · {banner.subtitle}</span> : null}
          </p>
        ) : null}
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={banner?.link_url || `/campaign/${campaign.slug}`}
            className="btn min-w-[132px] transition hover:brightness-110"
            style={{ background: contrast.toLowerCase() === "#ffffff" ? accentInk : accent, color: contrast }}
          >
            {banner?.cta_label || "ช้อปเลย"}
          </Link>
          <Link href={`/campaign/${campaign.slug}`} className="btn btn-link gap-0.5 text-[17px]">
            ดูดีลทั้งหมด <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
        <div className="mt-6 flex flex-col items-center gap-3">
          {codes.length ? (
            <div className="flex flex-wrap justify-center gap-2">
              {codes.slice(0, 2).map((c) => (
                <div key={c.code} className="flex flex-col items-center gap-1">
                  <CopyCode code={c.code} />
                  <span className="text-xs text-ink-2">{c.label}</span>
                </div>
              ))}
            </div>
          ) : null}
          <p className="flex items-center gap-2 text-sm text-ink-2">
            เหลือเวลาอีก <Countdown to={campaign.ends_at} label="แคมเปญจะสิ้นสุดใน" />
          </p>
        </div>
      </div>
      {hero ? (
        <div className="relative mx-auto mt-8 max-w-[1240px] md:mt-12 px-[var(--page-gutter)] pb-10 md:pb-16">
          <div className="fx-hero-img relative aspect-[16/10] origin-top overflow-hidden rounded-[28px] md:aspect-[2/1]">
            <Img src={hero} alt={banner?.image_alt || campaign.name} fill fetchPriority="high" loading="eager" sizes="(min-width:1240px) 1200px, 100vw" className="object-cover" />
          </div>
        </div>
      ) : null}
    </section>
  );
}
