import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

/** PWA manifest: lets shoppers install ShopShip to their home screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.name,
    short_name: site.name,
    description: site.description,
    lang: "th",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["shopping"],
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    shortcuts: [
      { name: "ตะกร้า", url: "/cart" },
      { name: "Flash Sale", url: "/flash-sale" },
      { name: "คำสั่งซื้อของฉัน", url: "/account/orders" },
    ],
  };
}
