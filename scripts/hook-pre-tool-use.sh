#!/bin/bash
# anima - PreToolUse Hook
# Handles approval for Bash tools, activity logging for others

ANIMA_HOST="${ANIMA_HOST:-localhost}"
ANIMA_PORT="${ANIMA_PORT:-4317}"
TIMEOUT_MS="${ANIMA_TIMEOUT:-120000}"

# Read input from stdin
input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // empty' 2>/dev/null)
tool_input=$(echo "$input" | jq '.tool_input // {}' 2>/dev/null)

# Try to extract session_id from multiple sources
session_id=$(echo "$input" | jq -r '.session_id // empty' 2>/dev/null)

# Fallback: try environment variable
if [ -z "$session_id" ]; then
  session_id="${CLAUDE_CODE_SESSION_ID:-}"
fi

# Fallback: generate from timestamp + PID
if [ -z "$session_id" ]; then
  project=$(basename "$(pwd)" 2>/dev/null | tr -cd 'a-zA-Z0-9' | cut -c1-20)
  session_id="$(date +%s)-$$-${project}"
fi

cwd=$(pwd)

# Log activity before handling
curl -s -X POST "http://${ANIMA_HOST}:${ANIMA_PORT}/api/events" \
  -H "Content-Type: application/json" \
  -d "{
    \"adapter\": \"claude-code\",
    \"session_id\": \"$session_id\",
    \"cwd\": \"$cwd\",
    \"kind\": \"activity\",
    \"status\": \"working\",
    \"detail\": \"$tool_name starting\",
    \"ts\": $(date +%s)
  }" > /dev/null 2>&1

# Handle Bash tool - request approval
if [ "$tool_name" = "Bash" ]; then
  # Send approval request and wait for decision
  response=$(curl -s -X POST "http://${ANIMA_HOST}:${ANIMA_PORT}/api/approvals" \
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

  # Output decision to Claude Code hook spec
  if [ "$decision" = "allow" ]; then
    echo "$input" | jq '.hookSpecificOutput = {permissionDecision: "allow"}'
  elif [ "$decision" = "deny" ]; then
    echo "$input" | jq '.hookSpecificOutput = {permissionDecision: "deny", reason: "Denied via anima"}'
  else
    # Timeout or no response - pass through (let Claude Code standard prompts handle it)
    echo "$input"
  fi
else
  # Other tools - just log as activity
  curl -s -X POST "http://${ANIMA_HOST}:${ANIMA_PORT}/api/events" \
    -H "Content-Type: application/json" \
    -d "{
      \"adapter\": \"claude-code\",
      \"session_id\": \"$session_id\",
      \"cwd\": \"$cwd\",
      \"kind\": \"activity\",
      \"status\": \"working\",
      \"detail\": \"$tool_name\",
      \"ts\": $(date +%s)
    }" > /dev/null 2>&1

  echo "$input"
fi
