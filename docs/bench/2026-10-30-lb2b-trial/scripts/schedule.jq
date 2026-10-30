# LB2b item 1 (definitions.md): scheduled runs against the slots of "23 */6 * * *", read only.
# Input: `gh api --paginate --slurp 'repos/Ludion-ai/ludion-trial/actions/runs?event=schedule&per_page=100'`, saved
# by the host (no token goes into the container). Run, from this folder:
#   docker run --rm -i --memory 128m -v "$PWD:/s:ro" ghcr.io/jqlang/jq:1.7.1 --arg first 2026-10-30T18:23:00Z \
#     --argjson slots 28 --arg now 2026-11-01T00:00:00Z -f /s/schedule.jq < runs.json
# --arg now is the UTC time of the query, whole seconds (YYYY-MM-DDTHH:MM:SSZ; fractional seconds are an error).
# A slot's run is the earliest schedule run of the workflow created at or after the slot and before the next slot.
# A slot is decided only when its window (slot to slot + 6 h) has closed by --arg now: then it has a run or is missed.
# A slot whose window is still open and has no run yet is pending, not missed. Slots not yet reached are not counted.
# Schedule runs that are not a slot's first run (a second run in one window, or runs outside the 28 slots) are listed
# under "other_runs", for the definition's "listed by hand". Runs of a workflow not named below are listed too.
def median: sort | length as $n | if $n == 0 then null elif $n % 2 == 1 then .[($n - 1) / 2]
  else ((.[$n / 2 - 1] + .[$n / 2]) / 2) end;
def summary($rows): {
  slots_reached: ($rows | length),
  slots_decided: ([ $rows[] | select(.state != "pending") ] | length),
  runs: ([ $rows[] | select(.state == "ran") ] | length),
  pending: [ $rows[] | select(.state == "pending") | .slot ],
  missed: [ $rows[] | select(.state == "missed") | .slot ],
  delay_median_seconds: ([ $rows[] | .delay_seconds // empty ] | median),
  delay_max_seconds: ([ $rows[] | .delay_seconds // empty ] | max) };

($first | fromdateiso8601) as $t0 | ($now | fromdateiso8601) as $tn
| ["ludion-npm", "ludion-php"] as $names
| [ .[].workflow_runs[] | select(.event == "schedule") | . + {c: (.created_at | fromdateiso8601)} ] as $runs
| [ $names[] as $name
    | [ range(0; $slots) | $t0 + . * 21600 | select(. <= $tn) ] as $reached
    | [ $reached[] as $s
        | ([ $runs[] | select(.name == $name and .c >= $s and .c < $s + 21600) ] | sort_by(.c) | first) as $r
        | { workflow: $name, slot: ($s | todateiso8601), run_id: $r.id, created_at: $r.created_at,
            run_started_at: $r.run_started_at, delay_seconds: (if $r then $r.c - $s else null end),
            state: (if $r then "ran" elif $s + 21600 <= $tn then "missed" else "pending" end) } ] ] as $byworkflow
| ([ $byworkflow[][] | .run_id // empty ]) as $counted
| { per_workflow: [ range(0; $names | length) as $i
                    | { workflow: $names[$i] } + summary($byworkflow[$i]) + { rows: $byworkflow[$i] } ],
    both: summary([ $byworkflow[][] ]),
    other_runs: [ $runs[] | select(.id as $id | $counted | index($id) | not)
                  | {id, name, created_at, run_started_at} ] }
