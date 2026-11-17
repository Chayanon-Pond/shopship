/** Railway healthcheck for the web service. */
export function GET() {
  return Response.json({ status: "ok" });
}
