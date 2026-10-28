# The comment; judge-comment.yml's BODY with this action's preview line. The judge's text is shown as an indented code
# block, so nothing in it is read as Markdown, a mention or a line of its own (such as reviewed-sha:). Dropped: control
# characters (C0, C1), the soft hyphen, bidirectional marks, overrides and isolates, zero-width and invisible format
# characters, line and paragraph separators, and tag characters. Tabs become spaces.
def hidden: (. < 32 and . != 10) or (. >= 127 and . <= 159) or . == 173 or . == 1564 or . == 6158 or (. >= 8203 and . <= 8207) or (. >= 8232 and . <= 8238) or (. >= 8288 and . <= 8303) or . == 65279 or (. >= 917504 and . <= 917631);
def clean: explode | map(if . == 9 then 32 else . end | select(hidden | not)) | implode;
def block: clean | split("\n") | map("    " + .) | join("\n");
def named: {stop: "停止", wait: "待機", ready_except_build: "可（関門3は未実施のため、適用してよいという判定ではない）", undecidable: "判定不能"}[.];
.[0] as $r | [
  "<!-- ludion-judge -->",
  "**プレビュー：コメントのみ。マージは行わない。** Preview: comments only; nothing is merged.",
  "",
  "Ludion 判定役 v0（npm）による参考表示で、必須チェックではない。判定するのは関門1・2・4の一部と待機だけで（実装した範囲と「Not checked」は判定役の出力にある）、関門3（旧版と新版のビルド・テスト）は未実装のため実行していない。",
  "",
  (if $refused then
    "判定: **判定不能**（`undecidable`） · この PR の head は .github/ を変更している、または変更ファイルが 300 以上で確かめられない。判定ジョブはワークフロー定義を PR から読むため、その結果は信用しない。 · head `\($r.head_sha)` · [実行ログ](\($run))"
  else
    "判定: **\($r.verdict | named)**（`\($r.verdict)`） · 判定した head `\($r.head_sha)` · 判定にかかった時間: 判定役 \($r.judge_seconds // "不明") 秒、ジョブ開始から \($r.job_seconds // "不明") 秒 · [実行ログ](\($run))",
    "",
    (if $r.text then "判定役の出力:" else "判定役は判定を出せなかった。判定不能として記録した理由:" end),
    "",
    (($r.text // $r.reason) | block)
  end)
] | join("\n") + "\n"
