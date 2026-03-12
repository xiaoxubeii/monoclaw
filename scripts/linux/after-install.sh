#!/bin/bash

# Post-installation script for Monoclaw on Linux

set -e

# Update desktop database
if command -v update-desktop-database &> /dev/null; then
    update-desktop-database -q /usr/share/applications || true
fi

# Update icon cache
if command -v gtk-update-icon-cache &> /dev/null; then
    gtk-update-icon-cache -q /usr/share/icons/hicolor || true
fi

# Create symbolic link for Monoclaw app binary
if [ -x /opt/Monoclaw/monoclaw ]; then
    ln -sf /opt/Monoclaw/monoclaw /usr/local/bin/monoclaw 2>/dev/null || true
fi

# Create symbolic link for openclaw CLI
OPENCLAW_WRAPPER="/opt/Monoclaw/resources/cli/openclaw"
if [ -f "$OPENCLAW_WRAPPER" ]; then
    chmod +x "$OPENCLAW_WRAPPER" 2>/dev/null || true
    ln -sf "$OPENCLAW_WRAPPER" /usr/local/bin/openclaw 2>/dev/null || true
fi

echo "Monoclaw has been installed successfully."
