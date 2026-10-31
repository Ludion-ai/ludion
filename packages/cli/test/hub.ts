// A stand-in for Docker Hub's pull token and manifest HEAD (php.ts, dockerHubTag), in front of another stand-in fetch.
// Nothing is fetched. A tag in `missing` answers 404, as Docker Hub does for a tag it has no manifest for.
export const HUB_DIGEST = `sha256:${"d".repeat(64)}`;
export function withHub(fetchFn: typeof fetch, options: { missing?: string[]; asked?: string[] } = {}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://auth.docker.io/")) { options.asked?.push(url); return new Response(JSON.stringify({ token: "t" })); }
    if (url.startsWith("https://registry-1.docker.io/")) {
      options.asked?.push(`${init?.method ?? "GET"} ${url}`);
      const tag = url.split("/manifests/")[1]!;
      return options.missing?.includes(tag) ? new Response(null, { status: 404 }) : new Response(null, { status: 200, headers: { "docker-content-digest": HUB_DIGEST } });
    }
    return fetchFn(input, init);
  }) as typeof fetch;
}
