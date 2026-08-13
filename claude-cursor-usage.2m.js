#!/usr/bin/env node
// <xbar.title>Claude & Cursor Usage</xbar.title>
// <xbar.version>v4.0</xbar.version>
// <xbar.author>개발부스러기</xbar.author>
// <xbar.desc>Claude Code 5시간 블록 + Cursor 사용량을 메뉴바에 배터리 아이콘으로 상시 표시</xbar.desc>
// SwiftBar 플러그인: 2분마다 갱신. 메뉴바=배터리 잔량 아이콘(자체 PNG), 클릭=상세 게이지.

import { execSync, spawn } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  statSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import zlib from "node:zlib";

const HOME = homedir();

// SwiftBar는 PATH가 거의 비어 있음 → shebang node 옆·nvm·Homebrew를 앞에 붙인다
{
  const pathExtras = [
    dirname(process.execPath),
    `${HOME}/.bun/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ].filter((p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  });
  process.env.PATH = [...pathExtras, process.env.PATH || "/usr/bin:/bin"].join(
    ":",
  );
}

/**
 * nvm에 설치된 node 버전 bin 경로를 최신순으로 반환한다.
 * @param {string} name - 실행 파일명
 * @returns {string[]}
 */
function nvmBinCandidates(name) {
  const root = `${HOME}/.nvm/versions/node`;
  try {
    return readdirSync(root)
      .filter((v) => /^v\d/.test(v))
      .sort((a, b) => {
        const pa = a.slice(1).split(".").map(Number);
        const pb = b.slice(1).split(".").map(Number);
        for (let i = 0; i < 3; i++) {
          const d = (pb[i] || 0) - (pa[i] || 0);
          if (d) return d;
        }
        return 0;
      })
      .map((v) => `${root}/${v}/bin/${name}`);
  } catch {
    return [];
  }
}

/**
 * PATH에 의존하지 않고 실행 파일 절대경로를 찾는다.
 * @param {string} name - 실행 파일명
 * @param {string[]} [extra] - 우선 탐색 경로
 * @returns {string}
 */
function findBin(name, extra = []) {
  const cands = [
    ...extra,
    `${dirname(process.execPath)}/${name}`,
    `${HOME}/.bun/bin/${name}`,
    `${HOME}/.nvm/versions/node/current/bin/${name}`,
    ...nvmBinCandidates(name),
    "/opt/homebrew/bin/" + name,
    "/usr/local/bin/" + name,
  ];
  for (const c of cands) {
    try {
      if (existsSync(c)) return c;
    } catch {}
  }
  try {
    const p = execSync(`command -v ${name} 2>/dev/null`, {
      encoding: "utf8",
    }).trim();
    if (p) return p;
  } catch {}
  return name;
}

/**
 * ccusage 실행 커맨드를 결정한다. (없으면 npx로 실행)
 * @returns {string}
 */
function findCCUsage() {
  const bin = findBin("ccusage");
  try {
    if (bin && bin !== "ccusage" && existsSync(bin)) return bin;
    execSync(`${bin} --version 2>/dev/null`, { stdio: "ignore" });
    return bin;
  } catch {}
  const npx = findBin("npx");
  if (npx && existsSync(npx)) return `"${npx}" -y ccusage`;
  return "npx -y ccusage";
}
const CCUSAGE = findCCUsage();
const now = Math.floor(Date.now() / 1000);

const EXCHANGE_CACHE = `${HOME}/.claude/swiftbar/.exchange-rate.json`;
const DEFAULT_KRW_RATE = 1400;

function getExchangeRateKRW() {
  if (process.env.EXCHANGE_RATE_KRW) {
    return Number(process.env.EXCHANGE_RATE_KRW);
  }
  let cache = null;
  try {
    cache = JSON.parse(readFileSync(EXCHANGE_CACHE, "utf8"));
  } catch {}

  const age = cache?.fetchedAt ? now - cache.fetchedAt : Infinity;

  if (!cache?.rate || age > 6 * 3600) {
    try {
      const raw = execSync(
        `curl -fsL --max-time 3 "https://open.er-api.com/v6/latest/USD" 2>/dev/null`,
        {
          encoding: "utf8",
          timeout: 4000,
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      const data = JSON.parse(raw);
      if (data?.rates?.KRW) {
        const rate = Math.round(data.rates.KRW * 10) / 10;
        try {
          mkdirSync(dirname(EXCHANGE_CACHE), { recursive: true });
          writeFileSync(
            EXCHANGE_CACHE,
            JSON.stringify({ fetchedAt: now, rate }),
          );
        } catch {}
        return rate;
      }
    } catch {}
  }

  return cache?.rate || DEFAULT_KRW_RATE;
}

const EXCHANGE_RATE_KRW = getExchangeRateKRW();

function fmtKRW(usd) {
  if (usd == null || isNaN(usd)) return "?원";
  const krw = Math.round(usd * EXCHANGE_RATE_KRW);
  return `₩${krw.toLocaleString()}`;
}

// ── 자동 업데이트 ──
const VERSION = "2.1.2";
const SELF_DIR = dirname(process.argv[1] || `${HOME}/.swiftbar-plugins/x`);
const REPO_RAW =
  "https://raw.githubusercontent.com/HDomi/ai-usage-battery/main";
const REPO_API_SHA =
  "https://api.github.com/repos/HDomi/ai-usage-battery/commits/main";
const UPDATE_CACHE = `${HOME}/.claude/swiftbar/.update-check.json`;

/**
 * 버전 문자열을 비교한다.
 * @param {string} a
 * @param {string} b
 * @returns {number} a>b이면 1, a<b이면 -1, 같으면 0
 */
function cmpVer(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

/**
 * GitHub VERSION 을 조회해 업데이트 가능 여부를 반환한다.
 * raw CDN(max-age=300) 회피를 위해 commits SHA 로 VERSION 을 핀한다.
 * @returns {{ latest: string|undefined, hasUpdate: boolean }}
 */
function getUpdateInfo() {
  let cache = null;
  try {
    cache = JSON.parse(readFileSync(UPDATE_CACHE, "utf8"));
  } catch {}
  const age = cache?.checkedAt ? now - cache.checkedAt : Infinity;
  // 새 버전이 보이면 바로 배너 뜨도록 1시간마다 재확인
  if (age > 3600) {
    try {
      const cmd =
        `sha=$(curl -fsSL --max-time 8 -H "Accept: application/vnd.github.VERSION.sha" -H "Cache-Control: no-cache" "${REPO_API_SHA}" | tr -d "[:space:]"); ` +
        `latest=""; ` +
        `if printf "%s" "$sha" | grep -Eq "^[a-f0-9]{40}$"; then ` +
        `latest=$(curl -fsSL --max-time 8 -H "Cache-Control: no-cache" "https://raw.githubusercontent.com/HDomi/ai-usage-battery/$sha/VERSION" | tr -d "[:space:]"); ` +
        `fi; ` +
        `if [ -z "$latest" ]; then latest=$(curl -fsSL --max-time 8 "${REPO_RAW}/VERSION?t=${now}" | tr -d "[:space:]"); fi; ` +
        `[ -n "$latest" ] && printf '{"checkedAt":%s,"latest":"%s"}' "${now}" "$latest" > "${UPDATE_CACHE}"`;
      const child = spawn("/bin/sh", ["-c", cmd], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } catch {}
  }
  const latest = cache?.latest;
  return { latest, hasUpdate: !!latest && cmpVer(latest, VERSION) > 0 };
}

// ══ 배터리 아이콘 PNG 렌더 (순수 JS, node:zlib만) ══════════
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const mk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    mk("IHDR", ihdr),
    mk("IDAT", idat),
    mk("IEND", Buffer.alloc(0)),
  ]);
}
const SCALE = 2;
function makeCanvas(wl, hl) {
  const w = wl * SCALE,
    h = hl * SCALE;
  const buf = Buffer.alloc(w * h * 4, 0);
  const set = (x, y, col) => {
    if (x < 0 || y < 0 || x >= wl || y >= hl) return;
    const [r, g, b, a = 255] = col;
    for (let dy = 0; dy < SCALE; dy++)
      for (let dx = 0; dx < SCALE; dx++) {
        const px = ((y * SCALE + dy) * w + (x * SCALE + dx)) * 4;
        buf[px] = r;
        buf[px + 1] = g;
        buf[px + 2] = b;
        buf[px + 3] = a;
      }
  };
  return { w, h, buf, set };
}
const _rect = (cv, x, y, rw, rh, col) => {
  for (let j = 0; j < rh; j++)
    for (let i = 0; i < rw; i++) cv.set(x + i, y + j, col);
};

const _roundedCapsuleBorder = (cv, x, y, rw, rh, col) => {
  for (let i = 1; i < rw - 1; i++) {
    cv.set(x + i, y, col);
    cv.set(x + i, y + rh - 1, col);
  }
  for (let j = 1; j < rh - 1; j++) {
    cv.set(x, y + j, col);
    cv.set(x + rw - 1, y + j, col);
  }
  cv.set(x, y, [0, 0, 0, 0]);
  cv.set(x + rw - 1, y, [0, 0, 0, 0]);
  cv.set(x, y + rh - 1, [0, 0, 0, 0]);
  cv.set(x + rw - 1, y + rh - 1, [0, 0, 0, 0]);
  cv.set(x + 1, y + 1, col);
  cv.set(x + rw - 2, y + 1, col);
  cv.set(x + 1, y + rh - 2, col);
  cv.set(x + rw - 2, y + rh - 2, col);
};

const SIZE_FILE = `${HOME}/.claude/swiftbar/.batt-size`;
let SIZE = "big";
try {
  if (readFileSync(SIZE_FILE, "utf8").trim() === "small") SIZE = "small";
} catch {}

const FONT46 = {
  0: ["0110", "1001", "1001", "1001", "1001", "0110"],
  1: ["0010", "0110", "0010", "0010", "0010", "0111"],
  2: ["0110", "1001", "0010", "0100", "1000", "1111"],
  3: ["1110", "0001", "0110", "0001", "1001", "0110"],
  4: ["0010", "0110", "1010", "1111", "0010", "0010"],
  5: ["1111", "1000", "1110", "0001", "1001", "0110"],
  6: ["0110", "1000", "1110", "1001", "1001", "0110"],
  7: ["1111", "0001", "0010", "0100", "0100", "0100"],
  8: ["0110", "1001", "0110", "1001", "1001", "0110"],
  9: ["0110", "1001", "1001", "0111", "0001", "0110"],
  C: ["0110", "1001", "1000", "1000", "1001", "0110"],
  R: ["1110", "1001", "1110", "1010", "1001", "1001"],
  r: ["0000", "1011", "1100", "1000", "1000", "1000"],
};

const FONT35 = {
  0: ["111", "101", "101", "101", "111"],
  1: ["010", "110", "010", "010", "111"],
  2: ["111", "001", "111", "100", "111"],
  3: ["111", "001", "111", "001", "111"],
  4: ["101", "101", "111", "001", "001"],
  5: ["111", "100", "111", "001", "111"],
  6: ["111", "100", "111", "101", "111"],
  7: ["111", "001", "001", "001", "001"],
  8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "111"],
  C: ["111", "100", "100", "100", "111"],
  R: ["110", "101", "110", "101", "101"],
  r: ["000", "111", "100", "100", "100"],
};

const PRESET =
  SIZE === "small"
    ? { font: FONT35, adv: () => 4, bw: 15, bh: 9, capw: 17, gap: 3, ggap: 7, pad: 1, lblgap: 2, H: 9, dy: 2 }
    : { font: FONT46, adv: (ch) => (ch === "1" ? 4 : 5), bw: 19, bh: 10, capw: 21, gap: 5, ggap: 10, pad: 2, lblgap: 3, H: 12, dy: 3 };
const NUM = PRESET.font;

const chAdv = PRESET.adv;
function drawNum(cv, x, y, str, col, altCol, boundaryX) {
  let cx = x;
  for (const ch of str) {
    const g = NUM[ch];
    if (g)
      for (let r = 0; r < g.length; r++)
        for (let c = 0; c < g[r].length; c++)
          if (g[r][c] === "1") {
            const px = cx + c;
            cv.set(px, y + r, altCol && px < boundaryX ? altCol : col);
          }
    cx += chAdv(ch);
  }
  return cx;
}
const numW = (s) => [...s].reduce((w, ch) => w + chAdv(ch), 0) - 1;

function heatRemain(r, dark) {
  if (r <= 20) return dark ? [255, 69, 58] : [255, 59, 48];
  if (r < 50) return dark ? [255, 214, 10] : [255, 204, 0];
  return dark ? [48, 209, 88] : [52, 199, 89];
}
const heatRemainHex = (r) =>
  r <= 20 ? "#FF453A" : r < 50 ? "#FFD60A" : "#30D158";

function drawNumWithOutline(cv, x, y, str, col, outlineCol) {
  if (outlineCol) {
    // 50% 은은한 1px 드롭 섀도로 변경 (굵고 진한 테두리 대신 자연스러운 그늘)
    drawNum(cv, x + 1, y + 1, str, outlineCol);
  }
  return drawNum(cv, x, y, str, col);
}

function drawCapsule(cv, x, midY, remain, ink, dark) {
  const bw = PRESET.bw,
    bh = PRESET.bh,
    by = midY - Math.floor(bh / 2);
  
  // 은은한 50% 옅은 그림자 효과
  _roundedCapsuleBorder(cv, x + 1, by + 1, bw, bh, [0, 0, 0, 60]);
  _roundedCapsuleBorder(cv, x, by, bw, bh, ink);
  _rect(cv, x + bw, by + 3, 2, bh - 6, ink);
  if (remain != null) {
    const innerW = bw - 4;
    const v = Math.max(0, Math.min(100, remain));
    const fw = Math.round((v / 100) * innerW);
    if (fw > 0) _rect(cv, x + 2, by + 2, fw, bh - 4, heatRemain(remain, dark));
    const s = String(Math.round(v));
    const tx = x + Math.floor((bw - numW(s)) / 2);
    drawNum(cv, tx, midY - PRESET.dy, s, ink, [20, 20, 20], x + 2 + (fw > 0 ? fw : 0));
  }
  return x + bw + 2;
}

function renderBatteryImage(dark, items) {
  const ink = dark ? [255, 255, 255, 255] : [0, 0, 0, 255];
  // 50% 옅게 조정된 소프트 그림자 색상
  const outlineCol = dark ? [0, 0, 0, 90] : [0, 0, 0, 50];
  const CAPW = PRESET.capw,
    GAP = PRESET.gap,
    GGAP = PRESET.ggap,
    PAD = PRESET.pad,
    LBLGAP = PRESET.lblgap;
  const H = PRESET.H;
  const midY = Math.floor(H / 2);
  const getGroup = (lbl) => (lbl.startsWith("Cr") ? "Cr" : lbl[0]);
  let W = PAD * 2;
  let pg = null;
  for (let i = 0; i < items.length; i++) {
    const g = getGroup(items[i].label);
    if (g !== pg) {
      if (pg !== null) W += GGAP;
      W += numW(g) + LBLGAP;
      pg = g;
    } else W += GAP;
    W += CAPW;
  }
  const cv = makeCanvas(Math.max(W, 8), H);
  let x = PAD;
  pg = null;
  for (let i = 0; i < items.length; i++) {
    const g = getGroup(items[i].label);
    if (g !== pg) {
      if (pg !== null) x += GGAP;
      // 라벨 외곽선 렌더링으로 텍스트 시인성 보장
      drawNumWithOutline(cv, x, midY - PRESET.dy, g, ink, outlineCol);
      x += numW(g) + LBLGAP;
      pg = g;
    } else x += GAP;
    drawCapsule(cv, x, midY, items[i].remain, ink, dark);
    x += CAPW;
  }
  return encodePNG(cv.w, cv.h, cv.buf).toString("base64");
}

function isDarkMode() {
  if (process.env.OS_APPEARANCE) {
    return process.env.OS_APPEARANCE.toLowerCase().includes("dark");
  }
  try {
    return (
      execSync("defaults read -g AppleInterfaceStyle 2>/dev/null", {
        encoding: "utf8",
        timeout: 3000,
      }).trim() === "Dark"
    );
  } catch {
    return false;
  }
}

// ── 게이지 렌더 ──
const FULL = "█",
  EMPTY = "░",
  PART = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
function bar(pct, w) {
  pct = Math.max(0, Math.min(100, pct || 0));
  const filled = (pct / 100) * w;
  let fb = Math.floor(filled);
  let idx = Math.round((filled - fb) * 8);
  if (idx === 8) {
    fb++;
    idx = 0;
  }
  fb = Math.min(fb, w);
  let s = FULL.repeat(fb),
    used = fb;
  if (idx > 0 && fb < w) {
    s += PART[idx];
    used++;
  }
  s += EMPTY.repeat(Math.max(0, w - used));
  return s;
}

const fmtDur = (secs) => {
  if (secs <= 0) return "0m";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtTok = (n) => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return `${n}`;
};

// ── 1. Claude Code ────────────────────────
function getClaude() {
  try {
    const raw = execSync(`${CCUSAGE} blocks --active --json`, {
      encoding: "utf8",
      timeout: 20000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const data = JSON.parse(raw);
    const b =
      (data.blocks || []).find((x) => x.isActive) || (data.blocks || [])[0];
    if (!b) return null;
    const startTs = Math.floor(new Date(b.startTime).getTime() / 1000);
    const endTs = Math.floor(new Date(b.endTime).getTime() / 1000);
    const span = Math.max(1, endTs - startTs);
    const elapsedPct = Math.max(
      0,
      Math.min(100, ((now - startTs) / span) * 100),
    );
    return {
      elapsedPct,
      remainMin:
        b.projection?.remainingMinutes ??
        Math.max(0, Math.floor((endTs - now) / 60)),
      cost: b.costUSD || 0,
      tokens: b.totalTokens || 0,
      projCost: b.projection?.totalCost ?? null,
      costPerHour: b.burnRate?.costPerHour ?? null,
    };
  } catch (e) {
    return { error: String(e.message || e).split("\n")[0] };
  }
}

const MODEL_NAMES = {
  "claude-fable-5": "Fable 5",
  "claude-opus-5": "Opus 5",
  "claude-opus-4-8": "Opus 4.8",
  "claude-opus-4-7": "Opus 4.7",
  "claude-sonnet-5": "Sonnet 5",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
};
const shortModel = (n) => MODEL_NAMES[n] || (n || "").replace("claude-", "");
function getClaudeModels() {
  try {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const raw = execSync(`${CCUSAGE} daily --breakdown --json --since ${ymd}`, {
      encoding: "utf8",
      timeout: 20000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const day = (JSON.parse(raw).daily || []).slice(-1)[0];
    if (!day) return null;
    const models = (day.modelBreakdowns || [])
      .map((m) => ({
        name: m.modelName,
        cost: m.cost || 0,
        tokens:
          (m.inputTokens || 0) +
          (m.outputTokens || 0) +
          (m.cacheCreationTokens || 0) +
          (m.cacheReadTokens || 0),
      }))
      .filter((m) => m.cost > 0.005)
      .sort((a, b) => b.cost - a.cost);
    if (!models.length) return null;
    return { models, total: models.reduce((s, m) => s + m.cost, 0) };
  } catch {
    return null;
  }
}

const CLAUDE_STATE_DIR = `${HOME}/.claude/swiftbar`;
const CLAUDE_USAGE_CACHE = `${CLAUDE_STATE_DIR}/.claude-usage.json`;
const LEGACY_USAGE_FILES = [
  `${HOME}/.claude/MEMORY/STATE/usage-cache.json`,
  `${HOME}/.claude/PAI/MEMORY/STATE/usage-cache.json`,
];

function readClaudeToken() {
  if (existsSync(`${CLAUDE_STATE_DIR}/.no-live`)) return null;
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
      { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const t = JSON.parse(raw)?.claudeAiOauth?.accessToken;
    if (t) return t;
  } catch {}
  try {
    const raw = readFileSync(`${HOME}/.claude/.credentials.json`, "utf8");
    return JSON.parse(raw)?.claudeAiOauth?.accessToken ?? null;
  } catch {}
  return null;
}

function fetchClaudeUsageLive() {
  const token = readClaudeToken();
  if (!token) return null;
  try {
    const raw = execSync(
      `/usr/bin/curl -fsS --max-time 5 -H @- -H "anthropic-beta: oauth-2025-04-20" https://api.anthropic.com/api/oauth/usage`,
      {
        encoding: "utf8",
        timeout: 8000,
        input: `Authorization: Bearer ${token}\n`,
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    const d = JSON.parse(raw);
    if (!d?.five_hour) return null;
    try {
      mkdirSync(CLAUDE_STATE_DIR, { recursive: true });
      writeFileSync(
        CLAUDE_USAGE_CACHE,
        JSON.stringify({ fetchedAt: Math.floor(Date.now() / 1000), data: d }),
      );
    } catch {}
    return { data: d, measuredAt: Math.floor(Date.now() / 1000), live: true };
  } catch {
    return null;
  }
}

function readClaudeUsageFallback() {
  try {
    const c = JSON.parse(readFileSync(CLAUDE_USAGE_CACHE, "utf8"));
    if (c?.data?.five_hour)
      return { data: c.data, measuredAt: c.fetchedAt ?? 0, live: false };
  } catch {}
  for (const f of LEGACY_USAGE_FILES) {
    try {
      const d = JSON.parse(readFileSync(f, "utf8"));
      if (d?.five_hour)
        return {
          data: d,
          measuredAt: Math.floor(statSync(f).mtimeMs / 1000),
          live: false,
        };
    } catch {}
  }
  return null;
}

function getClaudeUsage() {
  const src = fetchClaudeUsageLive() ?? readClaudeUsageFallback();
  if (!src) return null;
  const { data: d, measuredAt, live } = src;
  try {
    const toTs = (iso) => (iso ? Math.floor(Date.parse(iso) / 1000) : null);
    const win = (o) =>
      o ? { pct: o.utilization ?? 0, resetsAt: toTs(o.resets_at) } : null;
    let fable = null;
    for (const l of d.limits || []) {
      const mdl = l.scope?.model?.display_name;
      if (l.group === "weekly" && mdl) {
        fable = {
          pct: l.percent ?? 0,
          resetsAt: toTs(l.resets_at),
          model: mdl,
        };
        break;
      }
    }
    return {
      measuredAt,
      live,
      fiveHour: win(d.five_hour),
      weekly: win(d.seven_day),
      fable,
    };
  } catch {
    return null;
  }
}

// ── 2. Cursor AI 사용량 ─────────────────────────────
const CURSOR_USAGE_CACHE = `${CLAUDE_STATE_DIR}/.cursor-usage.json`;

/**
 * 0~100 범위의 사용률 숫자로 정규화한다.
 * @param {unknown} v
 * @returns {number|null}
 */
function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

/**
 * Cursor 대시보드의 Cursor Models / Other Models 사용률을 추출한다.
 * autoPercentUsed=Cursor Models, apiPercentUsed=Other Models.
 * includedSpend/limit는 별도 $ 풀이라 % 바와 다를 수 있어 메인 지표로 쓰지 않는다.
 * @param {object} d - GetCurrentPeriodUsage 응답
 * @returns {{ autoUsed: number, apiUsed: number, usedPct: number }}
 */
function resolveCursorPoolPct(d) {
  const pu = d?.planUsage || {};
  const autoUsed =
    clampPct(pu.autoPercentUsed) ??
    clampPct(
      String(d?.autoModelSelectedDisplayMessage || "").match(
        /(\d+(?:\.\d+)?)\s*%/,
      )?.[1],
    ) ??
    0;
  const apiUsed =
    clampPct(pu.apiPercentUsed) ??
    clampPct(
      String(d?.namedModelSelectedDisplayMessage || "").match(
        /(\d+(?:\.\d+)?)\s*%/,
      )?.[1],
    ) ??
    0;
  // 메뉴바 대표값은 Cursor Models(auto). 둘 다 없으면 totalPercentUsed 폴백
  const usedPct =
    clampPct(pu.autoPercentUsed) != null
      ? autoUsed
      : (clampPct(pu.totalPercentUsed) ?? autoUsed);
  return { autoUsed, apiUsed, usedPct };
}

/**
 * Cursor 라이브 사용량을 조회한다.
 * @returns {object|null}
 */
function fetchCursorUsageLive() {
  try {
    const dbPath = `${HOME}/Library/Application Support/Cursor/User/globalStorage/state.vscdb`;
    if (!existsSync(dbPath)) return null;

    const token = execSync(
      `/usr/bin/sqlite3 "${dbPath}" "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken';"`,
      { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();

    if (!token) return null;

    const raw = execSync(
      `/usr/bin/curl -sL -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -H "Connect-Protocol-Version: 1" -d "{}" https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage`,
      { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();

    const d = JSON.parse(raw);
    if (!d?.planUsage) return null;

    const pu = d.planUsage;
    const { autoUsed, apiUsed, usedPct } = resolveCursorPoolPct(d);
    const remainPct = Math.max(0, 100 - usedPct);

    const res = {
      usedPct,
      remainPct,
      autoPercentUsed: autoUsed,
      apiPercentUsed: apiUsed,
      cycleEnd: d.billingCycleEnd
        ? Math.floor(Number(d.billingCycleEnd) / 1000)
        : null,
      displayMsg:
        d.autoModelSelectedDisplayMessage ||
        d.displayMessage ||
        d.namedModelSelectedDisplayMessage ||
        null,
      totalSpendCents: pu.totalSpend ?? null,
      includedSpendCents: pu.includedSpend ?? null,
      limitCents: pu.limit ?? null,
      measuredAt: Math.floor(Date.now() / 1000),
      live: true,
    };

    try {
      mkdirSync(CLAUDE_STATE_DIR, { recursive: true });
      writeFileSync(CURSOR_USAGE_CACHE, JSON.stringify(res));
    } catch {}

    return res;
  } catch {
    return null;
  }
}

function readCursorUsageFallback() {
  try {
    const c = JSON.parse(readFileSync(CURSOR_USAGE_CACHE, "utf8"));
    if (c && c.remainPct != null) {
      return { ...c, live: false };
    }
  } catch {}
  return null;
}

function getCursorUsage() {
  return fetchCursorUsageLive() ?? readCursorUsageFallback();
}

// ── 렌더링 ─────────────────────────────────────────────────
const claude = getClaude();
const cusage = getClaudeUsage();
const cmodels = getClaudeModels();
const cursorUsage = getCursorUsage();

const out = [];
const rem = (pct) => (pct == null ? null : Math.max(0, 100 - pct));
const hasClaude = !!cusage || !!(claude && !claude.error);
const hasCursor = !!cursorUsage;

const battItems = [];
if (cusage) {
  battItems.push({ label: "C5", remain: rem(cusage.fiveHour?.pct) });
  battItems.push({ label: "CW", remain: rem(cusage.weekly?.pct) });
  if (cusage.fable)
    battItems.push({ label: "CF", remain: rem(cusage.fable.pct) });
} else if (claude && !claude.error) {
  battItems.push({ label: "C5", remain: Math.max(0, 100 - claude.elapsedPct) });
}

if (cursorUsage) {
  const autoUsed = cursorUsage.autoPercentUsed ?? cursorUsage.usedPct ?? 0;
  const apiUsed = cursorUsage.apiPercentUsed;
  battItems.push({ label: "Cr", remain: Math.round(rem(autoUsed)) });
  if (apiUsed != null) {
    battItems.push({ label: "Co", remain: Math.round(rem(apiUsed)) });
  }
}

if (battItems.length) {
  out.push(`| image=${renderBatteryImage(isDarkMode(), battItems)}`);
} else {
  out.push("🔋 —");
}
out.push("---");

const legendParts = [];
if (hasClaude) legendParts.push("C5·CW·CF = Claude");
if (hasCursor) legendParts.push("Cr = Cursor Models  ·  Co = Other Models");
if (legendParts.length) {
  out.push(
    `🔋 남은 %  ·  ${legendParts.join("  ·  ")} | size=11 color=#8b949e`,
  );
  out.push("---");
}

// Claude 상세
if (hasClaude) {
  out.push("Claude Code | size=13 color=#8b949e");
  if (cusage) {
    const winRow = (label, w) => {
      if (!w) return;
      const r = Math.max(0, 100 - (w.pct ?? 0));
      const reset = w.resetsAt
        ? w.resetsAt < now
          ? "리셋됨"
          : `리셋 ${fmtDur(w.resetsAt - now)}`
        : "";
      out.push(
        `${label} ▕${bar(r, 20)}▏ ${Math.round(r)}%  (사용 ${Math.round(w.pct ?? 0)}%)${reset ? "  ·  " + reset : ""} | font=Menlo color=${heatRemainHex(r)}`,
      );
    };
    winRow("5시간 남음", cusage.fiveHour);
    winRow("주간 남음 ", cusage.weekly);
    if (cusage.fable) winRow(`${cusage.fable.model} 남음`, cusage.fable);
    out.push(
      cusage.live
        ? `라이브 (Anthropic usage API) | size=11 color=#8b949e`
        : `측정 ${fmtDur(now - cusage.measuredAt)} 전 (캐시 폴백) | size=11 color=#d29922`,
    );
  }
  if (claude && !claude.error) {
    out.push(
      `블록 비용  $${claude.cost.toFixed(2)} (${fmtKRW(claude.cost)})  ·  ${fmtTok(claude.tokens)} 토큰  ·  $${claude.costPerHour?.toFixed(1) ?? "?"}/h | font=Menlo size=11 color=#8b949e`,
    );
  }
  if (cmodels && cmodels.models.length) {
    out.push(
      `오늘 모델별  ·  합 $${cmodels.total.toFixed(0)} (${fmtKRW(cmodels.total)}) | size=11 color=#8b949e`,
    );
    const maxCost = cmodels.models[0].cost || 1;
    for (const m of cmodels.models) {
      const g = bar((m.cost / maxCost) * 100, 12);
      const label = shortModel(m.name).padEnd(9, " ");
      out.push(
        `${label}▕${g}▏ $${m.cost.toFixed(1)} (${fmtKRW(m.cost)})  ${fmtTok(m.tokens)} | font=Menlo`,
      );
    }
  }
  const claudeUsd = (cmodels?.total || (claude && !claude.error ? claude.cost : 0) || 0);
  if (claudeUsd > 0) {
    const claudeKrw = Math.round(claudeUsd * EXCHANGE_RATE_KRW);
    out.push(
      `💳 지금까지 Claude 약 ${claudeKrw.toLocaleString()}원($${claudeUsd.toFixed(2)})을 사용하셨습니다! | font=Menlo size=12 color=#30D158`,
    );
  }
  out.push("---");
}

// Cursor 상세
if (hasCursor) {
  out.push("Cursor AI | size=13 color=#8b949e");
  const resetStr = cursorUsage.cycleEnd
    ? cursorUsage.cycleEnd < now
      ? "리셋됨"
      : `리셋 ${fmtDur(cursorUsage.cycleEnd - now)}`
    : "";
  const poolRow = (label, used) => {
    if (used == null) return;
    const u = Math.round(used);
    const r = Math.max(0, 100 - u);
    out.push(
      `${label} ▕${bar(r, 20)}▏ ${r}%  (사용 ${u}%)${resetStr ? "  ·  " + resetStr : ""} | font=Menlo color=${heatRemainHex(r)}`,
    );
  };
  const autoUsed = cursorUsage.autoPercentUsed ?? cursorUsage.usedPct;
  const apiUsed = cursorUsage.apiPercentUsed;
  poolRow("Cursor Models", autoUsed);
  poolRow("Other Models ", apiUsed);
  if (cursorUsage.displayMsg) {
    out.push(
      `      ${cursorUsage.displayMsg} | font=Menlo size=11 color=#8b949e`,
    );
  }
  out.push(
    cursorUsage.live
      ? `라이브 (Cursor API) | size=11 color=#8b949e`
      : `측정 ${fmtDur(now - cursorUsage.measuredAt)} 전 (캐시 폴백) | size=11 color=#d29922`,
  );
  const cursorUsd = cursorUsage?.totalSpendCents
    ? cursorUsage.totalSpendCents / 100
    : 0;
  if (cursorUsd > 0) {
    const cursorKrw = Math.round(cursorUsd * EXCHANGE_RATE_KRW);
    out.push(
      `💳 지금까지 Cursor 약 ${cursorKrw.toLocaleString()}원($${cursorUsd.toFixed(2)})을 사용하셨습니다! | font=Menlo size=12 color=#30D158`,
    );
  }
  out.push("---");
}

if (!hasClaude && !hasCursor) {
  out.push(
    "Claude Code나 Cursor를 로그인하여 실행하면 사용량이 표시됩니다 | size=12 color=gray",
  );
  out.push("---");
}

const upd = getUpdateInfo();
if (upd.hasUpdate) {
  out.push(
    `🆕 v${upd.latest} 업데이트 (현재 v${VERSION}) | bash="${SELF_DIR}/.ccb-update.sh" terminal=false refresh=true color=#28963f`,
  );
} else {
  out.push(
    `⬆️ 지금 업데이트 — GitHub 최신으로 교체 (현재 v${VERSION}) | bash="${SELF_DIR}/.ccb-update.sh" terminal=false refresh=true`,
  );
}
out.push("🔄 지금 새로고침 | refresh=true");
if (claude && !claude.error) {
  out.push(
    `📊 ccusage 대시보드 열기 | bash="${CCUSAGE}" param1=blocks param2=--active terminal=true`,
  );
}
out.push(
  `v${VERSION}  ·  Claude & Cursor Usage Battery | size=11 color=#8b949e`,
);
{
  const other = SIZE === "big" ? "small" : "big";
  out.push(
    `↕ 배터리 크기: ${SIZE === "big" ? "크게 (기본)" : "작게"} — 클릭하면 ${other === "big" ? "크게" : "작게"}로 | bash=/bin/sh param1=-c param2="mkdir -p '${HOME}/.claude/swiftbar' && echo ${other} > '${SIZE_FILE}'" terminal=false refresh=true size=11 color=#8b949e`,
  );
}
out.push(
  `⭐ github.com/HDomi/ai-usage-battery | href=https://github.com/HDomi/ai-usage-battery size=11 color=#8b949e`,
);
out.push(
  `✕ 위젯 끄기 (SwiftBar 설정에서 재활성화) | href=swiftbar://disableplugin?plugin=claude-cursor-usage size=11 color=#8b949e`,
);

console.log(out.join("\n"));
