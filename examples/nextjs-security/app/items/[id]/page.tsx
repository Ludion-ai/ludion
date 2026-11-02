// A dynamic route: gate 3's crawl does not open it. Opened, it answers an error, so a crawl that reached it would show.
export default async function Item({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  throw new Error(`Item ${id} is not to be opened by the crawl`);
}
