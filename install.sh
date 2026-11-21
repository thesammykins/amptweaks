#!/bin/zsh
# One-line install / update:  curl -fsSL https://raw.githubusercontent.com/thesammykins/amptweaks/main/install.sh | zsh
set -euo pipefail

REPO=${AMP_TWEAKS_REPO:-https://github.com/thesammykins/amptweaks.git}
APP="${AMP_TWEAKS_HOME:-$HOME/Library/Application Support/amp-tweaks}/app"

[[ $(uname) == Darwin ]] || { print "amp-tweaks is macOS-only"; exit 1; }
command -v git >/dev/null || { print "amp-tweaks needs git: xcode-select --install"; exit 1; }
if ! command -v mitmdump >/dev/null; then
  command -v brew >/dev/null || { print "amp-tweaks needs mitmproxy: install Homebrew (https://brew.sh), then run this again"; exit 1; }
  print "installing mitmproxy…"
  brew install mitmproxy
fi

if [[ -d "$APP/.git" ]]; then
  git -C "$APP" pull --ff-only --quiet
else
  mkdir -p "${APP:h}"
  git clone --quiet --depth 1 "$REPO" "$APP"
fi

exec "$APP/bin/amp-tweaks" enable
