# LB2b2, read only (docs/decisions/2026-10-31-lb2b2-trial-definitions.md, item 1): the hourly slots (HH:23 UTC) from
# $from (T_switch) to $to (when the runs list was saved), per workflow, from GET /repos/Ludion-ai/ludion-trial/actions/runs
# ?event=schedule saved by the host's gh. A slot's run is the earliest schedule run of that workflow created at or after
# the slot and before the next one; a slot whose hour has not ended at $to and has no run is pending, not missed.
# Usage: docker run --rm -v "$PWD":/b -w /b ghcr.io/jqlang/jq:1.7.1 --arg from 2026-10-30T18:56:45Z \
#          --arg to <saved at> -f scripts/hourly.jq logs/schedule-runs-<saved at>.json
def t: fromdateiso8601;
def median: sort | if length == 0 then null elif length % 2 == 1 then .[length / 2 | floor] else (.[length / 2 - 1] + .[length / 2]) / 2 end;
($from | t) as $f | ($to | t) as $e
| (($f - ($f % 3600)) + 23 * 60 | if . < $f then . + 3600 else . end) as $first
| [range($first; $e; 3600)] as $slots
| .workflow_runs as $runs
| ["ludion-php", "ludion-npm"] | map(. as $w
  | [$slots[] as $s
      | ([$runs[] | select(.name == $w and .event == "schedule" and (.created_at | t) >= $s and (.created_at | t) < $s + 3600)]
         | sort_by(.created_at) | first) as $r
      | {slot: ($s | todateiso8601), state: (if $r then "ran" elif $s + 3600 > $e then "pending" else "missed" end),
         run: $r.id, created_at: $r.created_at, run_started_at: $r.run_started_at, conclusion: $r.conclusion,
         delay_seconds: (if $r then ($r.created_at | t) - $s else null end)}] as $rows
  | {workflow: $w, slots: $rows,
     ran: ([$rows[] | select(.state == "ran")] | length), missed: ([$rows[] | select(.state == "missed")] | length),
     pending: ([$rows[] | select(.state == "pending")] | length),
     median_delay_seconds: ([$rows[] | select(.state == "ran") | .delay_seconds] | median),
     max_delay_seconds: ([$rows[] | select(.state == "ran") | .delay_seconds] | max)})
