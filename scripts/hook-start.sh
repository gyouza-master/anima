#!/bin/bash
# anima - Session Start Hook
# Registers a new session with the anima daemon

ANIMA_HOST="${ANIMA_HOST:-localhost}"
ANIMA_PORT="${ANIMA_PORT:-4317}"

# Read input from stdin
input=$(cat)

# Try to extract session_id from multiple sources
session_id=$(echo "$input" | jq -r '.session_id // empty' 2>/dev/null)

# Fallback: try environment variable
if [ -z "$session_id" ]; then
  session_id="${CLAUDE_CODE_SESSION_ID:-}"
fi

# Fallback: generate from timestamp + PID + project
if [ -z "$session_id" ]; then
  project=$(basename "$(pwd)" 2>/dev/null | tr -cd 'a-zA-Z0-9' | cut -c1-20)
  session_id="$(date +%s)-$$-${project}"
fi

cwd=$(pwd)

# Retry logic for daemon availability
send_event() {
  local attempt=1
  local max_attempts=3
  while [ $attempt -le $max_attempts ]; do
    response=$(curl -s -X POST "http://${ANIMA_HOST}:${ANIMA_PORT}/api/events" \
      -H "Content-Type: application/json" \
      -d "{
        \"adapter\": \"claude-code\",
        \"session_id\": \"$session_id\",
        \"cwd\": \"$cwd\",
        \"kind\": \"start\",
        \"detail\": \"Session started\",
        \"ts\": $(date +%s)
      }" 2>/dev/null)

    if echo "$response" | grep -q '"ok"'; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 0.5
  done
  return 1
}

# Send session start event (non-blocking)
send_event &

echo "$input"
