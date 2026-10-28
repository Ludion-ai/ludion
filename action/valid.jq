# The judgement record's schema (.github/judge/record.ts), applied to the slurped artifact by comment.sh. A copy of
# judge-comment.yml's VALID. The text limit counts the four spaces the comment adds to each line, so the comment stays
# under GitHub's 65,536 characters.
def sha: type == "string" and length == 40 and test("^[0-9a-f]{40}$");
def time: type == "string" and (contains("\n") | not) and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?Z$");
def seconds: . == null or (type == "number" and . >= 0 and . < 86400);
def text($n): type == "string" and length + 4 * (split("\n") | length) <= $n;
length == 1 and (.[0] | type == "object"
  and (keys == ["base_sha", "finished_at", "head_sha", "job_seconds", "judge_exit_code", "judge_seconds", "judgement", "merge_sha", "pr", "reason", "schema", "started_at", "text", "verdict"])
  and .schema == 1
  and (.pr | type == "number" and . == floor and . >= 1 and . < 1000000000)
  and (.head_sha | sha) and (.base_sha | sha) and (.merge_sha | sha)
  and (.started_at | time) and (.finished_at | . == null or time)
  and (.verdict | IN("stop", "wait", "ready_except_build", "undecidable"))
  and (.judge_seconds | seconds) and (.job_seconds | seconds)
  and (.judge_exit_code | . == null or (type == "number" and . == floor))
  and (if .judgement == null
    then .verdict == "undecidable" and .text == null and (.reason | text(2000))
    else (.judgement | type == "object") and .judgement.verdict == .verdict and .reason == null and (.text | text(60000) and length > 0)
    end))
