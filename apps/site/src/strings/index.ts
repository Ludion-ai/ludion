// The site's two languages: English at the root, Japanese under /ja/. Both string files have the same keys.
import { en } from "./en.ts";
import { ja } from "./ja.ts";

export type Lang = "en" | "ja";

export const strings: Record<Lang, typeof en> = { en, ja };

/** The other language, for the language link. */
export const otherLang = (lang: Lang): Lang => (lang === "en" ? "ja" : "en");

/** A page's path in a language, from its English path. */
export const localPath = (lang: Lang, path: string) => (lang === "ja" ? `/ja${path}` : path);
