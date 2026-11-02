// An API route: gate 3's crawl does not call it.
export function GET() {
  return Response.json({ ok: true });
}
