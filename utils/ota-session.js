/**
 * Cache session đăng nhập OTA (Blue PMS) + khóa tài khoản sau N lần sai mật khẩu
 * + circuit breaker khi hạ tầng chặn (Cloudflare 403, 429, 5xx, timeout).
 *
 * LÝ DO TỒN TẠI: code cũ login lại từ đầu ở mọi lần gọi → 600 lượt login/giờ từ
 * một IP, và Cloudflare của id.bluejaypms.com đã chặn cứng IP server. Nhưng
 * nhiều cơ sở dùng CHUNG credentials: 15 lượt check mỗi tick chỉ ứng với 3 tài
 * khoản OTA thật. Vì vậy cache theo TÀI KHOẢN (email + hotelId), không theo
 * facility.
 *
 * THIẾT KẾ: module này KHÔNG gọi HTTP. Hàm login được truyền vào (loginFn) nên
 * dùng được với cả server.js (loginAndResolveCookies) và booking-monitor.js
 * (loginFacility) mà không phải hợp nhất hai bản login gần-trùng-lặp đó.
 *
 * Env xem .env.example, mục "OTA Session Cache & Login Lock".
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { sendAdminAlert } = require("./telegram");

const CONFIG_DIR = path.join(__dirname, "..", "config");
const FACILITIES_PATH = path.join(CONFIG_DIR, "facilities.json");

// Session/cờ khóa nằm ở FILE RIÊNG, không ghi vào facilities.json:
//   - facilities.json là bản duy nhất chứa mật khẩu OTA của 27 cơ sở, không có
//     backup, nên tốt nhất là code không bao giờ ghi vào đó.
//   - file này tái tạo được, nên `rm config/sessions.json` là cách reset sạch
//     session + mở mọi khóa.
// Tự tạo khi chưa có.
const STORE_PATH = path.join(CONFIG_DIR, "sessions.json");

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const TTL_MS = num(process.env.OTA_SESSION_TTL_MS, 30 * 60 * 1000);
const BUFFER_MS = num(process.env.OTA_SESSION_BUFFER_MS, 5 * 60 * 1000);
const MIN_LOGIN_INTERVAL_MS = num(process.env.OTA_SESSION_MIN_LOGIN_INTERVAL_MS, 30 * 1000);
const MAX_LOGIN_FAILURES = num(process.env.OTA_MAX_LOGIN_FAILURES, 3);
const INFRA_THRESHOLD = num(process.env.OTA_INFRA_FAILURE_THRESHOLD, 5);
const CB_BASE_MS = num(process.env.OTA_CIRCUIT_BACKOFF_MS, 10 * 60 * 1000);
const CB_MAX_MS = num(process.env.OTA_CIRCUIT_BACKOFF_MAX_MS, 60 * 60 * 1000);

const DEFAULT_CIRCUIT = {
  openUntil: null,
  consecutiveInfraFailures: 0,
  lastError: null,
  lastErrorAt: null,
  lastErrorStatus: null,
  notifiedAt: null,
  trialAt: null,
};

// ─── Khóa tài khoản ──────────────────────────────────────────────────────────

// Khóa cache = tài khoản OTA. hotelId phải nằm trong khóa: chọn hotel trên
// /my-hotels là một postback thay đổi state phía server, nên session đã chọn
// hotel 11711 không dùng được cho 13801 dù cùng email.
function accountKey(facility) {
  const email = String((facility && facility.email) || "").trim().toLowerCase();
  const hotelId =
    facility && facility.hotelId != null && facility.hotelId !== ""
      ? String(facility.hotelId)
      : "";
  return `${email}|${hotelId}`;
}

// Dấu vết mật khẩu: đổi mật khẩu trong facilities.json => cache và khóa tự hủy.
// Nhờ vậy "sửa mật khẩu" chính là hành động mở khóa, không cần bước thứ hai.
function pwFingerprint(password) {
  return crypto
    .createHash("sha256")
    .update(String(password || ""))
    .digest("hex")
    .slice(0, 12);
}

// ─── Đọc store (cache theo mtime) ────────────────────────────────────────────

// Cache chỉ dựa trên (mtimeMs, size), KHÔNG dựa trên thời gian đã trôi qua:
// process kia (server.js hoặc monitor) ghi file thì lần đọc kế tiếp phải thấy
// ngay. statSync rẻ hơn JSON.parse rất nhiều nên vẫn tiết kiệm được phần đắt.
let storeCache = { stamp: null, data: null };
let facilitiesCache = { stamp: null, data: null };

function readJsonCached(filePath, cache, fallback) {
  let stamp;
  try {
    const st = fs.statSync(filePath);
    stamp = `${st.mtimeMs}:${st.size}`;
  } catch (_) {
    // File không còn (lần chạy đầu, hoặc admin `rm config/sessions.json` để
    // reset sạch). Phải BỎ cache trong RAM, nếu không process vẫn dùng session
    // cũ mãi và việc xóa file thành vô nghĩa.
    cache.data = null;
    cache.stamp = null;
    return fallback;
  }

  if (cache.data && stamp === cache.stamp) return cache.data;

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    cache.data = parsed;
    cache.stamp = stamp;
    return parsed;
  } catch (e) {
    console.error(`❌ Không đọc được ${filePath}: ${e.message}`);
    // Giữ bản parse tốt cuối cùng thay vì làm sập luồng đang chạy.
    return cache.data || fallback;
  }
}

function readStore() {
  return readJsonCached(STORE_PATH, storeCache, {});
}

// facilities.json phải đọc lại theo mtime, không phải chỉ 1 lần lúc boot:
// nếu server.js giữ mật khẩu cũ trong khi monitor đã login bằng mật khẩu mới,
// pwFingerprint sẽ lệch và hai process sẽ luân phiên hủy session của nhau.
function getFacilities() {
  const data = readJsonCached(FACILITIES_PATH, facilitiesCache, { facilities: {} });
  return (data && data.facilities) || {};
}

function getSessionRecord(key) {
  const store = readStore();
  return (store.sessions && store.sessions[key]) || null;
}

function getCircuit() {
  const store = readStore();
  return { ...DEFAULT_CIRCUIT, ...(store.circuitBreaker || {}) };
}

// ─── Ghi store (atomic, đọc-sửa-ghi) ─────────────────────────────────────────

/**
 * Đọc-sửa-ghi store một cách atomic.
 *
 * BẤT BIẾN QUAN TRỌNG: thân hàm này HOÀN TOÀN ĐỒNG BỘ (không có await), nên
 * event loop một luồng của Node đảm bảo toàn bộ đọc-sửa-ghi là nguyên tử với
 * mọi task khác trong cùng process — kể cả Promise.all 6 facility cùng tài
 * khoản. ĐỪNG thêm await vào đây hay vào mutator: làm vậy là mở lại đúng cửa
 * sổ đọc-A/đọc-A/ghi-A'/ghi-A''. Mọi việc gửi Telegram phải làm SAU khi hàm
 * này trả về.
 *
 * @param {(store) => (void|false)} mutator trả về false để bỏ ghi
 * @returns {object} store sau khi ghi (hoặc bản trên đĩa nếu không ghi)
 */
function mutateStore(mutator) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let disk = {};
    try {
      disk = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
    } catch (_) {
      disk = {}; // chưa có file (lần chạy đầu, hoặc admin vừa xóa để reset)
    }

    const rev = disk._rev || 0;
    const next = {
      sessions: { ...(disk.sessions || {}) },
      circuitBreaker: { ...DEFAULT_CIRCUIT, ...(disk.circuitBreaker || {}) },
      _rev: rev + 1,
    };

    if (mutator(next) === false) return disk;

    let json;
    try {
      json = JSON.stringify(next, null, 2);
      JSON.parse(json); // vòng kiểm tra serialize
    } catch (e) {
      console.error(`❌ Bỏ ghi session store: ${e.message}`);
      sendAdminAlert(
        `🚨 <b>[OTA-STORE]</b> Từ chối ghi ${path.basename(STORE_PATH)}\nLý do: ${e.message}`,
      ).catch(() => {});
      return disk;
    }

    // Optimistic concurrency: nếu process khác vừa ghi thì làm lại trên bản mới.
    try {
      if (fs.existsSync(STORE_PATH)) {
        const cur = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
        if ((cur._rev || 0) !== rev) continue;
      }
    } catch (_) {
      // Không đọc lại được thì cứ ghi — tmp+rename vẫn an toàn.
    }

    const tmp = `${STORE_PATH}.tmp.${process.pid}.${Date.now()}`;
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      const fd = fs.openSync(tmp, "w");
      fs.writeSync(fd, json);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fs.renameSync(tmp, STORE_PATH); // atomic trong cùng directory
    } catch (e) {
      console.error(`❌ Ghi session store thất bại: ${e.message}`);
      try {
        fs.unlinkSync(tmp);
      } catch (_) {}
      return disk;
    }

    // Vô hiệu cache đọc để lần đọc kế tiếp stat lại file vừa ghi.
    storeCache = { stamp: null, data: next };
    return next;
  }

  console.error("⚠️  Bỏ ghi session store sau 3 lần tranh chấp _rev");
  return readStore();
}

function blankRecord(facility) {
  return {
    email: (facility && facility.email) || null,
    hotelId: facility && facility.hotelId != null ? facility.hotelId : null,
    pwFingerprint: pwFingerprint(facility && facility.password),
    cookies: "",
    createdAt: new Date().toISOString(),
    expiresAt: null,
    lastLoginAt: null,
    loginCount: 0,
    consecutiveFailures: 0,
    lastFailure: null,
    locked: false,
    lockedAt: null,
    lockReason: null,
  };
}

// ─── Phân loại lỗi login ─────────────────────────────────────────────────────

const INFRA_STATUSES = [403, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524];
const CLOUDFLARE_RE = /have been blocked|Attention Required|cf-ray|Cloudflare Ray ID|cloudflare/i;
const NETWORK_RE = /ECONNRESET|ETIMEDOUT|ECONNABORTED|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EPIPE|socket hang up|timeout/i;

/**
 * "credential" = tới được app, POST /login bị từ chối (không có HtToken hoặc
 *                redirect về /login), hoặc hotelId sai/thiếu → tính vào khóa.
 * "infra"      = 403/429/5xx/mạng → KHÔNG tính vào khóa, đẩy vào circuit
 *                breaker. Nếu tính, thì IP bị Cloudflare chặn sẽ khóa sạch mọi
 *                tài khoản sau ~9 phút và admin phải mở tay từng cái khi IP thông.
 */
function classifyLoginFailure(result, error) {
  if (error) {
    const status = error.response && error.response.status;
    const body = String((error.response && error.response.data) || "").slice(0, 4000);
    if (status === 403 && CLOUDFLARE_RE.test(body)) {
      return { kind: "infra", status, message: "Cloudflare đã chặn IP này (403)" };
    }
    if (status != null && INFRA_STATUSES.includes(status)) {
      return { kind: "infra", status, message: `OTA trả về HTTP ${status}` };
    }
    if (NETWORK_RE.test(error.code || "") || NETWORK_RE.test(error.message || "")) {
      return { kind: "infra", status: null, message: `Lỗi mạng: ${error.message}` };
    }
    return { kind: "infra", status: status == null ? null : status, message: error.message };
  }

  const r = result || {};
  const status =
    r.otaStatus != null ? r.otaStatus : r.status != null ? r.status : (r.details && r.details.status);
  if (status != null && (INFRA_STATUSES.includes(status) || status >= 500)) {
    return { kind: "infra", status, message: r.error || `OTA trả về HTTP ${status}` };
  }
  const msg = String(r.error || "");
  if (CLOUDFLARE_RE.test(String((r.details && r.details.data) || ""))) {
    return { kind: "infra", status: status == null ? null : status, message: "Cloudflare đã chặn IP này" };
  }
  if (NETWORK_RE.test(msg)) {
    return { kind: "infra", status: null, message: `Lỗi mạng: ${msg}` };
  }
  return {
    kind: "credential",
    status: status == null ? null : status,
    message: msg || "Đăng nhập OTA thất bại",
  };
}

// ─── Circuit breaker ─────────────────────────────────────────────────────────

function isCircuitOpen(now = Date.now()) {
  const cb = getCircuit();
  return !!(cb.openUntil && now < new Date(cb.openUntil).getTime());
}

function circuitState() {
  const cb = getCircuit();
  const openUntilMs = cb.openUntil ? new Date(cb.openUntil).getTime() : 0;
  const now = Date.now();
  return {
    open: openUntilMs > now,
    openUntil: cb.openUntil,
    retryAfterMs: Math.max(0, openUntilMs - now),
    consecutiveInfraFailures: cb.consecutiveInfraFailures || 0,
    lastError: cb.lastError,
    lastErrorAt: cb.lastErrorAt,
    lastErrorStatus: cb.lastErrorStatus,
  };
}

function recordInfraFailure(cls, log) {
  const now = Date.now();
  let opened = null;

  const store = mutateStore((next) => {
    const cb = next.circuitBreaker;
    cb.consecutiveInfraFailures = (cb.consecutiveInfraFailures || 0) + 1;
    cb.lastError = cls.message;
    cb.lastErrorAt = new Date(now).toISOString();
    cb.lastErrorStatus = cls.status;
    cb.trialAt = null;

    const already = cb.openUntil && now < new Date(cb.openUntil).getTime();
    if (!already && cb.consecutiveInfraFailures >= INFRA_THRESHOLD) {
      const over = cb.consecutiveInfraFailures - INFRA_THRESHOLD;
      const backoff = Math.min(CB_BASE_MS * Math.pow(2, over), CB_MAX_MS);
      cb.openUntil = new Date(now + backoff).toISOString();
      opened = { openUntil: cb.openUntil, backoff };
    }
  });

  if (opened) {
    const mins = Math.round(opened.backoff / 60000);
    sendAdminAlert(
      `⛔ <b>[OTA-CB] Tạm dừng gọi OTA</b>\n` +
        `Lý do: ${cls.message}\n` +
        `Số lỗi hạ tầng liên tiếp: ${(store.circuitBreaker || {}).consecutiveInfraFailures}\n` +
        `Dừng tới: ${opened.openUntil} (~${mins} phút)\n` +
        `Hệ thống sẽ tự thử lại, không cần mở tay.`,
      log,
    ).catch(() => {});
  }
  return circuitState();
}

function recordInfraSuccess(log) {
  const cb = getCircuit();
  if (!cb.openUntil && !cb.consecutiveInfraFailures) return;
  mutateStore((next) => {
    next.circuitBreaker = { ...DEFAULT_CIRCUIT };
  });
  sendAdminAlert(
    "✅ <b>[OTA-CB] Đã kết nối lại OTA</b>\nCircuit breaker đóng, monitor chạy bình thường.",
    log,
  ).catch(() => {});
}

function resetCircuit() {
  mutateStore((next) => {
    next.circuitBreaker = { ...DEFAULT_CIRCUIT };
  });
  return circuitState();
}

// Cho phép đúng MỘT lần thử khi backoff vừa hết (half-open), tránh 15 facility
// cùng thử lại một lúc.
function claimCircuitTrial(now = Date.now()) {
  let claimed = false;
  mutateStore((next) => {
    const cb = next.circuitBreaker;
    if (!cb.openUntil) return false;
    if (now < new Date(cb.openUntil).getTime()) return false;
    if (cb.trialAt && now - new Date(cb.trialAt).getTime() < MIN_LOGIN_INTERVAL_MS) return false;
    cb.trialAt = new Date(now).toISOString();
    claimed = true;
  });
  return claimed;
}

// ─── Khóa / thất bại ─────────────────────────────────────────────────────────

function facilityNamesForKey(key) {
  const facilities = getFacilities();
  return Object.entries(facilities)
    .filter(([, f]) => accountKey(f) === key)
    .map(([id, f]) => ({ id, name: f.name || id }));
}

function recordFailure(key, facility, cls, log) {
  if (cls.kind === "infra") {
    const cb = recordInfraFailure(cls, log);
    return {
      ok: false,
      code: cb.open ? "CIRCUIT_OPEN" : "LOGIN_FAILED",
      key,
      error: cls.message,
      failureKind: "infra",
      status: cls.status,
      retryAfterMs: cb.retryAfterMs,
      openUntil: cb.openUntil,
    };
  }

  const now = Date.now();
  let justLocked = false;
  let failures = 0;

  mutateStore((next) => {
    const rec = next.sessions[key] || blankRecord(facility);
    rec.cookies = "";
    rec.expiresAt = null;
    rec.consecutiveFailures = (rec.consecutiveFailures || 0) + 1;
    rec.lastFailure = {
      at: new Date(now).toISOString(),
      kind: "credential",
      status: cls.status,
      error: cls.message,
    };
    failures = rec.consecutiveFailures;
    if (MAX_LOGIN_FAILURES > 0 && failures >= MAX_LOGIN_FAILURES && !rec.locked) {
      rec.locked = true;
      rec.lockedAt = new Date(now).toISOString();
      rec.lockReason = cls.message;
      justLocked = true;
    }
    next.sessions[key] = rec;
  });

  const who = `${facility.email || "?"}${facility.hotelId ? ` (hotelId ${facility.hotelId})` : ""}`;
  if (justLocked) {
    const affected = facilityNamesForKey(key);
    const list = affected.map((f) => f.name).join(", ") || "(không xác định)";
    sendAdminAlert(
      `🚨 <b>[OTA-LOCK] Tài khoản OTA bị khóa</b>\n` +
        `Tài khoản: ${who}\n` +
        `Cơ sở ảnh hưởng (${affected.length}): ${list}\n` +
        `Lý do: ${cls.message}\n` +
        `Số lần sai liên tiếp: ${failures}\n\n` +
        `<b>Mở lại thủ công</b> — sửa <code>config/sessions.json</code>:\n` +
        `<code>sessions["${key}"].locked = false</code>\n` +
        `Hoặc: sửa lại mật khẩu trong facilities.json (khóa tự mở), ` +
        `hoặc xóa hẳn file <code>config/sessions.json</code> để reset mọi khóa.`,
      log,
    ).catch(() => {});
  } else {
    // Gửi mọi lần thất bại để admin theo dõi được. Không sợ spam: sau
    // MAX_LOGIN_FAILURES lần là tài khoản bị khóa và không thử login nữa.
    sendAdminAlert(
      `⚠️ <b>Đăng nhập OTA thất bại</b>\n` +
        `Tài khoản: ${who}\n` +
        `Lỗi: ${cls.message}\n` +
        `Lần thất bại liên tiếp: ${failures}/${MAX_LOGIN_FAILURES || "∞"}`,
      log,
    ).catch(() => {});
  }

  return {
    ok: false,
    code: justLocked ? "LOCKED" : "LOGIN_FAILED",
    key,
    error: cls.message,
    failureKind: "credential",
    status: cls.status,
    consecutiveFailures: failures,
    locked: justLocked,
    remainingAttempts: MAX_LOGIN_FAILURES > 0 ? Math.max(0, MAX_LOGIN_FAILURES - failures) : null,
  };
}

function recordSuccess(key, facility, cookies, log) {
  const now = Date.now();
  const expiresAt = new Date(now + TTL_MS).toISOString();

  mutateStore((next) => {
    const rec = next.sessions[key] || blankRecord(facility);
    rec.email = facility.email || rec.email;
    rec.hotelId = facility.hotelId != null ? facility.hotelId : null;
    rec.pwFingerprint = pwFingerprint(facility.password);
    rec.cookies = cookies;
    rec.expiresAt = expiresAt;
    rec.lastLoginAt = new Date(now).toISOString();
    rec.loginCount = (rec.loginCount || 0) + 1;
    rec.consecutiveFailures = 0;
    rec.lastFailure = null;
    rec.locked = false;
    rec.lockedAt = null;
    rec.lockReason = null;
    next.sessions[key] = rec;
  });

  recordInfraSuccess(log);

  return { ok: true, cookies, key, fromCache: false, expiresAt };
}

// ─── Điểm vào chính ──────────────────────────────────────────────────────────

// key -> Promise đang login. Chống thundering herd: 6 facility dùng chung một
// tài khoản trong cùng Promise.all chỉ tạo ĐÚNG MỘT lượt login.
const inflight = new Map();

/**
 * Lấy cookie dùng được cho một facility, login lại chỉ khi cần.
 *
 * @param {object}   facility  entry trong facilities.json
 * @param {Function} loginFn   async (facility) => { success, cookies, error?, otaStatus? }
 * @param {object}   [opts]    { log, force }
 * @returns {Promise<object>}  { ok:true, cookies, key, fromCache, expiresAt }
 *                             | { ok:false, code, key, error, ... }
 *   code: LOCKED | CIRCUIT_OPEN | LOGIN_FAILED | NO_CREDENTIALS
 */
async function ensureFacilityCookies(facility, loginFn, opts = {}) {
  const log = opts.log || console.log;
  const key = accountKey(facility);
  const now = Date.now();

  if (!facility || !facility.email || !facility.password) {
    return {
      ok: false,
      code: "NO_CREDENTIALS",
      key,
      error: `Facility "${(facility && facility.name) || "?"}" thiếu email hoặc password trong facilities.json`,
    };
  }

  let rec = getSessionRecord(key);

  // Đổi mật khẩu trong config = ý định mở khóa. Hủy cache + khóa cũ.
  if (rec && rec.pwFingerprint && rec.pwFingerprint !== pwFingerprint(facility.password)) {
    log(`🔑 Mật khẩu của ${facility.email} đã đổi — hủy session và mở khóa cũ`);
    mutateStore((next) => {
      if (next.sessions[key]) delete next.sessions[key];
    });
    rec = null;
  }

  if (rec && rec.locked) {
    return {
      ok: false,
      code: "LOCKED",
      key,
      error:
        "Tài khoản OTA đã bị khóa sau nhiều lần đăng nhập thất bại. Admin cần mở khóa thủ công.",
      lockedAt: rec.lockedAt,
      lockReason: rec.lockReason,
      consecutiveFailures: rec.consecutiveFailures || 0,
    };
  }

  // Cache còn hạn (trừ buffer) → không phát sinh request nào.
  if (!opts.force && rec && rec.cookies && rec.expiresAt) {
    if (now < new Date(rec.expiresAt).getTime() - BUFFER_MS) {
      return { ok: true, cookies: rec.cookies, key, fromCache: true, expiresAt: rec.expiresAt };
    }
  }

  // Circuit breaker: cache hết hạn mà hạ tầng đang chặn → không thử login.
  if (isCircuitOpen(now)) {
    const cb = circuitState();
    return {
      ok: false,
      code: "CIRCUIT_OPEN",
      key,
      error: `Không kết nối được OTA (${cb.lastError || "lỗi hạ tầng"}). Hệ thống sẽ tự thử lại.`,
      retryAfterMs: cb.retryAfterMs,
      openUntil: cb.openUntil,
    };
  }
  const cb = getCircuit();
  if (cb.openUntil && !claimCircuitTrial(now)) {
    // Backoff vừa hết nhưng lượt thử đã có người khác nhận.
    const st = circuitState();
    return {
      ok: false,
      code: "CIRCUIT_OPEN",
      key,
      error: "Đang thử kết nối lại OTA, chờ lượt sau.",
      retryAfterMs: st.retryAfterMs,
      openUntil: st.openUntil,
    };
  }

  // Sàn chống dồn dập: vừa login xong mà vẫn còn cookie thì dùng lại.
  if (rec && rec.cookies && rec.lastLoginAt && !opts.force) {
    if (now - new Date(rec.lastLoginAt).getTime() < MIN_LOGIN_INTERVAL_MS) {
      return { ok: true, cookies: rec.cookies, key, fromCache: true, expiresAt: rec.expiresAt };
    }
  }

  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    let result = null;
    let thrown = null;
    try {
      result = await loginFn(facility);
    } catch (e) {
      thrown = e;
    }

    if (!thrown && result && result.success && result.cookies) {
      return recordSuccess(key, facility, result.cookies, log);
    }
    const cls = classifyLoginFailure(result, thrown);
    return recordFailure(key, facility, cls, log);
  })();

  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

/**
 * Hủy session — chỉ khi cookie trên đĩa VẪN là bản mà caller vừa dùng
 * (compare-and-swap). Nhờ vậy khi 6 facility cùng phát hiện session chết, chỉ
 * facility đầu tiên hủy được; 5 cái sau thấy cookie đã là bản mới nên không
 * hủy oan, chúng chỉ cần đọc lại cache.
 * Giữ nguyên consecutiveFailures — đây không phải một lần login thất bại.
 */
function invalidate(key, expectedCookies) {
  let cleared = false;
  mutateStore((next) => {
    const rec = next.sessions[key];
    if (!rec || !rec.cookies) return false;
    if (expectedCookies && rec.cookies !== expectedCookies) return false;
    rec.cookies = "";
    rec.expiresAt = null;
    cleared = true;
  });
  return cleared;
}

/**
 * Gọi một request cần session, tự login lại đúng MỘT lần nếu OTA từ chối session.
 *
 * @param {object}   facility
 * @param {Function} loginFn
 * @param {Function} requestFn  async (cookies) => result
 * @param {object}   [opts]     { log, isRejected }
 *   isRejected(result) mặc định: result.sessionExpired === true
 */
async function withSession(facility, loginFn, requestFn, opts = {}) {
  const isRejected = opts.isRejected || ((out) => !!(out && out.sessionExpired));
  const key = accountKey(facility);

  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await ensureFacilityCookies(facility, loginFn, opts);
    if (!s.ok) return s;

    let out;
    try {
      out = await requestFn(s.cookies);
    } catch (e) {
      const cls = classifyLoginFailure(null, e);
      if (cls.kind === "infra") recordInfraFailure(cls, opts.log);
      throw e;
    }

    if (!isRejected(out)) {
      return { ok: true, result: out, cookies: s.cookies, key, fromCache: s.fromCache };
    }

    invalidate(key, s.cookies);

    // Cookie vừa tạo mà đã bị từ chối → login lại cũng vô ích (OTA đổi cơ chế,
    // hoặc session bị ghim theo IP). Dừng để không quay vòng vô hạn.
    if (!s.fromCache) {
      return {
        ok: false,
        code: "SESSION_REJECTED",
        key,
        error: "OTA từ chối session vừa được tạo — có thể session bị ghim theo IP",
        result: out,
      };
    }
  }
}

// ─── Vận hành ────────────────────────────────────────────────────────────────

// Mở khóa. Dùng cho script/endpoint sau này; hiện admin mở bằng cách sửa file.
function unlock(selector = {}) {
  const unlocked = [];
  mutateStore((next) => {
    for (const [key, rec] of Object.entries(next.sessions || {})) {
      if (!selector.all && selector.key !== key) continue;
      if (!rec.locked && !rec.consecutiveFailures) continue;
      rec.locked = false;
      rec.lockedAt = null;
      rec.lockReason = null;
      rec.consecutiveFailures = 0;
      rec.lastFailure = null;
      unlocked.push(key);
    }
    if (!unlocked.length) return false;
  });
  return unlocked;
}

// Trạng thái session, KHÔNG trả về chuỗi cookie.
function listSessions() {
  const store = readStore();
  return Object.entries(store.sessions || {}).map(([key, rec]) => ({
    key,
    email: rec.email,
    hotelId: rec.hotelId,
    facilities: facilityNamesForKey(key),
    hasCookies: !!rec.cookies,
    expiresAt: rec.expiresAt,
    lastLoginAt: rec.lastLoginAt,
    loginCount: rec.loginCount || 0,
    locked: !!rec.locked,
    lockedAt: rec.lockedAt,
    lockReason: rec.lockReason,
    consecutiveFailures: rec.consecutiveFailures || 0,
    lastFailure: rec.lastFailure,
  }));
}

function getSessionState(facility) {
  const key = accountKey(facility);
  return listSessions().find((s) => s.key === key) || null;
}

module.exports = {
  accountKey,
  ensureFacilityCookies,
  withSession,
  invalidate,
  unlock,
  listSessions,
  getSessionState,
  getFacilities,
  classifyLoginFailure,
  isCircuitOpen,
  circuitState,
  recordInfraFailure,
  resetCircuit,
  // để test
  _config: {
    STORE_PATH,
    TTL_MS,
    BUFFER_MS,
    MAX_LOGIN_FAILURES,
    INFRA_THRESHOLD,
    MIN_LOGIN_INTERVAL_MS,
  },
};
