#!/usr/bin/env bash
# Sets Grok Shorts up on this computer, or checks that it's set up, so it's safe to run before every video: it takes a
# few seconds once everything's there. What's missing is downloaded into a bin folder next to the checkout, in
# /workspace when there is one, which a Grok Bot computer keeps when it's recreated, unlike packages installed the usual
# way. It ends by printing JSON with the path of the `shorts` command to run, which works from any folder.
set -euo pipefail

app="$(cd "$(dirname "$0")/../typescript" && pwd)"
root="${GROK_SHORTS_HOME:-$([ -d /workspace ] && [ -w /workspace ] && echo /workspace || echo "$HOME/.grok-shorts")}"
bin="$root/bin"
mkdir -p "$bin"
export PATH="$bin:$root/node/bin:$PATH"

case "$(uname -s)" in Linux) os=linux ;; Darwin) os=darwin ;; *) echo "Grok Shorts sets itself up on Linux and macOS." >&2; exit 1 ;; esac
case "$(uname -m)" in x86_64 | amd64) arch=x64 ;; aarch64 | arm64) arch=arm64 ;; *) echo "Unknown processor: $(uname -m)" >&2; exit 1 ;; esac
say() { echo "$*" >&2; }
# Downloads to a file, trying again when the connection drops, so a download cut short fails here, not while unpacking.
fetch() { curl -fsSL --retry 4 --retry-all-errors --connect-timeout 20 -o "$2" "$1"; }
# Unpacks an .xz archive, with Python's lzma when the computer has no xz.
unxz() {
  if command -v xz >/dev/null; then tar -xJf "$1" -C "$2"; else python3 -c "import lzma, sys; sys.stdout.buffer.write(lzma.open(sys.argv[1]).read())" "$1" | tar -x -C "$2"; fi
}
# Runs a command as root, with sudo when this isn't root and sudo works without a password.
as_root() { if [ "$(id -u)" = 0 ]; then "$@"; elif sudo -n true 2>/dev/null; then sudo "$@"; else return 1; fi; }
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

# Node 22.13 or later, for TypeScript without a build step.
node_ok() { command -v node >/dev/null && node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)'; }
if ! node_ok; then
  say "Downloading Node 24"
  base="https://nodejs.org/dist/latest-v24.x"
  fetch "$base/SHASUMS256.txt" "$scratch/sums"
  fetch "$base/$(grep -o "node-v[0-9.]*-$os-$arch.tar.gz" "$scratch/sums" | head -1)" "$scratch/node.tar.gz"
  rm -rf "$root/node" && mkdir -p "$root/node"
  tar -xzf "$scratch/node.tar.gz" -C "$root/node" --strip-components 1
fi

# ffmpeg and ffprobe cut, key, mix, and encode every video. On Linux, a static build from GitHub goes in the bin folder,
# or, if it can't be downloaded, the system's ffmpeg is installed, which lasts until the computer is recreated.
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  if [ "$os" = linux ]; then
    say "Downloading ffmpeg"
    build="$([ "$arch" = x64 ] && echo linux64 || echo linuxarm64)"
    if fetch "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-$build-gpl.tar.xz" "$scratch/ffmpeg.tar.xz"; then
      unxz "$scratch/ffmpeg.tar.xz" "$scratch"
      mv "$scratch"/ffmpeg-*/bin/ffmpeg "$scratch"/ffmpeg-*/bin/ffprobe "$bin/"
    elif command -v apt-get >/dev/null && as_root apt-get update -qq && as_root apt-get install -y -qq ffmpeg >&2; then
      say "Installed the system's ffmpeg instead"
    else
      say "Couldn't get ffmpeg. Install it from https://ffmpeg.org, then run this again."
      exit 1
    fi
  elif command -v brew >/dev/null; then
    say "Installing ffmpeg with Homebrew"
    brew install ffmpeg >&2
  else
    say "Install ffmpeg from https://ffmpeg.org, then run this again."
    exit 1
  fi
fi

# yt-dlp downloads a few seconds of a YouTube or X video for a beat. Without it, those beats show a picture instead.
if ! command -v yt-dlp >/dev/null; then
  say "Downloading yt-dlp"
  name="$([ "$os" = darwin ] && echo yt-dlp_macos || ([ "$arch" = x64 ] && echo yt-dlp_linux || echo yt-dlp_linux_aarch64))"
  if fetch "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$name" "$bin/yt-dlp"; then chmod +x "$bin/yt-dlp"; else rm -f "$bin/yt-dlp" && say "Couldn't download yt-dlp, so clips will show pictures instead."; fi
fi

# Chrome takes the screenshots of pages and X posts. Grok Shorts looks for it as google-chrome, chromium, or
# chromium-browser, so a browser installed anywhere else is linked under one of those names. Without one, those beats
# show a picture instead.
chrome=""
for each in google-chrome chromium chromium-browser; do command -v "$each" >/dev/null && chrome="$(command -v "$each")" && break; done
if [ -z "$chrome" ]; then
  for each in /opt/google/chrome/chrome /usr/bin/google-chrome-stable /snap/bin/chromium "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    if [ -x "$each" ]; then
      chrome="$each"
      [ "$os" = linux ] && ln -sf "$each" "$bin/google-chrome"
      break
    fi
  done
fi
[ -n "$chrome" ] || say "No Chrome found, so pages and posts will show pictures instead."

# The app's packages, installed again whenever the lockfile changes.
if [ ! -f "$app/node_modules/.package-lock.json" ] || [ "$app/package-lock.json" -nt "$app/node_modules/.package-lock.json" ]; then
  say "Installing the app's packages"
  (cd "$app" && npm ci --no-audit --no-fund --no-update-notifier --loglevel=error >&2)
fi

# HyperFrames renders the motion graphics in a headless Chrome of its own, downloaded here once, not in the middle of a
# video.
(cd "$app" && HYPERFRAMES_NO_TELEMETRY=1 node node_modules/hyperframes/bin/hyperframes.mjs browser ensure >&2) || say "Couldn't get the Chrome HyperFrames renders in, so graphics will show the beat's emoji instead."

# One command for every step, from any folder, without npm's own lines in front of the JSON. It reads the key from .env
# at the root of the cookbook when there's one there, or else from the environment, like a Grok Bot secret.
cat >"$bin/shorts" <<EOF
#!/usr/bin/env bash
export PATH="$bin:$root/node/bin:\$PATH"
env="$app/../../../.env"
flags=(--experimental-strip-types --no-warnings=ExperimentalWarning)
[ -f "\$env" ] && flags+=(--env-file="\$env")
exec node "\${flags[@]}" "$app/src/cli.ts" "\$@"
EOF
chmod +x "$bin/shorts"

# What's set up, as JSON: a quoted string, or null for what's missing.
quoted() { [ -n "$1" ] && printf '"%s"' "$(printf '%s' "$1" | tr -d '"\\')" || printf null; }
version() { command -v "$1" >/dev/null && "$1" "$2" 2>/dev/null | head -1 || true; }
key=false
{ [ -n "${XAI_API_KEY:-}" ] || grep -qs '^XAI_API_KEY=.' "$app/../../../.env"; } && key=true
[ "$key" = true ] || say "XAI_API_KEY isn't set. Add it as a secret, or put it in .env at the root of the cookbook."
printf '{\n  "ready": true,\n  "shorts": %s,\n  "app": %s,\n  "node": %s,\n  "ffmpeg": %s,\n  "ytDlp": %s,\n  "chrome": %s,\n  "xaiApiKey": %s\n}\n' \
  "$(quoted "$bin/shorts")" "$(quoted "$app")" "$(quoted "$(node --version)")" "$(quoted "$(version ffmpeg -version | cut -d' ' -f1-3)")" "$(quoted "$(version yt-dlp --version)")" "$(quoted "$chrome")" "$key"
