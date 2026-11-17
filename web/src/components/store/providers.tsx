"use client";

import { CartProvider } from "./cart";
import { OffersProvider, WishlistProvider } from "./personal";
import { SessionProvider } from "./session";
import { ToastProvider } from "./toast";

/** Client state for the storefront: session → cart / offers / wishlist. Everything personal is fetched no-store here. */
export function StoreProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <SessionProvider>
        <OffersProvider>
          <WishlistProvider>
            <CartProvider>{children}</CartProvider>
          </WishlistProvider>
        </OffersProvider>
      </SessionProvider>
    </ToastProvider>
  );
}
