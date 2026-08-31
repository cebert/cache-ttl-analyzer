#!/usr/bin/env bash
# WP-06 — enact the scenario sessions that become real captures (docs/PLAN.md
# WP-06, kind 2) by driving `claude -p` under a controlled prompt-cache TTL.
#
# Each scenario runs in its OWN throwaway working directory: Claude Code's
# cache is scoped to machine + directory, so two scenarios sharing a
# directory would read each other's cache and corrupt both captures. The
# directories hold a tiny read-only toy project so tool calls have something
# to look at; only read tools are allowed, so nothing outside is touched.
#
# Scenarios (all on the main-conversation bucket, `CLAUDE_CODE_PROMPT_CACHE_TTL`):
#   tight-loop-5m   5m TTL, 8 back-to-back turns             → 5m should win
#   gap-heavy-1h    1h TTL, turns separated by 6m / 8m / 12m  → 1h should win (shortening path)
#   gap-heavy-5m    5m TTL, the same gaps                      → real expiries in the log; 1h should win (lengthening path)
#   model-switch    1h TTL, opus-5 → sonnet-5, then effort high → medium  → hard resets
#
# The two gap-heavy scenarios run concurrently (~28 min wall clock); the
# others take a couple of minutes each. Total ≈ 35 minutes.
#
# Usage:  scripts/capture-scenarios.sh [probe|all|<scenario>]
#   probe  — one 5m turn, then prints the cache_creation split so you can
#            confirm the env var is honored before spending a full run.
# Output: session ids and log paths are written to $OUT/summary.txt; run
# scripts/scrub-capture.py on each log afterwards.

set -euo pipefail

OUT="${CAPTURE_OUT:-${TMPDIR:-/tmp}/cache-ttl-captures}"
PROJECTS="$HOME/.claude/projects"
MODEL_A="claude-opus-5"
MODEL_B="claude-sonnet-5"
TOOLS="Read,Glob,Grep"
mkdir -p "$OUT"
SUMMARY="$OUT/summary.txt"

log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$OUT/run.log" >&2; }

# A tiny toy project, identical for every scenario.
make_project() {
  local dir="$1"
  mkdir -p "$dir/src" "$dir/tests"
  cat >"$dir/README.md" <<'EOF'
# tinycache

A toy in-memory LRU cache with TTL support. Used as a fixture project for
cache-ttl-analyzer scenario captures; nothing here is real.
EOF
  cat >"$dir/src/lru.py" <<'EOF'
"""A small LRU cache with per-entry TTL."""
import time
from collections import OrderedDict


class LRU:
    def __init__(self, capacity=128, ttl_seconds=300):
        self.capacity = capacity
        self.ttl = ttl_seconds
        self._d = OrderedDict()

    def get(self, key):
        item = self._d.get(key)
        if item is None:
            return None
        value, expires = item
        if expires < time.monotonic():
            del self._d[key]  # TODO: count expirations
            return None
        self._d.move_to_end(key)
        return value

    def put(self, key, value):
        self._d[key] = (value, time.monotonic() + self.ttl)
        self._d.move_to_end(key)
        while len(self._d) > self.capacity:
            self._d.popitem(last=False)

    def stats(self):
        # TODO: hits / misses / expirations
        return {"size": len(self._d)}
EOF
  cat >"$dir/src/cli.py" <<'EOF'
"""CLI: tinycache put KEY VALUE | get KEY"""
import sys
from lru import LRU

cache = LRU()


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    cmd, *rest = argv
    if cmd == "put" and len(rest) == 2:
        cache.put(rest[0], rest[1])
        return 0
    if cmd == "get" and len(rest) == 1:
        v = cache.get(rest[0])
        print("" if v is None else v)
        return 0 if v is not None else 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
EOF
  cat >"$dir/tests/test_lru.py" <<'EOF'
from src.lru import LRU


def test_put_get():
    c = LRU(capacity=2)
    c.put("a", 1)
    assert c.get("a") == 1


def test_evicts_oldest():
    c = LRU(capacity=2)
    c.put("a", 1)
    c.put("b", 2)
    c.put("c", 3)
    assert c.get("a") is None
EOF
}

# turn SCENARIO_DIR SESSION_ID TTL MODEL EFFORT FIRST(1|0) PROMPT
turn() {
  local dir="$1" sid="$2" ttl="$3" model="$4" effort="$5" first="$6" prompt="$7"
  local args=(-p --model "$model" --effort "$effort" --allowedTools "$TOOLS" --output-format json)
  if [[ "$first" == 1 ]]; then args+=(--session-id "$sid"); else args+=(--resume "$sid"); fi
  log "[$(basename "$dir")] turn (ttl=$ttl model=$model effort=$effort): ${prompt:0:60}…"
  (
    cd "$dir"
    CLAUDE_CODE_PROMPT_CACHE_TTL="$ttl" claude "${args[@]}" "$prompt" \
      >>"$OUT/$(basename "$dir").turns.jsonl" 2>>"$OUT/$(basename "$dir").stderr.log" || true
  )
}

session_log() {
  # Claude Code writes ~/.claude/projects/<cwd-slug>/<session-id>.jsonl
  find "$PROJECTS" -maxdepth 2 -name "$1.jsonl" 2>/dev/null | head -1
}

record() {
  local name="$1" sid="$2"
  local path
  path="$(session_log "$sid")"
  printf '%s\t%s\t%s\n' "$name" "$sid" "${path:-NOT FOUND}" | tee -a "$SUMMARY" >&2
}

new_sid() { uuidgen | tr 'A-Z' 'a-z'; }

PROMPTS=(
  "Read README.md and every file under src/ and tests/, then summarize the module structure in three bullets."
  "List every TODO comment in the project with its file and line."
  "Which function name is least clear? Propose a better one and say why, in two sentences."
  "Does test_evicts_oldest actually prove LRU ordering? Answer yes or no with one sentence of reasoning."
  "Describe, in one paragraph, what happens when get() is called on an expired key."
  "Suggest one additional unit test for the TTL behavior, as a short Python snippet."
  "Is there any bug in cli.py's argument handling? One sentence."
  "Give a one-line summary of this project suitable for a package description."
)

scenario_probe() {
  local dir="$OUT/probe"; make_project "$dir"
  local sid; sid="$(new_sid)"
  turn "$dir" "$sid" 5m "$MODEL_A" medium 1 "${PROMPTS[7]}"
  record probe "$sid"
  local path; path="$(session_log "$sid")"
  log "probe cache_creation split:"
  grep -o '"cache_creation":{[^}]*}' "$path" | sort | uniq -c >&2 || log "no assistant usage found"
}

scenario_tight_loop_5m() {
  local dir="$OUT/tight-loop-5m"; make_project "$dir"
  local sid; sid="$(new_sid)"
  local first=1
  for p in "${PROMPTS[@]}"; do
    turn "$dir" "$sid" 5m "$MODEL_A" medium "$first" "$p"
    first=0
  done
  record tight-loop-5m "$sid"
}

# gap_heavy NAME TTL — four turns separated by 6m, 8m and 12m.
gap_heavy() {
  local name="$1" ttl="$2"
  local dir="$OUT/$name"; make_project "$dir"
  local sid; sid="$(new_sid)"
  turn "$dir" "$sid" "$ttl" "$MODEL_A" medium 1 "${PROMPTS[0]}"
  sleep 360
  turn "$dir" "$sid" "$ttl" "$MODEL_A" medium 0 "${PROMPTS[1]}"
  sleep 480
  turn "$dir" "$sid" "$ttl" "$MODEL_A" medium 0 "${PROMPTS[2]}"
  sleep 720
  turn "$dir" "$sid" "$ttl" "$MODEL_A" medium 0 "${PROMPTS[4]}"
  record "$name" "$sid"
}

scenario_model_switch() {
  local dir="$OUT/model-switch"; make_project "$dir"
  local sid; sid="$(new_sid)"
  turn "$dir" "$sid" 1h "$MODEL_A" high 1 "${PROMPTS[0]}"
  turn "$dir" "$sid" 1h "$MODEL_A" high 0 "${PROMPTS[1]}"
  turn "$dir" "$sid" 1h "$MODEL_B" high 0 "${PROMPTS[2]}"
  turn "$dir" "$sid" 1h "$MODEL_B" high 0 "${PROMPTS[3]}"
  turn "$dir" "$sid" 1h "$MODEL_B" medium 0 "${PROMPTS[5]}"
  turn "$dir" "$sid" 1h "$MODEL_B" medium 0 "${PROMPTS[7]}"
  record model-switch "$sid"
}

case "${1:-all}" in
  probe) scenario_probe ;;
  tight-loop-5m) scenario_tight_loop_5m ;;
  gap-heavy-1h) gap_heavy gap-heavy-1h 1h ;;
  gap-heavy-5m) gap_heavy gap-heavy-5m 5m ;;
  model-switch) scenario_model_switch ;;
  all)
    : >"$SUMMARY"
    scenario_tight_loop_5m
    gap_heavy gap-heavy-1h 1h &
    gap_heavy gap-heavy-5m 5m &
    scenario_model_switch
    wait
    log "done — see $SUMMARY"
    ;;
  *) echo "unknown scenario: $1" >&2; exit 2 ;;
esac
