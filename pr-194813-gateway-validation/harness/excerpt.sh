#!/usr/bin/env bash
# Print redacted compaction/fallback log lines for one run dir (session keys, run ids, hostnames removed).
set -euo pipefail
dir="$1"
jq -r '
  select(.raw | test("compaction-diag|model fallback|compaction-safeguard|preflight compaction|status=429")) |
  if .fields and (.fields.event == "model_fallback_decision") then
    "[model-fallback/decision] decision=\(.fields.decision) candidate=\(.fields.candidateProvider)/\(.fields.candidateModel)" +
    (if .fields.reason then " reason=\(.fields.reason) status=\(.fields.status) code=\(.fields.code)" else "" end) +
    (if .fields.nextCandidateProvider then " next=\(.fields.nextCandidateProvider)/\(.fields.nextCandidateModel)" else "" end) +
    " outcome=\(.fields.fallbackStepFinalOutcome)"
  else
    "[\(.sub)] \(.msg)"
  end' "$dir/gateway-log-matches.jsonl" |
  sed -E 's/ sessionKey=("[^"]*"|[^ ]+)//g; s/ runId=("[^"]*"|[^ ]+)//g; s/ requestId=("[^"]*"|[^ ]+)//g; s/ diagId=[^ ]+//g; s/ httpRequestId=[^ ]+//g; s/ dispatcher=[^ ]+//g; s/ elapsedMs=[0-9]+//g; s/ durationMs=[0-9]+//g' |
  awk '!($0 ~ /\[provider-error\]/)' | uniq -c | sed -E 's/^ +1 /      /; s/^ +([0-9]+) /  (x\1) /'
