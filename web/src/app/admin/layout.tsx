import type { Metadata } from "next";

// Back office: never indexed. Owner: Wave-1 "admin" agent.
export const metadata: Metadata = {
  title: { default: "หลังร้าน", template: "%s | ShopShip Admin" },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-canvas-alt">{children}</div>;
}
