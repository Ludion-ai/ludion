// Guard copy and the mark color. The knowledge strips and /bench page are gone.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "../src/strings/en.ts";
import { ja } from "../src/strings/ja.ts";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

describe("security preview claims", () => {
  it("distinguishes an update, no match, unavailable metadata and unsupported input", () => {
    expect(en.home.guard.states.map(s => s.id)).toEqual(["update", "no-match", "unknown", "unsupported"]);
    expect(en.home.guard.states.find(s => s.id === "no-match")?.detail).toContain("not a guarantee");
    expect(en.home.guard.note).toContain("Dependency advisories come from OSV");
    expect(en.home.supported).toHaveLength(4);
    expect(en.home.supportedNote).toContain("Yarn/pnpm discovery is partial");
  });
  it("does not present illustrations or source updates as completed production remediation", () => {
    expect(en.home.isolate.scope).toContain("not a completed update");
    expect(en.home.receipt.scope).toContain("not a run result");
    expect(en.home.receipt.notDeployed).toBe("Not changed");
    expect(en.home.coverage).toContain("production deployment stays with your release process");
    expect(en.home.supportedNote).toContain("automatic production deployment are not supported");
  });
  it("retains explicit application validation and user policy before source changes", () => {
    expect(en.home.isolate.applyDetail).toContain("--apply");
    expect(en.home.verify.notVerified).toContain("failed baseline");
    expect(en.home.verify.notVerified).toContain("changed project");
    expect(en.home.verify.sameModel).toContain("does not invent a passing test");
  });
});

// The Japanese pages translate the English ones: the same keys and lists, the same limits, nothing more.
describe("Japanese copy", () => {
  type Leaf = [path: string, en: string, ja: string];
  const leaves = (a: unknown, b: unknown, path = ""): Leaf[] => {
    if (typeof a === "string") return [[path, a, b as string]];
    expect(typeof b, path).toBe(typeof a);
    if (Array.isArray(a)) {
      expect((b as unknown[]).length, path).toBe(a.length);
      return a.flatMap((item, i) => leaves(item, (b as unknown[])[i], `${path}[${i}]`));
    }
    const ka = Object.keys(a as object);
    expect(Object.keys(b as object), path).toEqual(ka);
    return ka.flatMap((k) => leaves((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  };
  const all = leaves(en, ja);
  // Names, ids and code-like labels that stay as they are in Japanese.
  const SAME = new Set(["site.name", "footer.github", "home.verify.bar", "home.isolate.bar", "home.supported[1].name", "home.supported[3].name"]);
  const SAME_KEY = /\.id$/;

  it("has every key and list item of the English copy", () => {
    expect(all.length).toBeGreaterThan(100);
    for (const [path, , text] of all) expect(text.trim(), path).not.toBe("");
  });
  it("translates every sentence", () => {
    const untranslated = all.filter(([path, a, b]) => a === b && !SAME.has(path) && !SAME_KEY.test(path)).map(([path]) => path);
    expect(untranslated).toEqual([]);
    // The language link names the other language in that language ("English" on the Japanese pages).
    for (const [path, , text] of all) if (!SAME.has(path) && !SAME_KEY.test(path) && path !== "nav.language") expect(text, path).toMatch(/[぀-ヿ一-鿿]/);
  });
  it("keeps the English limits", () => {
    expect(ja.home.guard.states.map((s) => s.id)).toEqual(en.home.guard.states.map((s) => s.id));
    expect(ja.home.guard.states.find((s) => s.id === "no-match")?.detail).toContain("安全だという保証ではありません");
    expect(ja.home.guard.note).toContain("OSV");
    expect(ja.home.isolate.scope).toContain("完了した更新ではありません");
    expect(ja.home.receipt.scope).toContain("実行の結果ではありません");
    expect(ja.home.receipt.scope).toContain("セキュリティの認証を意味するものではありません");
    expect(ja.home.coverage).toContain("本番へのデプロイは、いつものリリース手順のままです");
    expect(ja.home.supportedNote).toContain("本番への自動デプロイ");
    expect(ja.home.supportedNote).toContain("対応していません");
    expect(ja.home.isolate.applyDetail).toContain("--apply");
    expect(ja.home.verify.notVerified).toContain("ベースラインの失敗");
    expect(ja.home.verify.notVerified).toContain("適用しません");
    expect(ja.home.verify.sameModel).toContain("通るテストを作り上げたり");
    expect(ja.start.scan.where).toContain("npm 0.1.4 には、これらのコマンドは入っていません");
    expect(ja.start.coverage).toContain("本番を自動でデプロイし直すことはありません");
    expect(ja.start.apply.branchesBefore).toContain("手元のファイルも今のブランチも変えません");
    expect(ja.start.apply.branchesAfter).toContain("OSV の悪性パッケージ記録（MAL-）");
    expect(ja.start.apply.branchesAfter).toContain("いっしょのときだけ通る修正は、適用しません");
    expect(ja.start.privacy.source).toContain("ソースを Ludion にアップロードすることはなく");
    expect(ja.start.summary).toContain("安全の保証ではありません");
  });
  it("says nothing the product is not, or has not done", () => {
    const text = all.map(([, , b]) => b).join("\n");
    for (const banned of [/Capability Compiler/i, /判定して/, /コメントを返/, /関門/, /ゲートを通/, /自動(で)?マージ/, /保証します/, /安全です/, /認証済み/]) {
      expect(text).not.toMatch(banned);
    }
    // Polite form: no sentence ends in the plain form the English imperative might suggest.
    for (const [path, , b] of all) expect(b, path).not.toMatch(/(だ|である)。/);
  });
});

describe("--mark", () => {
  // WCAG relative luminance and contrast ratio.
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const css = readFileSync(join(root, "apps/site/src/styles/tokens.css"), "utf8");
  const dark = css.slice(css.indexOf("prefers-color-scheme: dark"));
  const token = (block: string, name: string) => new RegExp(String.raw`--${name}:\s*(#[0-9a-f]{6})`).exec(block)![1]!;

  it.each([
    ["light", css],
    ["dark", dark],
  ])("stands out from the page and its panels in %s (3:1 for marks), as does not measured", (_, block) => {
    for (const bg of ["paper", "paper-2"]) expect(ratio(token(block, "mark"), token(block, bg)), bg).toBeGreaterThanOrEqual(3);
    expect(ratio(token(block, "checking-line"), token(block, "paper"))).toBeGreaterThanOrEqual(3);
  });
});
