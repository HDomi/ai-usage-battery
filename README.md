# 🔋 Claude & Cursor Usage Battery

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/platform-macOS-000000?logo=apple&logoColor=white" alt="Platform: macOS">
  <img src="https://img.shields.io/badge/SwiftBar-plugin-FF9500" alt="SwiftBar plugin">
  <img src="https://img.shields.io/badge/runtime-Node.js%20%7C%20Bun-14151A?logo=node.js&logoColor=white" alt="Runtime: Node.js / Bun">
  <img src="https://img.shields.io/badge/dependencies-none-brightgreen.svg" alt="Zero dependencies">
</p>

> macOS 메뉴바 상단에 **Claude Code** 및 **Cursor AI** 사용량 한도를 배터리 잔량 아이콘으로 상시 표시해주는 SwiftBar 위젯입니다.

`C` = Claude · `Cr` = Cursor. 배터리 아이콘은 각 한도의 **남은 %**를 표시합니다 (초록색 = 여유, 빨간색 = 소진 직전). 아이콘을 클릭하면 리셋 남은 시간 및 상세 게이지를 확인할 수 있습니다.

단 하나의 독립적인 스크립트로 동작하며 **외부 패키지 설치(`npm install`)가 필요 없습니다**. 메뉴바 아이콘 PNG 역시 외부 라이브러리 없이 순수 JavaScript와 Node.js/Bun 내장 `node:zlib` 모듈만으로 직접 픽셀 렌더링합니다.

---

## 📊 표시 항목

| 항목 | 배터리 표시 | 데이터 출처 |
|---|---|---|
| **`C` Claude** | `C5`(5시간 세션) · `CW`(주간) · `CF`(Fable 모델 주간) | Anthropic 공식 OAuth usage API (전체 계정 합산 실시간) |
| **`Cr` Cursor** | `Cr`(월간 Fast Requests 한도) | Cursor 서버 Dashboard API (`api2.cursor.sh`) |

드롭다운 클릭 시 상세 정보:

```
Claude Code
  5시간 남음   ▕██████████████░░░░░░▏ 70%  (사용 30%)  ·  리셋 3h 18m
  주간 남음    ▕██████▋░░░░░░░░░░░░░▏ 33%  (사용 67%)  ·  리셋 3d 21h
  Fable 남음   ▕████░░░░░░░░░░░░░░░░▏ 26%  (사용 74%)  ·  리셋 3d 21h
  오늘 모델별  ▕████████████▏ Fable $75 · Opus $46 · Sonnet $5 …

Cursor AI
  월간 남음    ▕█████████████████░░░▏ 85%  (사용 15%)  ·  리셋 25d 20h
        You've used 15% of your included total usage
```

---

## 🔍 상세 데이터 파싱 및 조회 구조 (Parsing Architecture)

이 위젯이 Claude Code와 Cursor AI의 데이터를 **정확히 어떤 구조와 방식으로 조회하고 파싱하는지**에 대한 상세 설명입니다.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            macOS 메뉴바 (SwiftBar)                            │
└──────────────────────────────────────▲──────────────────────────────────────┘
                                       │ base64 PNG + 드롭다운 텍스트
 ┌─────────────────────────────────────┴─────────────────────────────────────┐
 │                      claude-cursor-usage.2m.js                             │
 ├─────────────────────────────────────┬─────────────────────────────────────┤
 │          [Claude Code 파싱]          │            [Cursor AI 파싱]          │
 │ 1. Keychain/Credentials 토큰 추출    │ 1. state.vscdb SQLite 토큰 추출     │
 │ 2. Anthropic OAuth usage API GET   │ 2. api2.cursor.sh Connect POST      │
 │ 3. 5h / 7d / Fable 사용률 파싱     │ 3. totalPercentUsed 사용률 파싱     │
 └─────────────────────────────────────┴─────────────────────────────────────┘
```

---

### 1. Claude Code 데이터 파싱 구조 (`getClaudeUsage()`)

#### ① 인증 토큰 추출
Claude Code 로그인 상태를 활용하여 키체인 또는 인증 파일에서 Access Token을 추출합니다.
* **키체인 보안 조회**:  
  `security find-generic-password -s "Claude Code-credentials" -w`
* **파일 폴백**:  
  `~/.claude/.credentials.json` 내 `claudeAiOauth.accessToken`
* *(보안): 프로세스 목록(`ps`)에 토큰이 노출되지 않도록 stdin(`-H @-`) 방식으로 cURL 헤더에 주입합니다.*

#### ② Endpoint 및 HTTP 요청
* **URL**: `GET https://api.anthropic.com/api/oauth/usage`
* **Headers**:
  ```http
  Authorization: Bearer <accessToken>
  anthropic-beta: oauth-2025-04-20
  ```

#### ③ JSON 응답 및 파싱 항목
```json
{
  "five_hour": { "utilization": 30.5, "resets_at": "2026-07-23T18:00:00Z" },
  "seven_day": { "utilization": 67.2, "resets_at": "2026-07-27T00:00:00Z" },
  "limits": [
    {
      "group": "weekly",
      "percent": 74.0,
      "resets_at": "2026-07-27T00:00:00Z",
      "scope": { "model": { "display_name": "Fable" } }
    }
  ]
}
```
* **5시간 세션 남은 %**: `Math.max(0, 100 - five_hour.utilization)`
* **주간 한도 남은 %**: `Math.max(0, 100 - seven_day.utilization)`
* **모델별(Fable) 주간 남은 %**: `Math.max(0, 100 - limits[].percent)`
* **리셋 시간**: `resets_at` (ISO 8601 문자열) → Unix 타임스탬프로 변환 후 현재 시간과의 차이 계산 (`fmtDur()`)

---

### 2. Cursor AI 데이터 파싱 구조 (`getCursorUsage()`)

#### ① 인증 토큰 추출
Cursor가 로컬에 저장하는 SQLite 데이터베이스에서 사용자 액세스 토큰을 추출합니다.
* **SQLite DB 경로**:  
  `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
* **조회 쿼리**:
  ```sql
  SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken';
  ```
  *(macOS 내장 `/usr/bin/sqlite3`로 조회하여 외부 모듈 설치 없이 즉시 읽어옵니다.)*

#### ② Endpoint 및 HTTP 요청
Cursor 서버의 Connect Protocol RPC 엔드포인트를 호출합니다.
* **URL**: `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage`
* **Headers**:
  ```http
  Authorization: Bearer <accessToken>
  Content-Type: application/json
  Connect-Protocol-Version: 1
  ```
* **Body**: `{}` (빈 JSON 객체)

#### ③ JSON 응답 및 파싱 항목
```json
{
  "billingCycleStart": "1784342948000",
  "billingCycleEnd": "1787021348000",
  "planUsage": {
    "totalSpend": 5224,
    "includedSpend": 2000,
    "totalPercentUsed": 15.142028985507247,
    "autoPercentUsed": 17.413333333333334
  },
  "autoModelSelectedDisplayMessage": "You've used 15% of your included total usage"
}
```
* **월간 사용 비율 (%)**: `d.planUsage.totalPercentUsed` (기본값: `autoPercentUsed`)
* **월간 남은 %**: `Math.max(0, 100 - totalPercentUsed)`
* **결제 주기 리셋 시각**: `billingCycleEnd` (밀리초 단위 타임스탬프 문자열) → 초 단위 변환 후 잔여 시간 계산
* **안내 메시지**: `autoModelSelectedDisplayMessage` (드롭다운 서브 텍스트로 표시)

---

### 3. 배터리 PNG 렌더링 구조 (`renderBatteryImage()`)

위에서 구한 남은 퍼센트(`remain`) 수치를 바탕으로 순수 JavaScript 코드로 PNG 그래픽을 그립니다.

1. **캔버스 버퍼 생성**: `w × h × 4` (RGBA) 크기의 `Buffer` 생성 (Retina Display 2x 스케일 적용)
2. **라운디드 캡슐 구조**:
   - 모서리가 다듬어진 배터리 외곽선 렌더링 (`_roundedCapsuleBorder`)
   - 오른쪽에 양각 단자 팁 배치
   - 퍼센트에 따른 채움 영역(Fill Area) 색상 적용 (`heatRemain`: 초록 / 노랑 / 빨강)
3. **픽셀 비트맵 폰트 (Font Stencil)**:
   - `C5`, `CW`, `CF`, `Cr` 라벨 및 잔여 숫자 수치를 4x6 / 3x5 비트맵 맵핑 폰트로 직접 픽셀 작성
   - 채움 배경 위에서는 어두운 글자, 배경 밖에서는 밝은 글자로 자동 대비(Contrast) 조절
4. **PNG 인코딩**:
   - `node:zlib`의 `deflateSync`를 이용해 IDAT 블록 압축
   - IHDR, IDAT, IEND 핑크 셋업 및 CRC32 바이트 체크섬 합산 후 Base64로 반환하여 SwiftBar에 전달

---

## 🛠️ 요구 사항 및 설치

### 요구 사항
- **macOS**
- **[SwiftBar](https://github.com/swiftbar/SwiftBar)** (`brew install --cask swiftbar`)
- **Node.js** (v18+) 또는 **[Bun](https://bun.sh)**
- **Claude Code** 또는 **Cursor** (로그인 상태 필수)

### 설치 방법

```bash
git clone https://github.com/HDomi/ai-usage-battery.git
cd claude-codex-battery
./install.sh
```

`install.sh` 스크립트 역할:
1. Node.js / Bun 및 SwiftBar 설치 여부 확인
2. `claude-cursor-usage.2m.js` 플러그인을 `~/.swiftbar-plugins/`에 자동 배치
3. SwiftBar 재시작 및 메뉴바 등록

---

## 🔒 보안 및 개인정보 (Privacy & Security)

- **로컬에서 직접 조회**: 외부 제3자 서버를 거치지 않고 사용자 Mac에서 Anthropic / Cursor 공식 서버로 직접 요청합니다.
- **비밀번호/키 비저장**: 토큰은 메모리 내에서만 사용되며 로그나 파일에 저장되지 않습니다.
- **오프라인 폴백 지원**: 네트워크 연결이 끊기거나 API 응답 실패 시 `~/.claude/swiftbar/` 하위 캐시 데이터를 사용합니다.

---

## 🙏 Credits & Acknowledgements

이 프로젝트는 Denny Kim님의 [claude-codex-battery](https://github.com/dennykim123/claude-codex-battery) (MIT License) 프로젝트를 바탕으로, Cursor AI 모니터링 연동 및 메뉴바 시인성 개선을 추가하여 제작되었습니다.

---

## 📄 라이선스

[MIT License](LICENSE) (c) 2026 Denny Kim / Modified by HDomi
