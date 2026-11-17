/** Server-rendered JSON-LD <script>. "<" is escaped so data can never close the tag. No client JS. */
export function JsonLd({ data }: { data: object | object[] }) {
  const doc = Array.isArray(data) ? { "@context": "https://schema.org", "@graph": data } : { "@context": "https://schema.org", ...data };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(doc).replace(/</g, "\\u003c") }} />;
}
