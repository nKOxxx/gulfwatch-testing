#!/usr/bin/env bash
# Install Gulf Watch desktop launcher icon for the current user.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHER="$REPO_ROOT/scripts/launch-gulfwatch.sh"
ICON_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/gulfwatch"
DESKTOP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP_FILE="$DESKTOP_DIR/gulfwatch.desktop"

mkdir -p "$ICON_DIR" "$DESKTOP_DIR"
chmod +x "$LAUNCHER"

ICON_SOURCE="$REPO_ROOT/public/Tactical radar logo with Arabian Peninsula.png"
if [[ -f "$ICON_SOURCE" ]]; then
    cp "$ICON_SOURCE" "$ICON_DIR/gulfwatch.png"
    ICON_PATH="$ICON_DIR/gulfwatch.png"
elif [[ -f "$REPO_ROOT/public/icons/icon-192.svg" ]]; then
    cp "$REPO_ROOT/public/icons/icon-192.svg" "$ICON_DIR/gulfwatch.svg"
    ICON_PATH="$ICON_DIR/gulfwatch.svg"
else
    cp "$REPO_ROOT/public/favicon.ico" "$ICON_DIR/gulfwatch.ico"
    ICON_PATH="$ICON_DIR/gulfwatch.ico"
fi

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Name=Gulf Watch
Comment=Middle East geopolitical intelligence dashboard
Exec=$LAUNCHER
Icon=$ICON_PATH
Terminal=false
Type=Application
Categories=Network;Utility;
StartupNotify=true
Keywords=gulf;watch;intelligence;middle-east;
EOF

chmod +x "$DESKTOP_FILE"

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi

echo "Installed desktop launcher:"
echo "  $DESKTOP_FILE"
echo "Launch from your app menu as 'Gulf Watch', or run:"
echo "  $LAUNCHER"