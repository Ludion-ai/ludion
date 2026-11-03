# Runs in Docker (jq 1.7.1, no network) on the saved JSON: the three lines of docs/decisions/2026-11-03-ltrial-two-runs.md.
# jq -n -f lines.jq --slurpfile p0 pulls-P0.json --slurpfile p1 pulls-after-run1.json --slurpfile p2 pulls-after-run2.json \
#   --slurpfile b1 branches-after-run1.json --slurpfile b2 branches-after-run2.json --slurpfile r1 run1-run-<id>.json \
#   --slurpfile r2 run2-run-<id>.json --slurpfile j1 run1-jobs-<id>.json --slurpfile c pr-8-head-commit.json \
#   --slurpfile f pr-8-files.json --slurpfile receipt receipt-run1.json --rawfile body pr-8-body-after-run2.md
def numbers($x): [$x[][].number] | sort;
def ludion($x): [$x[][] | .name | select(startswith("ludion/"))] | sort;
(numbers($p0)) as $n0 | (numbers($p1)) as $n1 | (numbers($p2)) as $n2
| ($n1 - $n0) as $new
| ([$p1[][] | select(.number == $new[0])][0]) as $pr
| ([$p2[][] | select(.head.ref == $pr.head.ref)]) as $same
| ([$receipt[0].fixes[] | select(.outcome == "applied")]) as $applied
| ($applied[0]) as $fix
| ($fix.resolution) as $res
| ([$c[0].parents[].sha]) as $parents
| {
  line1: {
    new_prs: $new,
    "1_exactly_one": ($new | length == 1),
    "2_base_main": ($pr.base.ref == "main"),
    "2_head_branch": $pr.head.ref,
    "2_head_starts": ($pr.head.ref | startswith("ludion/npm-ltrial/")),
    "2_author": $pr.user.login,
    "3_one_parent_run1_head": ($parents == [$r1[0].head_sha]),
    "3_only_under_folder": ([$f[0][].filename | startswith("npm-ltrial/")] | all),
    "3_files": [$f[0][].filename],
    "4_applied_fixes": ($applied | length),
    "4_is_pr_package": ($pr.title | contains($fix.package)),
    "5_pull_request_job": ([$j1[0].jobs[] | select(.name == "pull-request") | .conclusion][0])
  },
  line2: {
    has_resolution: ($res != null),
    t: $res.t,
    t_is_string: ($res.t | type == "string"),
    requirements: $res.requirements,
    requirements_ge_1: ($res.requirements >= 1),
    stopped_no_allowed: $res.stopped_no_allowed,
    no_answer_absent: ($res | has("no_answer") | not),
    fix_answer: ([$res.answers[] | select(.name == $fix.package and .version == ($fix.changes[0].to))] | length),
    assert_problems: $res.assert.problems,
    roles: [$res.answers[].role]
  },
  pr_body: {
    bytes: ($body | length),
    resolution: ($body | test("resolution"; "i")),
    oldest: ($body | test("oldest"; "i")),
    japanese: ($body | test("最古")),
    requirement: ($body | contains($res.answers[0].requirement)),
    receipt_id_named: ($body | contains($receipt[0].id))
  },
  line3: {
    "1_same_numbers": ($n1 == $n2),
    numbers: $n2,
    "2_one_pr_on_branch": ($same | length),
    "2_head_unchanged": ($same[0].head.sha == $pr.head.sha),
    head_sha: $same[0].head.sha,
    state: $same[0].state,
    "3_same_ludion_branches": (ludion($b1) == ludion($b2)),
    ludion_branches: ludion($b2),
    "4_run2_conclusion": $r2[0].conclusion,
    run2_same_head_as_run1: ($r1[0].head_sha == $r2[0].head_sha)
  }
}
