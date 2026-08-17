#!/bin/bash
# anima - PostToolUse Hook
# Logs tool completion

ANIMA_HOST="${ANIMA_HOST:-localhost}"
ANIMA_PORT="${ANIMA_PORT:-4317}"

# Read input from stdin
input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // empty' 2>/dev/null)
session_id=$(echo "$input" | jq -r '.session_id // empty' 2>/dev/null)

if [ -z "$session_id" ]; then
  session_id="${CLAUDE_CODE_SESSION_ID:-}"
fi

if [ -z "$session_id" ]; then
  project=$(basename "$(pwd)" 2>/dev/null | tr -cd 'a-zA-Z0-9' | cut -c1-20)
  session_id="$(date +%s)-$$-${project}"
fi

cwd=$(pwd)

# Log completion
curl -s -X POST "http://${ANIMA_HOST}:${ANIMA_PORT}/api/events" \
  -H "Content-Type: application/json" \
  -d "{
    \"adapter\": \"claude-code\",
    \"session_id\": \"$session_id\",
    \"cwd\": \"$cwd\",
    \"kind\": \"activity\",
    \"status\": \"working\",
    \"detail\": \"$tool_name completed\",
    \"ts\": $(date +%s)
  }" > /dev/null 2>&1

echo "$input"
