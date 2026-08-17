#!/bin/bash
# anima - Session Start Hook
# Registers a new session with the anima daemon

ANIMA_HOST="${ANIMA_HOST:-localhost}"
ANIMA_PORT="${ANIMA_PORT:-4317}"

# Read input from stdin
input=$(cat)

# Extract session_id and cwd from Claude Code context
session_id=$(echo "$input" | jq -r '.session_id // empty' 2>/dev/null || echo "$(date +%s)-$$")
cwd=$(pwd)

# Send session start event
curl -s -X POST "http://${ANIMA_HOST}:${ANIMA_PORT}/api/events" \
  -H "Content-Type: application/json" \
  -d "{
    \"adapter\": \"claude-code\",
    \"session_id\": \"$session_id\",
    \"cwd\": \"$cwd\",
    \"kind\": \"start\",
    \"ts\": $(date +%s)
  }" > /dev/null 2>&1

echo "$input"
