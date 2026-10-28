import type { APIRequestContext } from "@playwright/test";

/** The public pages. The optional request keeps older callers type-safe. */
export function allPages(_request?: APIRequestContext): string[] {
  return ["/", "/start/", "/no-such-page/"];
}

/** Removed URLs and where they go. Location for "/" is the site root, not every path that ends in a slash. */
export const redirects: [string, string][] = [
  ["/lessons/", "/start/"],
  ["/lessons/01M4N4KZ0QT41TY27SW0E683RX", "/start/"],
  ["/teachers/ludion-ai/", "/start/"],
  ["/bench/", "/"],
  ["/bench/method/", "/"],
  ["/bench.json", "/"],
  ["/models", "/"],
  ["/vitest/", "/start/"],
  ["/vitest", "/start/"],
  ["/agents/", "/start/"],
  ["/wrangler", "/start/"],
  ["/python/", "/start/"],
];
