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

# Helper function to set hook
set_hook() {
  local hook_name="$1"
  local script_path="$2"

  # Use jq to safely update the JSON
  jq \
    --arg hook "$hook_name" \
    --arg path "$script_path" \
    '.hooks[$hook] = {command: $path, shell: "bash"}' \
    "$SETTINGS_LOCAL" > "$SETTINGS_LOCAL.tmp" && mv "$SETTINGS_LOCAL.tmp" "$SETTINGS_LOCAL"
}

# Register hooks
echo "Registering hooks..."
set_hook "SessionStart" "$HOOKS_DIR/hook-start.sh"
set_hook "PreToolUse" "$HOOKS_DIR/hook-pre-tool-use.sh"
set_hook "PostToolUse" "$HOOKS_DIR/hook-post-tool-use.sh"
set_hook "Notification" "$HOOKS_DIR/hook-notification.sh"
set_hook "Stop" "$HOOKS_DIR/hook-stop.sh"

echo "✓ anima hooks installed successfully"
echo ""
echo "Next steps:"
echo "1. Start the anima daemon: npm start (in $SCRIPT_DIR)"
echo "2. Open http://localhost:4317 in your browser to see the control tower"
echo ""
