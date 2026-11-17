"use client";

import { IntentLink as Link } from "@/components/ui/intent-link";
import { useEffect, useState } from "react";
import * as api from "@/lib/api/storefront";
import type { Product } from "@/lib/api/types";
import { useCart } from "@/components/store/cart";
import { useOffers } from "@/components/store/personal";
import { useToast } from "@/components/store/toast";
import { Sheet, QtyStepper } from "@/components/ui/motion";
import { Img, Price, Skeleton } from "@/components/ui/primitives";
import { VariantPicker } from "./variant-picker";
import { findVariant, initialSelection, type Selection } from "./variants";

/** Quick add from a tile: single in-stock variant → straight into the cart (fly); otherwise a compact picker sheet. */
export function QuickAdd({
  slug,
  name,
  variantId,
  originRef,
  onClose,
}: {
  slug: string;
  name: string;
  variantId?: number;
  originRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const cart = useCart();
  const toast = useToast();
  const [p, setP] = useState<Product | null>(null);
  const [sel, setSel] = useState<Selection>({});
  const [qty, setQty] = useState(1);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .getProduct(slug)
      .then(async (prod) => {
        if (!alive) return;
        const inStock = prod.variants.filter((v) => v.in_stock);
        if (inStock.length === 1 && (prod.options.length === 0 || prod.variants.length === 1 || variantId === inStock[0].id)) {
          const r = originRef.current?.getBoundingClientRect();
          await cart.add(inStock[0].id, 1, r ? { rect: r, image: prod.image?.url } : undefined, prod.name);
          onClose();
          return;
        }
        setP(prod);
        setSel(initialSelection(prod, variantId));
        setSheet(true);
      })
      .catch(() => {
        toast({ tone: "error", text: "โหลดสินค้าไม่สำเร็จ" });
        onClose();
      });
    return () => {
      alive = false;
    };
    // run once per open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const v = p ? findVariant(p, sel) : undefined;
  const image = p ? (p.images.find((i) => i.id === v?.image_id) ?? p.image) : null;
  const offer = useOffers(v ? [v.id] : []).get(v?.id ?? 0);

  return (
    <Sheet open={sheet} onClose={onClose} title={name} side="bottom">
      {!p ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <div className="relative size-20 shrink-0 overflow-hidden rounded-[14px] bg-canvas-alt">
              {image ? <Img src={image.url} alt={image.alt} fill sizes="80px" className="object-cover" /> : null}
            </div>
            <div className="min-w-0">
              <p className="line-clamp-2 font-semibold">{p.name}</p>
              {v ? (
                <Price value={offer?.price_satang ?? v.price_satang} strike={offer?.lowest_30d_satang} sale={!!offer && offer.price_source.kind !== "list"} />
              ) : null}
            </div>
          </div>
          <VariantPicker product={p} sel={sel} onChange={setSel} />
          <div className="flex items-center gap-3">
            <QtyStepper value={qty} onChange={setQty} />
            <button
              type="button"
              className="btn btn-primary flex-1"
              disabled={!v?.in_stock || cart.busy}
              onClick={async () => {
                if (!v) return;
                const r = originRef.current?.getBoundingClientRect();
                const ok = await cart.add(v.id, qty, r ? { rect: r, image: image?.url } : undefined, p.name);
                if (ok) onClose();
              }}
            >
              {v?.in_stock ? "ใส่ตะกร้า" : "สินค้าหมด"}
            </button>
          </div>
          <Link href={`/p/${p.slug}`} onClick={onClose} className="block text-center text-sm text-link hover:underline">
            ดูรายละเอียดสินค้า
          </Link>
        </div>
      )}
    </Sheet>
  );
}
