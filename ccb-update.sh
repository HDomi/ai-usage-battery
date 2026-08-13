#!/bin/bash
# Claude & Cursor Usage Battery — self-update
# 위젯 드롭다운의 "⬆️ 업데이트"에서 호출됨. GitHub 최신을 제자리 교체.
# raw.githubusercontent.com 은 max-age=300 CDN 캐시가 있어
# 1) commits SHA 핀 → 2) 실패 시 ?t=epoch 캐시버스트 순으로 받는다.
set -euo pipefail

REPO="HDomi/ai-usage-battery"
RAW_BASE="https://raw.githubusercontent.com/${REPO}"
API_SHA_URL="https://api.github.com/repos/${REPO}/commits/main"
DEST_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$DEST_DIR/claude-cursor-usage.2m.js"
UPDATER_DEST="$DEST_DIR/.ccb-update.sh"
TS="$(date +%s)"

NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  for c in \
    "$HOME/.nvm/versions/node/v24.16.0/bin/node" \
    "$HOME/.nvm/versions/node/v22.14.0/bin/node" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node
  do
    [ -x "$c" ] && NODE_BIN="$c" && break
  done
fi
if [ -z "$NODE_BIN" ]; then
  echo "❌ node 를 찾을 수 없습니다."
  exit 1
fi

TMP="$(mktemp)"
TMP_UPD="$(mktemp)"
trap 'rm -f "$TMP" "$TMP_UPD"' EXIT

echo "최신 커밋 SHA 확인 중..."
SHA="$(
  curl -fsSL --max-time 10 \
    -A "ai-usage-battery-updater" \
    -H "Accept: application/vnd.github.VERSION.sha" \
    -H "Cache-Control: no-cache" \
    "$API_SHA_URL" 2>/dev/null | tr -d '[:space:]' || true
)"

PLUGIN_URL=""
UPDATER_URL=""
if printf '%s' "$SHA" | grep -Eq '^[a-f0-9]{40}$'; then
  echo "SHA: ${SHA:0:7}"
  PLUGIN_URL="${RAW_BASE}/${SHA}/claude-cursor-usage.2m.js"
  UPDATER_URL="${RAW_BASE}/${SHA}/ccb-update.sh"
else
  echo "ⓘ SHA 조회 실패 — 캐시버스트 URL 로 진행"
  PLUGIN_URL="${RAW_BASE}/main/claude-cursor-usage.2m.js?t=${TS}"
  UPDATER_URL="${RAW_BASE}/main/ccb-update.sh?t=${TS}"
fi

echo "최신 플러그인 내려받는 중..."
curl -fsSL --max-time 20 \
  -A "ai-usage-battery-updater" \
  -H "Cache-Control: no-cache" \
  -H "Pragma: no-cache" \
  "$PLUGIN_URL" -o "$TMP"

if ! grep -q "renderBatteryImage" "$TMP"; then
  echo "❌ 다운로드 검증 실패 — 업데이트를 중단합니다."
  exit 1
fi

NEW_VER="$(
  sed -n 's/^const VERSION = "\([^"]*\)";.*/\1/p' "$TMP" | head -1
)"
echo "버전: ${NEW_VER:-unknown}"

if curl -fsSL --max-time 20 \
  -A "ai-usage-battery-updater" \
  -H "Cache-Control: no-cache" \
  -H "Pragma: no-cache" \
  "$UPDATER_URL" -o "$TMP_UPD" \
  && grep -q "ai-usage-battery-updater\|Cache-Control: no-cache\|vnd.github.VERSION.sha" "$TMP_UPD"
then
  cp "$TMP_UPD" "$UPDATER_DEST"
  chmod +x "$UPDATER_DEST"
fi

[ -f "$DEST" ] && cp "$DEST" "${DEST}.bak" || true
sed "1s|.*|#!$NODE_BIN|" "$TMP" > "$DEST"
chmod +x "$DEST"

rm -f "$HOME/.claude/swiftbar/.update-check.json" 2>/dev/null || true
open "swiftbar://refreshallplugins" 2>/dev/null || true

echo "✅ v${NEW_VER:-?} 로 업데이트했습니다. (이전본: ${DEST}.bak)"
