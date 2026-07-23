#!/bin/bash
# Claude & Cursor 사용량 배터리 위젯 — 설치 스크립트
set -e
cd "$(dirname "$0")"

echo "🔋 Claude & Cursor Usage Battery — 설치"
echo "────────────────────────────────────"

# 1) JS 실행 환경 탐지 (node 또는 bun)
EXEC_BIN=""
if command -v node >/dev/null 2>&1; then
  EXEC_BIN=$(command -v node)
elif command -v bun >/dev/null 2>&1; then
  EXEC_BIN=$(command -v bun)
else
  echo "❌ node 또는 bun이 필요합니다. Node.js를 설치하세요."
  exit 1
fi
echo "✅ JS Runtime: $EXEC_BIN"

# 2) SwiftBar 앱 확인
SWIFTBAR_APP=""
if [ -d "/Applications/SwiftBar.app" ]; then
  SWIFTBAR_APP="/Applications/SwiftBar.app"
elif [ -d "$HOME/Applications/SwiftBar.app" ]; then
  SWIFTBAR_APP="$HOME/Applications/SwiftBar.app"
fi

if [ -n "$SWIFTBAR_APP" ]; then
  echo "✅ SwiftBar 감지: $SWIFTBAR_APP"
else
  echo "ⓘ  SwiftBar가 아직 설치되지 않았습니다."
  echo "   설치 명령어: brew install --cask swiftbar"
fi

# 3) ccusage (선택 — 없어도 배터리는 정상)
if command -v ccusage >/dev/null 2>&1 || [ -x "$HOME/.bun/bin/ccusage" ]; then
  echo "✅ ccusage (Claude 드롭다운 상세 표시됨)"
else
  echo "ⓘ  ccusage 없음 — 배터리 정상, Claude 비용 상세만 생략"
fi

# 4) Cursor DB 확인
CURSOR_DB="$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
if [ -f "$CURSOR_DB" ]; then
  echo "✅ Cursor AI 설치 및 세션 DB 감지됨"
else
  echo "ⓘ  Cursor 세션 DB를 찾을 수 없습니다. Cursor에 로그인하여 실행하면 세션이 생성됩니다."
fi

# 5) 플러그인 배치
PLUGIN_DIR="${SWIFTBAR_PLUGIN_DIR:-$HOME/.swiftbar-plugins}"
mkdir -p "$PLUGIN_DIR"
rm -f "$PLUGIN_DIR/claude-codex-usage.2m.js" 2>/dev/null || true
sed "1s|.*|#!$EXEC_BIN|" claude-cursor-usage.2m.js > "$PLUGIN_DIR/claude-cursor-usage.2m.js"
chmod +x "$PLUGIN_DIR/claude-cursor-usage.2m.js"

cp ccb-update.sh "$PLUGIN_DIR/.ccb-update.sh" 2>/dev/null || true
chmod +x "$PLUGIN_DIR/.ccb-update.sh" 2>/dev/null || true
echo "✅ 플러그인 배치 완료: $PLUGIN_DIR/claude-cursor-usage.2m.js"

# 6) SwiftBar 재시작 (앱이 있는 경우)
if [ -n "$SWIFTBAR_APP" ]; then
  BID=$(defaults read "$SWIFTBAR_APP/Contents/Info" CFBundleIdentifier 2>/dev/null || echo "com.ameba.SwiftBar")
  defaults write "$BID" PluginDirectory -string "$PLUGIN_DIR"

  if defaults read "$BID" DisabledPlugins 2>/dev/null | grep -q "claude-cursor-usage.2m.js"; then
    REMAIN=$(defaults read "$BID" DisabledPlugins 2>/dev/null \
      | grep -oE '"[^"]+"' | tr -d '"' | grep -v "^claude-cursor-usage.2m.js$" || true)
    defaults delete "$BID" DisabledPlugins 2>/dev/null || true
    if [ -n "$REMAIN" ]; then
      while IFS= read -r p; do [ -n "$p" ] && defaults write "$BID" DisabledPlugins -array-add "$p"; done <<< "$REMAIN"
    fi
    echo "ⓘ  플러그인이 SwiftBar 비활성 목록에 있어 자동으로 다시 켰습니다"
  fi

  osascript -e 'tell application "SwiftBar" to quit' >/dev/null 2>&1 || true
  sleep 1
  open -a "$SWIFTBAR_APP"
fi

echo "────────────────────────────────────"
echo "✅ 플러그인 준비 완료!"
if [ -z "$SWIFTBAR_APP" ]; then
  echo "👉 SwiftBar를 설치해 주세요: brew install --cask swiftbar"
  echo "   설치 후 SwiftBar를 실행하고 플러그인 폴더로 ~/.swiftbar-plugins 선택"
else
  echo "✅ SwiftBar 메뉴바 상단에 Claude & Cursor 배터리가 표시됩니다."
fi
