// The site's two languages: English at the root, Japanese under /ja/. Both string files have the same keys.
import { en } from "./en.ts";
import { ja } from "./ja.ts";

export type Lang = "en" | "ja";

export const strings: Record<Lang, typeof en> = { en, ja };

/** A page's path in a language, from its English path. */
export const localPath = (lang: Lang, path: string) => (lang === "ja" ? `/ja${path}` : path);
