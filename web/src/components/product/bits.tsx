import { ChevronRight } from "lucide-react";
import { IntentLink as Link } from "@/components/ui/intent-link";

/** Minimal markdown: paragraphs, "- " bullet lists, **bold**. Server component, no HTML injection. */
export function Description({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
  return (
    <div className="space-y-4 text-[17px] leading-relaxed text-ink/90">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*]\s+/.test(l)))
          return (
            <ul key={i} className="space-y-1.5">
              {lines.map((l, j) => (
                <li key={j} className="flex gap-2.5">
                  <span className="mt-[0.7em] size-1.5 shrink-0 rounded-full bg-ink-3" aria-hidden />
                  <span>{inline(l.replace(/^\s*[-*]\s+/, ""))}</span>
                </li>
              ))}
            </ul>
          );
        return <p key={i}>{inline(lines.join(" "))}</p>;
      })}
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { name: string; href?: string }[] }) {
  return (
    <nav aria-label="breadcrumb" className="no-scrollbar overflow-x-auto">
      <ol className="flex items-center gap-1 whitespace-nowrap text-[13px] text-ink-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 ? <ChevronRight className="size-3.5 text-ink-3" aria-hidden /> : null}
            {it.href ? (
              <Link href={it.href} className="hover:text-ink hover:underline">
                {it.name}
              </Link>
            ) : (
              <span aria-current="page" className="text-ink">
                {it.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
