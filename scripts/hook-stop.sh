#!/bin/bash
# anima - Stop Hook
# Logs session completion

ANIMA_HOST="${ANIMA_HOST:-localhost}"
ANIMA_PORT="${ANIMA_PORT:-4317}"

# Read input from stdin
input=$(cat)

session_id=$(echo "$input" | jq -r '.session_id // empty' 2>/dev/null || echo "$(date +%s)-$$")
cwd=$(pwd)

# Log stop event
curl -s -X POST "http://${ANIMA_HOST}:${ANIMA_PORT}/api/events" \
  -H "Content-Type: application/json" \
  -d "{
    \"adapter\": \"claude-code\",
    \"session_id\": \"$session_id\",
    \"cwd\": \"$cwd\",
    \"kind\": \"stop\",
    \"status\": \"done\",
    \"ts\": $(date +%s)
  }" > /dev/null 2>&1

echo "$input"
