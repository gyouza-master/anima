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

# Try to extract model from input or environment
model=$(echo "$input" | jq -r '.model // empty' 2>/dev/null)
model_name=$(echo "$input" | jq -r '.model_name // empty' 2>/dev/null)

# Fallback: try environment variables
if [ -z "$model" ]; then
  model="${CLAUDE_MODEL:-}"
fi
if [ -z "$model_name" ]; then
  model_name="${CLAUDE_MODEL_NAME:-Claude}"
fi

# Send session start event synchronously (with short timeout so a stopped
# daemon never blocks Claude Code startup). Must NOT be backgrounded: the hook
# process exits immediately after, which would kill an unfinished curl.
curl -s --max-time 3 -X POST "http://${ANIMA_HOST}:${ANIMA_PORT}/api/events" \
  -H "Content-Type: application/json" \
  -d "{
    \"adapter\": \"claude-code\",
    \"session_id\": \"$session_id\",
    \"cwd\": \"$cwd\",
    \"kind\": \"start\",
    \"detail\": \"Session started\",
    \"model\": \"${model:-claude-haiku}\",
    \"model_name\": \"${model_name:-Claude Haiku}\",
    \"ts\": $(date +%s)
  }" > /dev/null 2>&1

echo "$input"
