#!/bin/bash
# anima - UserPromptSubmit Hook
# Fires when YOU send a message. Resets the "waiting for your reply" timer.

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

# Send prompt event (resets timer, marks session as working)
curl -s --max-time 3 -X POST "http://${ANIMA_HOST}:${ANIMA_PORT}/api/events" \
  -H "Content-Type: application/json" \
  -d "{
    \"adapter\": \"claude-code\",
    \"session_id\": \"$session_id\",
    \"cwd\": \"$cwd\",
    \"kind\": \"prompt\",
    \"ts\": $(date +%s)
  }" > /dev/null 2>&1

echo "$input"
