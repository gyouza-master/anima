#!/bin/bash
# anima - Notification Hook
# Logs when user input or approval is waiting

ANIMA_HOST="${ANIMA_HOST:-localhost}"
ANIMA_PORT="${ANIMA_PORT:-4317}"

# Read input from stdin
input=$(cat)

session_id=$(echo "$input" | jq -r '.session_id // empty' 2>/dev/null)

if [ -z "$session_id" ]; then
  session_id="${CLAUDE_CODE_SESSION_ID:-}"
fi

if [ -z "$session_id" ]; then
  project=$(basename "$(pwd)" 2>/dev/null | tr -cd 'a-zA-Z0-9' | cut -c1-20)
  session_id="$(date +%s)-$$-${project}"
fi

cwd=$(pwd)
message=$(echo "$input" | jq -r '.message // "Waiting for input"' 2>/dev/null)

# Log notification event
curl -s -X POST "http://${ANIMA_HOST}:${ANIMA_PORT}/api/events" \
  -H "Content-Type: application/json" \
  -d "{
    \"adapter\": \"claude-code\",
    \"session_id\": \"$session_id\",
    \"cwd\": \"$cwd\",
    \"kind\": \"notification\",
    \"status\": \"awaiting-input\",
    \"detail\": \"$message\",
    \"ts\": $(date +%s)
  }" > /dev/null 2>&1

echo "$input"
