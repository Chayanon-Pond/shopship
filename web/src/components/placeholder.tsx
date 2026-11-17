import { Suspense } from "react";

/**
 * Wave-0 placeholder for pages that later agents build. Server component.
 * `detail` may be a promise (e.g. derived from params/searchParams) — it is
 * awaited inside <Suspense> so the route stays valid under cacheComponents.
 */
export function Placeholder({
  title,
  owner,
  api,
  detail,
}: {
  title: string;
  owner: "storefront" | "admin";
  api?: string[];
  detail?: Promise<string>;
}) {
  return (
    <section className="container-page py-16">
      <p className="text-sm font-medium text-ink-2">Wave 0 placeholder · owner: {owner}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      {detail ? (
        <Suspense fallback={null}>
          <Detail value={detail} />
        </Suspense>
      ) : null}
      {api?.length ? (
        <ul className="mt-6 space-y-1 text-sm text-ink-2">
          {api.map((a) => (
            <li key={a}>
              <code>{a}</code>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

async function Detail({ value }: { value: Promise<string> }) {
  return <p className="mt-3 text-ink-2">{await value}</p>;
}
