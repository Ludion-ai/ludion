# LB2b item 1 (definitions.md): scheduled runs against the slots of "23 */6 * * *", read only.
# Input: `gh api --paginate --slurp 'repos/Ludion-ai/ludion-trial/actions/runs?event=schedule&per_page=100'`, saved
# by the host. Run: docker run --rm -i ghcr.io/jqlang/jq:1.7.1 --arg first 2026-10-30T18:23:00Z --argjson slots 28 \
#   --arg now <UTC time of the query> -f schedule.jq < runs.json
# A slot's run is the earliest schedule run of the workflow created at or after the slot and before the next slot.
# Slots after --arg now are not counted (not yet due).
def median: sort | length as $n | if $n == 0 then null elif $n % 2 == 1 then .[($n - 1) / 2]
  else ((.[$n / 2 - 1] + .[$n / 2]) / 2) end;

($first | fromdateiso8601) as $t0 | ($now | fromdateiso8601) as $tn
| [ .[].workflow_runs[] | select(.event == "schedule") ] as $runs
| ["ludion-npm", "ludion-php"] as $names
| [ $names[] as $name
    | [ range(0; $slots) | $t0 + . * 21600 | select(. <= $tn) ] as $due
    | [ $due[] as $s
        | ([ $runs[] | select(.name == $name) | (.created_at | fromdateiso8601) as $c
             | select($c >= $s and $c < $s + 21600) | {id, created_at, run_started_at, c: $c} ]
           | sort_by(.c) | first) as $r
        | { slot: ($s | todateiso8601), run_id: $r.id, created_at: $r.created_at, run_started_at: $r.run_started_at,
            delay_seconds: (if $r then $r.c - $s else null end) } ] as $rows
    | { workflow: $name, slots_due: ($due | length), runs: ([ $rows[] | select(.run_id) ] | length),
        delay_median_seconds: ([ $rows[] | .delay_seconds // empty ] | median),
        delay_max_seconds: ([ $rows[] | .delay_seconds // empty ] | max),
        missed: [ $rows[] | select(.run_id == null) | .slot ], rows: $rows } ]
