#!/bin/bash
# Claude & Cursor Usage Battery — self-update
# 위젯 드롭다운의 "⬆️ 업데이트"에서 호출됨. GitHub 최신을 제자리 교체.
# raw.githubusercontent.com 은 max-age=300 CDN 캐시가 있어 main URL 대신
# commits/main SHA 로 핀한 raw URL 을 쓴다.
set -euo pipefail

REPO="HDomi/ai-usage-battery"
RAW_BASE="https://raw.githubusercontent.com/${REPO}"
API_SHA_URL="https://api.github.com/repos/${REPO}/commits/main"
DEST_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$DEST_DIR/claude-cursor-usage.2m.js"
UPDATER_DEST="$DEST_DIR/.ccb-update.sh"

# SwiftBar 환경은 PATH가 거의 비어 있음
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
    -H "Accept: application/vnd.github.VERSION.sha" \
    -H "Cache-Control: no-cache" \
    "$API_SHA_URL" | tr -d '[:space:]'
)"
if ! printf '%s' "$SHA" | grep -Eq '^[a-f0-9]{40}$'; then
  echo "❌ 커밋 SHA 조회 실패"
  exit 1
fi
echo "SHA: ${SHA:0:7}"

echo "최신 플러그인 내려받는 중..."
curl -fsSL --max-time 20 \
  -H "Cache-Control: no-cache" \
  "${RAW_BASE}/${SHA}/claude-cursor-usage.2m.js" -o "$TMP"

if ! grep -q "renderBatteryImage" "$TMP"; then
  echo "❌ 다운로드 검증 실패 — 업데이트를 중단합니다."
  exit 1
fi

NEW_VER="$(
  sed -n 's/^const VERSION = "\([^"]*\)";.*/\1/p' "$TMP" | head -1
)"
echo "버전: ${NEW_VER:-unknown}"

# 업데이터 자신도 같은 SHA 로 갱신 (다음 업데이트부터 CDN 우회 유지)
if curl -fsSL --max-time 20 \
  -H "Cache-Control: no-cache" \
  "${RAW_BASE}/${SHA}/ccb-update.sh" -o "$TMP_UPD" \
  && grep -q "application/vnd.github.VERSION.sha" "$TMP_UPD"
then
  cp "$TMP_UPD" "$UPDATER_DEST"
  chmod +x "$UPDATER_DEST"
fi

[ -f "$DEST" ] && cp "$DEST" "$DEST.bak"
sed "1s|.*|#!$NODE_BIN|" "$TMP" > "$DEST"
chmod +x "$DEST"

rm -f "$HOME/.claude/swiftbar/.update-check.json" 2>/dev/null || true
open "swiftbar://refreshallplugins" 2>/dev/null || true

echo "✅ v${NEW_VER:-?} 로 업데이트했습니다. (이전본: $DEST.bak)"
