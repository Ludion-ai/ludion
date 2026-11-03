# Runs in Docker (jq 1.7.1, no network) with -c, on each saved list of ludion-trial's PRs: PR 7's body does not belong in a public record.
map(if .number == 7 then .body = "[removed: operational text not for the public record]" else . end)
