#!/bin/bash
# anima - Installation Script
# Registers anima hooks with Claude Code configuration

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$SCRIPT_DIR/scripts"

# Detect Claude Code configuration directory
if [ -d "$HOME/.claude" ]; then
  CLAUDE_CONFIG_DIR="$HOME/.claude"
elif [ -d "$HOME/Library/Application Support/Claude Code" ]; then
  CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Claude Code"
else
  echo "Error: Claude Code configuration directory not found"
  exit 1
fi

# Settings files
SETTINGS_LOCAL="$CLAUDE_CONFIG_DIR/settings.local.json"

echo "Installing anima hooks into Claude Code..."
echo "Configuration directory: $CLAUDE_CONFIG_DIR"

# Create settings.local.json if it doesn't exist
if [ ! -f "$SETTINGS_LOCAL" ]; then
  mkdir -p "$CLAUDE_CONFIG_DIR"
  echo '{}' > "$SETTINGS_LOCAL"
fi

# Register hooks using the correct Claude Code format:
#   "HookEvent": [ { "matcher": "...", "hooks": [ { "type": "command", "command": "..." } ] } ]
# SessionStart / Notification / Stop take no matcher; PreToolUse / PostToolUse match all tools.
echo "Registering hooks..."
jq \
  --arg start "$HOOKS_DIR/hook-start.sh" \
  --arg prompt "$HOOKS_DIR/hook-user-prompt.sh" \
  --arg pre "$HOOKS_DIR/hook-pre-tool-use.sh" \
  --arg post "$HOOKS_DIR/hook-post-tool-use.sh" \
  --arg notif "$HOOKS_DIR/hook-notification.sh" \
  --arg stop "$HOOKS_DIR/hook-stop.sh" \
  '.hooks = {
    SessionStart:     [ { hooks: [ { type: "command", command: $start } ] } ],
    UserPromptSubmit: [ { hooks: [ { type: "command", command: $prompt } ] } ],
    PreToolUse:       [ { matcher: "", hooks: [ { type: "command", command: $pre } ] } ],
    PostToolUse:      [ { matcher: "", hooks: [ { type: "command", command: $post } ] } ],
    Notification:     [ { hooks: [ { type: "command", command: $notif } ] } ],
    Stop:             [ { hooks: [ { type: "command", command: $stop } ] } ]
  }' \
  "$SETTINGS_LOCAL" > "$SETTINGS_LOCAL.tmp" && mv "$SETTINGS_LOCAL.tmp" "$SETTINGS_LOCAL"

echo "✓ anima hooks installed successfully"
echo ""
echo "Next steps:"
echo "1. Start the anima daemon: npm start (in $SCRIPT_DIR)"
echo "2. Open http://localhost:4317 in your browser to see the control tower"
echo ""
