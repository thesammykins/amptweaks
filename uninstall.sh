#!/bin/zsh
# One-line uninstall:  curl -fsSL https://raw.githubusercontent.com/thesammykins/amptweaks/main/uninstall.sh | zsh
set -euo pipefail

CLI=$(command -v amp-tweaks || true)
[[ -n $CLI ]] || CLI="${AMP_TWEAKS_HOME:-$HOME/Library/Application Support/amp-tweaks}/app/bin/amp-tweaks"
[[ -x $CLI ]] || { print "amp-tweaks isn't installed"; exit 0; }
exec "$CLI" uninstall
