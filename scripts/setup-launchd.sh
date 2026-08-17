#!/bin/bash
# anima - LaunchAgent Setup
# Registers anima daemon for auto-start on login

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_TEMPLATE="$SCRIPT_DIR/com.anima.daemon.plist"
PLIST_NAME="com.anima.daemon.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME"
LOG_DIR="$HOME/Library/Logs/anima"

# Check for node
if ! command -v node &> /dev/null; then
  echo "Error: node is not installed"
  exit 1
fi

# Get node path
NODE_PATH=$(which node)

echo "Setting up anima for auto-start..."
echo "Installation path: $SCRIPT_DIR"
echo "Node path: $NODE_PATH"

# Create log directory
mkdir -p "$LOG_DIR"

# Create LaunchAgents directory if needed
mkdir -p "$HOME/Library/LaunchAgents"

# Process plist template and install
cat "$PLIST_TEMPLATE" | \
  sed "s|{{INSTALL_PATH}}|$SCRIPT_DIR|g" | \
  sed "s|{{HOME}}|$HOME|g" | \
  sed "s|/usr/local/bin/node|$NODE_PATH|g" > "$PLIST_DEST"

# Load the agent
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

echo "✓ anima daemon registered for auto-start"
echo ""
echo "Verify installation:"
echo "  launchctl list | grep com.anima.daemon"
echo ""
echo "View logs:"
echo "  tail -f $LOG_DIR/daemon.log"
echo ""
