#!/bin/bash
# anima - PreToolUse Hook
#  - Bash: dangerous commands -> anima approval card; safe commands -> auto-allow
#          (so no Claude Code chat prompt for safe commands)
#  - AskUserQuestion / ExitPlanMode: Claude is now waiting for YOU -> show as
#          "入力待ち" on anima with the question text (not "動作中")
#  - Other tools: just log activity and pass through to normal permission flow

ANIMA_HOST="${ANIMA_HOST:-localhost}"
ANIMA_PORT="${ANIMA_PORT:-4317}"
TIMEOUT_MS="${ANIMA_TIMEOUT:-120000}"
API="http://${ANIMA_HOST}:${ANIMA_PORT}"

input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // empty' 2>/dev/null)
tool_input=$(echo "$input" | jq '.tool_input // {}' 2>/dev/null)

session_id=$(echo "$input" | jq -r '.session_id // empty' 2>/dev/null)
[ -z "$session_id" ] && session_id="${CLAUDE_CODE_SESSION_ID:-}"
if [ -z "$session_id" ]; then
  project=$(basename "$(pwd)" 2>/dev/null | tr -cd 'a-zA-Z0-9' | cut -c1-20)
  session_id="$(date +%s)-$$-${project}"
fi

cwd=$(pwd)

# Post a status event to anima (best-effort, never blocks the tool).
post_event() {
  local kind="$1" status="$2" detail="$3"
  local payload
  payload=$(jq -n \
    --arg s "$session_id" --arg c "$cwd" --arg k "$kind" \
    --arg st "$status" --arg d "$detail" \
    '{adapter:"claude-code", session_id:$s, cwd:$c, kind:$k, status:$st, detail:$d}')
  curl -s --max-time 3 -X POST "$API/api/events" \
    -H "Content-Type: application/json" -d "$payload" > /dev/null 2>&1
}

# --- 1. Tools that mean "Claude is waiting for YOUR response" ---
# These block on the user, so anima should show 入力待ち, not 動作中.
if [ "$tool_name" = "AskUserQuestion" ] || [ "$tool_name" = "ExitPlanMode" ]; then
  summary=$(echo "$input" | jq -r '
    (.tool_input.questions[0].question)
    // (.tool_input.plan | if type=="string" then (split("\n")[0]) else empty end)
    // "あなたの判断待ち"' 2>/dev/null | head -c 140)
  [ -z "$summary" ] && summary="あなたの判断待ち"
  post_event "notification" "awaiting-input" "❓ $summary"
  echo "$input"   # let the tool run; it blocks until you answer in Claude Code
  exit 0
fi

# --- 2. Normal activity (working) for everything else ---
post_event "activity" "working" "$tool_name starting"

# --- 3. Bash: dangerous -> approval card; safe -> auto-allow ---
if [ "$tool_name" = "Bash" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  CONFIG_FILE="$SCRIPT_DIR/../config/approval.json"
  cmd=$(echo "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)

  patterns=$(jq -r '.dangerous_patterns[]?' "$CONFIG_FILE" 2>/dev/null)
  if [ -z "$patterns" ]; then
    patterns=$'(^|[^a-zA-Z._-])rm([^a-zA-Z._-]|$)\n(^|[^a-zA-Z._-])sudo([^a-zA-Z._-]|$)\ngit[[:space:]]+push'
  fi

  needs_approval=0
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    if [[ "$cmd" =~ $p ]]; then needs_approval=1; break; fi
  done <<< "$patterns"

  if [ "$needs_approval" = "1" ]; then
    # Dangerous -> ask via anima and wait for the decision.
    response=$(curl -s -X POST "$API/api/approvals" \
      -H "Content-Type: application/json" \
      -d "{
        \"adapter\": \"claude-code\",
        \"session_id\": \"$session_id\",
        \"cwd\": \"$cwd\",
        \"tool_name\": \"$tool_name\",
        \"tool_input\": $tool_input,
        \"timeout_ms\": $TIMEOUT_MS
      }" 2>/dev/null)
    decision=$(echo "$response" | jq -r '.decision // "timeout"' 2>/dev/null)

    if [ "$decision" = "allow" ]; then
      jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"allow", permissionDecisionReason:"anima で許可"}}'
    elif [ "$decision" = "deny" ]; then
      jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"deny", permissionDecisionReason:"anima で拒否"}}'
    else
      # daemon down / timeout -> fall back to Claude Code's own prompt
      echo "$input"
    fi
  else
    # Safe command -> auto-allow so it runs without a chat prompt.
    jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"allow", permissionDecisionReason:"anima: 安全なコマンド（自動許可）"}}'
  fi
else
  # Non-Bash tools: log activity, defer to Claude Code's normal permissions.
  post_event "activity" "working" "$tool_name"
  echo "$input"
fi
