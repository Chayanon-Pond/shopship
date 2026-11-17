import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const ogSize = { width: 1200, height: 630 };

let font: Promise<Buffer> | null = null;
/** IBM Plex Sans Thai Bold (SIL OFL) from public/fonts — Satori needs a font with Thai glyphs. */
function thaiFont() {
  font ??= readFile(join(process.cwd(), "public", "fonts", "IBMPlexSansThai-700.ttf"));
  return font;
}

/** Brand OG card (white, Apple-like): eyebrow, big title, optional price line. */
export async function ogCard({ eyebrow, title, line, accent = "#0071e3" }: { eyebrow: string; title: string; line?: string; accent?: string }) {
  const data = await thaiFont().catch(() => null);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#ffffff", padding: 72, fontFamily: "Plex" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 56, height: 48, borderRadius: 14, background: accent, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 32 }}>→</div>
          <div style={{ fontSize: 40, color: "#1d1d1f", letterSpacing: -1 }}>ShopShip</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 32, color: accent }}>{eyebrow}</div>
          <div style={{ fontSize: title.length > 28 ? 64 : 84, color: "#1d1d1f", lineHeight: 1.15, letterSpacing: -2, marginTop: 8 }}>{title}</div>
          {line ? <div style={{ fontSize: 44, color: "#6e6e73", marginTop: 20 }}>{line}</div> : null}
        </div>
        <div style={{ display: "flex", height: 10, borderRadius: 10, background: `linear-gradient(90deg, ${accent}, #30d158)` }} />
      </div>
    ),
    { ...ogSize, fonts: data ? [{ name: "Plex", data, weight: 700, style: "normal" }] : undefined },
  );
}
