#!/bin/bash
# anima - PostToolUse Hook
# Logs tool completion

ANIMA_HOST="${ANIMA_HOST:-localhost}"
ANIMA_PORT="${ANIMA_PORT:-4317}"

# Read input from stdin
input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // empty' 2>/dev/null)
session_id=$(echo "$input" | jq -r '.session_id // empty' 2>/dev/null || echo "$(date +%s)-$$")
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
