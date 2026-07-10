#!/usr/bin/env bash
# T029 scoped A/B for SPEC-003 (Hybrid Semantic Search).
#
# WHY a bespoke harness and not scripts/agent-eval/ab-new-vs-baseline.sh
# verbatim: that script (a) rsyncs the target EXCLUDING .codegraph and re-runs
# `codegraph init` with NO embedding env, so the copy carries ZERO vectors, and
# (b) spawns the daemon with no endpoint env. Under both conditions SPEC-003's
# hybrid path is DORMANT in *both* arms (Constitution VII) -> a null A/B that
# proves nothing about the feature. This harness keeps the methodology identical
# (pre-warmed persistent daemon, CODEGRAPH_WASM_RELAUNCHED=1 fast attach, Sonnet
# floor, >=2 runs/arm, judge by parse-run.mjs "by type") but:
#   * copies the already-embedded .codegraph (relative paths -> vectors survive),
#   * sources the private embedding endpoint into the daemon env so the NL query
#     is embedded at query time (the semantic arm actually runs),
#   * uses the worktree build as NEW and the main-checkout build as BASELINE
#     (main == pre-SPEC-003), avoiding any src checkout gymnastics.
# schema.sql is byte-identical between the two builds (schema v8), so both read
# the same DB with no migration.
#
# Usage: ab-spec003.sh <experimental|control> <runs-per-arm>
set -uo pipefail

MODE="${1:?usage: ab-spec003.sh <experimental|control> <runs-per-arm>}"
RUNS="${2:?runs-per-arm required}"

MAIN=/Users/fredrickgabelmann/Documents/Business_Documents/RSE_Documents/Projects/codegraph
WT="$MAIN/.worktrees/003-hybrid-semantic-search"
NEW_BIN="$WT/dist/bin/codegraph.js"        # SPEC-003 build
BASE_BIN="$MAIN/dist/bin/codegraph.js"     # pre-SPEC-003 (main) build
PARSE="$WT/scripts/agent-eval/parse-run.mjs"
ENVRC="$MAIN/.envrc.local"
OUT="/tmp/ab-spec003/$MODE"
TASK="Locate the part of this codebase that decides, at runtime, which mechanism is used to turn source code into numeric vector representations when more than one option is configured, and explain the order of precedence it applies. Do not modify any files; report your findings only."

command -v claude >/dev/null || { echo "claude CLI not on PATH"; exit 1; }

rm -rf "$OUT"; mkdir -p "$OUT"
echo "###### MODE=$MODE RUNS=$RUNS"
echo "###### NEW=$NEW_BIN"
echo "###### BASE=$BASE_BIN"
echo "###### TASK=$TASK"
echo

# --- build the two working copies (agent Reads/greps these) -----------------
make_copy() { # dest
  local dest="$1"
  rm -rf "$dest"; mkdir -p "$dest"
  rsync -a --exclude node_modules --exclude .git --exclude dist \
        --exclude '.codegraph/daemon.*' --exclude '.codegraph/*-wal' \
        --exclude '.codegraph/*-shm' --exclude '.codegraph/*.sock' \
        --exclude '.codegraph/graph.db' \
        "$MAIN/.codegraph" "$MAIN/src" "$MAIN/package.json" "$dest/" 2>/dev/null
}
echo "== preparing copies =="
make_copy "$OUT/t-new"
cp -R "$OUT/t-new" "$OUT/t-base"
V_NEW=$(node -e 'const {DatabaseSync}=require("node:sqlite");console.log(new DatabaseSync(process.argv[1]).prepare("select count(*) c from node_vectors").get().c)' "$OUT/t-new/.codegraph/codegraph.db" 2>/dev/null)
echo "  vectors in copies: $V_NEW"

if [ "$MODE" = control ]; then
  # No-vectors control: strip vectors so hybrid is dormant -> expect zero delta.
  for d in t-new t-base; do
    node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1]);db.exec("DELETE FROM node_vectors");' "$OUT/$d/.codegraph/codegraph.db" 2>/dev/null
  done
  V_CTRL=$(node -e 'const {DatabaseSync}=require("node:sqlite");console.log(new DatabaseSync(process.argv[1]).prepare("select count(*) c from node_vectors").get().c)' "$OUT/t-new/.codegraph/codegraph.db" 2>/dev/null)
  echo "  control vectors after strip: $V_CTRL (expect 0)"
fi
echo

# Source the endpoint env for the experimental arms only (control stays dormant).
if [ "$MODE" = experimental ]; then
  set -a; . "$ENVRC"; set +a
  echo "  embedding endpoint env sourced (names: CODEGRAPH_EMBEDDING_URL/MODEL/DIMS...)"
fi

prewarm() { # bin, target
  local bin="$1" tgt="$2"
  pkill -9 -f "serve --mcp --path $tgt" 2>/dev/null
  CODEGRAPH_WASM_RELAUNCHED=1 CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS=1800000 \
    node "$bin" serve --mcp --path "$tgt" </dev/null >"$OUT/daemon-$(basename "$tgt").log" 2>&1 &
  node -e 'const fs=require("fs");let n=0;const t=setInterval(()=>{if(fs.existsSync(process.argv[1]+"/.codegraph/daemon.sock")){clearInterval(t);process.exit(0)}if(n++>200){clearInterval(t);process.exit(1)}},100)' "$tgt" \
    && echo "    daemon warm: $tgt" || echo "    WARN: daemon never bound for $tgt"
}

run_arm() { # label, bin, target
  local label="$1" bin="$2" tgt="$3" c="$OUT/mcp-$1.json"
  printf '{"mcpServers":{"codegraph":{"command":"env","args":["CODEGRAPH_WASM_RELAUNCHED=1","node","%s","serve","--mcp","--path","%s"]}}}' "$bin" "$tgt" > "$c"
  for i in $(seq 1 "$RUNS"); do
    prewarm "$bin" "$tgt"
    echo "############## ARM [$label] run $i ##############"
    ( cd "$tgt" && claude -p "$TASK" \
        --output-format stream-json --verbose --permission-mode bypassPermissions \
        --model "${MODEL:-sonnet}" --effort "${EFFORT:-high}" --max-budget-usd 4 \
        --strict-mcp-config --mcp-config "$c" \
        </dev/null > "$OUT/run-$label-$i.jsonl" 2>"$OUT/run-$label-$i.err" )
    node "$PARSE" "$OUT/run-$label-$i.jsonl" 2>&1 | grep -E "by type|Result|exposed" \
      || echo "  (parse failed — see $OUT/run-$label-$i.jsonl and .err)"
    pkill -9 -f "serve --mcp --path $tgt" 2>/dev/null
    echo
  done
}

run_arm new  "$NEW_BIN"  "$OUT/t-new"
run_arm base "$BASE_BIN" "$OUT/t-base"

echo "###### DONE ($MODE). Logs: $OUT"
