/**
 * booking-monitor.js
 * Single process - theo dõi booking cho TẤT CẢ users đồng thời.
 *
 * Config per-user lấy từ config/users.json:
 *   telegram_bot_token  - bot token riêng của từng user
 *   telegram_chat_id    - chat ID Telegram của từng user
 *   facilities          - danh sách facility ID cần theo dõi
 *
 * Env vars (dùng chung, khai báo trong .env):
 *   OTA_BASE_URL        - (mặc định: https://id.bluejaypms.com)
 *   MONITOR_INTERVAL_MS - (mặc định: 180000 = 3 phút)
 */

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { URLSearchParams } = require("url");
const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");
dayjs.extend(customParseFormat);

// ─── Shared config ──────────────────────────────────────────────────────────
const BASE_URL = process.env.OTA_BASE_URL || "https://id.bluejaypms.com";
const LOGIN_PATH = `${BASE_URL}/login`;
const RESERVATION_PATH = `${BASE_URL}/app/Reservation`;
const MONITOR_INTERVAL = parseInt(process.env.MONITOR_INTERVAL_MS) || 3 * 60 * 1000;

const { getTextPayment } = require("./utils/booking-utils");
const otaSession = require("./utils/ota-session");
const { sendAdminAlert } = require("./utils/telegram");

const USERS_FILE = path.join(__dirname, "config", "users.json");
const FACILITIES_FILE = path.join(__dirname, "config", "facilities.json");

const SEARCH_TYPES = [
  { name: "Phòng đến", typeSeachDate: 0 },
  { name: "Phòng đi", typeSeachDate: 1 },
  { name: "Phòng lưu", typeSeachDate: 3 },
];

const HTTP_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
  "Cache-Control": "no-cache",
};

// ─── User loading ────────────────────────────────────────────────────────────
function loadActiveUsers() {
  try {
    const { users } = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    return users.filter((u) => u.active && u.telegram_bot_token && u.telegram_chat_id && u.facilities?.length);
  } catch (e) {
    log(`❌ Không đọc được users.json: ${e.message}`);
    return [];
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────
function log(msg, username) {
  const ts = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  const prefix = username ? `[${username}]` : "";
  console.log(`[${ts}]${prefix} ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatDate(date) {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function bookingKey(b) {
  return `${b.bookingCode}|${b.otaReference}`;
}

function extractRoomNumber(roomName) {
  if (!roomName) return roomName;
  const m = roomName.match(/(?:P?\s*)?(\d+)\s*$/i);
  return m ? m[1] : roomName;
}

function getTodayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── Snapshot I/O (per-user) ─────────────────────────────────────────────────
function getSnapshotDir(username) {
  return path.join(__dirname, "snapshots", username);
}

function getSnapshotFile(username) {
  const dir = getSnapshotDir(username);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `snapshot_${getTodayKey()}.json`);
}

function loadSnapshot(username) {
  const file = getSnapshotFile(username);
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    }
  } catch (e) {
    log(`⚠️  Không đọc được snapshot: ${e.message}`, username);
  }
  return { lastUpdated: null, date: getTodayKey(), totalBookings: 0, bookings: [], pageTracker: {}, bookingKeys: [] };
}

function saveSnapshot(snapshot, username) {
  const file = getSnapshotFile(username);
  try {
    fs.writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf-8");
  } catch (e) {
    log(`❌ Không ghi được snapshot: ${e.message}`, username);
  }
}

// ─── Facilities (per-user) ───────────────────────────────────────────────────
function loadUserFacilities(facilityIds) {
  try {
    const raw = fs.readFileSync(FACILITIES_FILE, "utf-8");
    const all = JSON.parse(raw).facilities || {};
    return Object.fromEntries(
      Object.entries(all).filter(([id]) => facilityIds.includes(id))
    );
  } catch (e) {
    log(`❌ Không đọc được facilities.json: ${e.message}`);
    return {};
  }
}

// ─── Cookie helpers ──────────────────────────────────────────────────────────
function extractCookies(response) {
  const cookies = response.headers["set-cookie"];
  if (cookies) return cookies.map((c) => c.split(";")[0]).join("; ");
  return "";
}

function mergeCookies(...parts) {
  const map = new Map();
  parts.filter(Boolean).forEach((str) => {
    str.split(";").forEach((part) => {
      const trimmed = part.trim();
      if (!trimmed) return;
      const eq = trimmed.indexOf("=");
      if (eq === -1) return;
      const name = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (name) map.set(name, value);
    });
  });
  return Array.from(map.entries()).map(([n, v]) => `${n}=${v}`).join("; ");
}

function isLoginOk(resp, cookies) {
  const loc = resp.headers.location || "";
  const redirectOk = resp.status >= 300 && resp.status < 400 && loc && !/\/login/i.test(loc);
  const hasToken = /(?:^|;\s*)HtToken=/.test(cookies || "");
  return redirectOk && hasToken;
}

function isRedirectToLogin(resp) {
  if (!resp) return false;
  if (resp.status < 300 || resp.status >= 400) return false;
  return /\/app\/login|\/login/i.test(resp.headers?.location || "");
}

function extractHiddenField(html, name) {
  const m = html.match(new RegExp(`${name}[^>]*value="([^"]*)"`, "i"));
  return m ? m[1] : "";
}

// ─── OTA Login ───────────────────────────────────────────────────────────────
async function performLogin(email, password) {
  try {
    const pageResp = await axios.get(LOGIN_PATH, { headers: HTTP_HEADERS });
    let cookies = extractCookies(pageResp);
    const html = pageResp.data;

    const loginData = new URLSearchParams({
      __EVENTTARGET: "lkLogin",
      __EVENTARGUMENT: "",
      __VIEWSTATE: extractHiddenField(html, "__VIEWSTATE"),
      __VIEWSTATEGENERATOR: extractHiddenField(html, "__VIEWSTATEGENERATOR"),
      __EVENTVALIDATION: extractHiddenField(html, "__EVENTVALIDATION"),
      ddlLangCode: "vi-VN",
      txtEmail: email,
      txtPassword: password,
      // Phải khớp với server.js (commit 7274480) — thiếu field này monitor có
      // thể bị OTA từ chối trong khi server.js vẫn login được.
      hfClientTime: new Date().toISOString(),
    });

    const loginResp = await axios.post(LOGIN_PATH, loginData.toString(), {
      headers: { ...HTTP_HEADERS, "Content-Type": "application/x-www-form-urlencoded", Origin: BASE_URL, Referer: LOGIN_PATH, Cookie: cookies },
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 400,
    });

    cookies = mergeCookies(cookies, extractCookies(loginResp));
    if (!isLoginOk(loginResp, cookies)) {
      return { success: false, error: "Đăng nhập OTA thất bại", redirectLocation: loginResp.headers.location };
    }
    return { success: true, cookies, redirectLocation: loginResp.headers.location };
  } catch (e) {
    // Phải giữ status + body: utils/ota-session dựa vào đây để phân biệt lỗi
    // hạ tầng (403 Cloudflare, 5xx, timeout) với lỗi sai mật khẩu. Chỉ trả
    // e.message thì một cú 403 sẽ bị tính là sai mật khẩu và khóa oan tài khoản.
    return {
      success: false,
      error: e.message,
      otaStatus: e.response ? e.response.status : null,
      details: e.response
        ? { status: e.response.status, data: String(e.response.data || "").slice(0, 2000) }
        : null,
    };
  }
}

async function resolveMultiHotel(cookies, hotelId) {
  const url = `${BASE_URL}/my-hotels`;
  const pageResp = await axios.get(url, { headers: { ...HTTP_HEADERS, Cookie: cookies } });
  const html = String(pageResp.data || "");

  const rows = [];
  const re = /name="(lvHotels\$ctrl(\d+)\$hrId)"[^>]*value="(\d+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    rows.push({ idx: m[2], hotelNumericId: parseInt(m[3], 10), eventTarget: `lvHotels$ctrl${m[2]}$lbtNameHotel` });
  }

  const target = hotelId ? rows.find((r) => r.hotelNumericId === Number(hotelId)) : null;
  if (!target) return { success: false, error: `Hotel ID ${hotelId} không tìm thấy. Có: ${rows.map((r) => r.hotelNumericId).join(", ")}` };

  const postData = new URLSearchParams({
    __EVENTTARGET: target.eventTarget,
    __EVENTARGUMENT: "",
    __VIEWSTATE: extractHiddenField(html, "__VIEWSTATE"),
    __VIEWSTATEGENERATOR: extractHiddenField(html, "__VIEWSTATEGENERATOR"),
    __EVENTVALIDATION: extractHiddenField(html, "__EVENTVALIDATION"),
  });

  const selectResp = await axios.post(url, postData.toString(), {
    headers: { ...HTTP_HEADERS, "Content-Type": "application/x-www-form-urlencoded", Origin: BASE_URL, Referer: url, Cookie: cookies },
    maxRedirects: 0,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  return { success: true, cookies: mergeCookies(cookies, extractCookies(selectResp)) };
}

async function loginFacility(facility) {
  const result = await performLogin(facility.email, facility.password);
  if (!result.success) return result;

  if (/\/my-hotels/i.test(result.redirectLocation || "")) {
    if (!facility.hotelId) return { success: false, error: `Facility "${facility.name}" thiếu hotelId` };
    const ctx = await resolveMultiHotel(result.cookies, facility.hotelId);
    if (!ctx.success) return ctx;
    return { success: true, cookies: ctx.cookies };
  }
  return { success: true, cookies: result.cookies };
}

// ─── Booking Parser ──────────────────────────────────────────────────────────
function extractText(cellHtml) {
  if (!cellHtml) return "";
  return cellHtml
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d))
    .trim();
}

// The room note text lives in the ShowNotes(...) onclick attribute, not in the
// cell's inner text, so extractText (which strips the whole <a> tag) can't be reused here
function extractNoteFromCell(cellHtml) {
  if (!cellHtml) return "";

  const onclickMatch = cellHtml.match(/onclick="ShowNotes\('([\s\S]*?)'\);?"/i);
  if (!onclickMatch) return "";

  let text = onclickMatch[1]
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d));

  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Extract the Expedia net amount ("Collect Amount") from a decoded room note string
function extractExpediaCollectAmount(noteText) {
  if (!noteText) return "";
  const match = noteText.match(/Collect Amount:\s*[₫đ]?\s*([\d.,]+)/i);
  return match ? match[1] : "";
}

function parseBookings(html) {
  let currentPage = 1;
  let totalPages = 1;

  const paginateBlock = html.match(/<div[^>]*class="[^"]*dataTables_paginate[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (paginateBlock) {
    const pb = paginateBlock[1];
    const nums = [...pb.matchAll(/<a[^>]*class="[^"]*paginate_button(?!.*current)[^"]*"[^>]*href="[^"]*p=(\d+)[^"]*"[^>]*>(\d+)<\/a>/gi)].map((m) => parseInt(m[2]));
    const cur = pb.match(/<a[^>]*class="[^"]*paginate_button current[^"]*"[^>]*href="[^"]*p=(\d+)[^"]*"[^>]*>(\d+)<\/a>/i);
    if (cur) { currentPage = parseInt(cur[2]); nums.push(currentPage); }
    if (nums.length > 0) totalPages = Math.max(...nums);
  } else {
    const pm = html.match(/Trang\s+(\d+)\s+\/\s+(\d+)|Page\s+(\d+)\s+of\s+(\d+)/i);
    if (pm) { currentPage = parseInt(pm[1] || pm[3]) || 1; totalPages = parseInt(pm[2] || pm[4]) || 1; }
  }

  const tableMatch = html.match(/<table[^>]*class="[^"]*card-table[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
  const bookings = [];

  if (tableMatch) {
    const rows = tableMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i].match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      if (cells.length >= 15) {
        const booking = {
          bookingCode: extractText(cells[0]),
          otaReference: extractText(cells[1]),
          guestName: extractText(cells[2]),
          property: extractText(cells[3]),
          room: extractText(cells[4]),
          source: extractText(cells[5]),
          status: extractText(cells[6]),
          bookingDate: extractText(cells[7]),
          checkinDate: extractText(cells[8]),
          checkinTime: extractText(cells[9]),
          checkoutDate: extractText(cells[10]),
          checkoutTime: extractText(cells[11]),
          totalAmount: extractText(cells[15]).replace(/[^\d,.-]/g, "").trim(),
          paid: extractText(cells[13]).replace(/[^\d,.-]/g, "").trim(),
          notes: cells.length > 19 ? extractNoteFromCell(cells[19]) : "",
        };

        // Expedia: giá ở cột totalAmount là giá gộp OTA, giá net thực nhận
        // nằm trong "Collect Amount" của ghi chú phòng
        if (booking.source === "Expedia") {
          const collectAmount = extractExpediaCollectAmount(booking.notes);
          if (collectAmount) {
            booking.totalAmount = collectAmount.replace(/[^\d,.-]/g, "").trim();
          }
        }

        bookings.push(booking);
      }
    }
  }

  return { success: true, currentPage, totalPages, bookings };
}

// ─── Fetch single page ────────────────────────────────────────────────────────
async function fetchPage(cookies, roomType, searchType, page) {
  const today = formatDate(new Date());
  const params = new URLSearchParams({
    TypeSeachDate: searchType.typeSeachDate,
    FromDate: today,
    ToDate: today,
    RoomType: roomType,
    RoomDetail: "",
    SourceType: "",
    Source: "",
    Status: "1,0,3,4,2",
    Seach: "",
    IsExtensionFilder: true,
    p: page,
  });

  const resp = await axios.get(`${RESERVATION_PATH}?${params}`, {
    headers: { ...HTTP_HEADERS, Referer: `${BASE_URL}/`, Cookie: cookies },
    maxRedirects: 0,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  // sessionExpired là cờ để utils/ota-session biết cần hủy cache và login lại
  // đúng một lần (withSession), thay vì bỏ luôn trang này như trước.
  if (isRedirectToLogin(resp)) {
    return { success: false, sessionExpired: true, error: "Session hết hạn, cần đăng nhập lại" };
  }
  return { success: true, ...parseBookings(resp.data) };
}

// Gọi fetchPage qua session cache: dùng cookie đã lưu, nếu OTA từ chối thì hủy
// cache, login lại một lần rồi thử lại đúng trang đó.
// Trả về kết quả của fetchPage, hoặc { success:false, error, code } khi không
// lấy được session (bị khóa / circuit mở / login lỗi).
async function fetchPageWithSession(facility, roomType, searchType, page, username) {
  const r = await otaSession.withSession(
    facility,
    loginFacility,
    (cookies) => fetchPage(cookies, roomType, searchType, page),
    { log: (m) => log(m, username) },
  );
  if (r.ok) return r.result;
  return { success: false, error: r.error, code: r.code, ...(r.result || {}) };
}

// ─── Fetch ALL pages for a facility ──────────────────────────────────────────
async function fetchAllBookings(facilityId, facility, username) {
  log(`📥 Lấy toàn bộ booking cho ${facility.name}...`, username);

  const loginResult = await otaSession.ensureFacilityCookies(facility, loginFacility, {
    log: (m) => log(m, username),
  });
  if (!loginResult.ok) {
    log(`❌ Không lấy được session (${facility.name}) [${loginResult.code}]: ${loginResult.error}`, username);
    return { success: false, error: loginResult.error, code: loginResult.code };
  }
  if (loginResult.fromCache) {
    log(`♻️  Dùng session đã lưu cho ${facility.name}`, username);
  }

  const allBookings = [];
  const seenKeys = new Set();
  const pageTracker = {};

  for (const roomType of facility.roomTypes) {
    for (const searchType of [SEARCH_TYPES[0]]) {
      const key = `${facilityId}_${roomType}_${searchType.typeSeachDate}`;
      let currentPage = 1;
      let totalPages = 1;

      do {
        const result = await fetchPageWithSession(facility, roomType, searchType, currentPage, username);
        if (!result.success) {
          log(`  ⚠️  ${searchType.name} trang ${currentPage}: ${result.error}`, username);
          break;
        }
        totalPages = result.totalPages;

        for (const b of result.bookings) {
          const enriched = { ...b, facilityId, facilityName: facility.name, roomType, searchType: searchType.name, typeSeachDate: searchType.typeSeachDate };
          const k = bookingKey(enriched);
          if (!seenKeys.has(k)) {
            seenKeys.add(k);
            allBookings.push(enriched);
          }
        }

        log(`  ✅ ${searchType.name} trang ${currentPage}/${totalPages}: ${result.bookings.length} booking`, username);
        if (totalPages === 1 || currentPage >= totalPages) break;

        currentPage++;
        await sleep(200);
      } while (currentPage <= totalPages && currentPage <= 50);

      pageTracker[key] = totalPages;
      await sleep(300);
    }
    await sleep(500);
  }

  log(`✅ ${facility.name}: tổng ${allBookings.length} booking`, username);
  return { success: true, bookings: allBookings, pageTracker };
}

// ─── Telegram (per-user) ──────────────────────────────────────────────────────
async function sendTelegram(message, botToken, chatId, username) {
  if (!botToken || !chatId) {
    log("⚠️  Thiếu telegram_bot_token hoặc telegram_chat_id", username);
    return;
  }
  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
    });
    log("📨 Đã gửi Telegram", username);

    // Gửi lỗi hệ thống về kênh Telegram admin chung (không phải bot/chat riêng của user)
    const botTokenAdmin = process.env.TELEGRAM_BOT_TOKEN;
    const chatIdAdmin = process.env.TELEGRAM_CHAT_ID;
    if (botTokenAdmin && chatIdAdmin) {
      await axios.post(
        `https://api.telegram.org/bot${botTokenAdmin}/sendMessage`,
        {
          chat_id: chatIdAdmin,
          text: message,
          parse_mode: "HTML",
        },
      );
      log("📨 Đã gửi Telegram lỗi (admin)", username);
    }
  } catch (e) {
    log(`❌ Gửi Telegram thất bại: ${e.message}`, username);
  }
}

// Gửi lỗi hệ thống về kênh Telegram admin chung (không phải bot/chat riêng của user).
// Cài đặt thật nằm ở utils/telegram.js để utils/ota-session.js và server.js cũng
// báo được về cùng kênh này.
async function sendTelegramError(message, username) {
  return sendAdminAlert(message, (m) => log(m, username));
}

function formatBookingMessage(b) {
  const room = extractRoomNumber(b.room);
  const checkinDate = dayjs(b.checkinDate, "DD/MM/YYYY");
  const checkoutDate = dayjs(b.checkoutDate, "DD/MM/YYYY");
  const nights = Math.max(1, checkoutDate.diff(checkinDate, "day"));

  const guestName = b.guestName || "";
  const paymentText = getTextPayment(b.source);
  const code = b.otaReference
    ? `(${b.otaReference.slice(-4)})`
    : b.source !== "Go2Joy"
    ? `(${b.bookingCode})`
    : "";
  const totalAmount = b.totalAmount || "0";

  return `P${room} - ${guestName} ${code} - ${nights} đêm - ${paymentText} ${totalAmount}`;
}

// ─── Snapshot builder (per-user) ─────────────────────────────────────────────
async function buildUserSnapshot(user) {
  const today = getTodayKey();
  log(`🔄 Đang tạo snapshot ngày ${today}...`, user.username);

  const facilities = loadUserFacilities(user.facilities);
  if (Object.keys(facilities).length === 0) {
    log("❌ Không tìm thấy cấu hình facilities", user.username);
    return false;
  }

  const snapshot = {
    lastUpdated: new Date().toISOString(),
    date: today,
    totalBookings: 0,
    bookings: [],
    pageTracker: {},
    bookingKeys: [],
  };

  let errorCount = 0;
  for (const [facilityId, facility] of Object.entries(facilities)) {
    const result = await fetchAllBookings(facilityId, facility, user.username);
    if (result.success) {
      snapshot.bookings.push(...result.bookings);
      Object.assign(snapshot.pageTracker, result.pageTracker);
    } else {
      errorCount++;
      await sendTelegramError(
        `⚠️ <b>Lỗi tạo snapshot</b> [${user.username}]\nFacility: ${facility.name}\nLỗi: ${result.error}`,
        user.username
      );
    }
    await sleep(1000);
  }

  snapshot.totalBookings = snapshot.bookings.length;
  snapshot.bookingKeys = snapshot.bookings.map(bookingKey);
  saveSnapshot(snapshot, user.username);

  log(`✅ Snapshot ${today} hoàn tất: ${snapshot.totalBookings} booking (${errorCount} lỗi)`, user.username);
  return true;
}

// ─── Monitor: check last page (1 facility) ────────────────────────────────────
async function checkFacility(facilityId, facility, snapshot, user, loggedKeys) {
  const facilityNewBookings = [];
  const pageTrackerUpdates = {};
  const seenKeys = new Set(snapshot.bookingKeys);
  const empty = { newBookings: [], pageTrackerUpdates: {} };

  try {
    const sess = await otaSession.ensureFacilityCookies(facility, loginFacility, {
      log: (m) => log(m, user.username),
    });
    if (!sess.ok) {
      // Log một lần cho mỗi TÀI KHOẢN mỗi tick: 6 cơ sở dùng chung một tài
      // khoản bị khóa thì trước đây in 6 dòng và gửi 6 tin Telegram.
      if (!loggedKeys || !loggedKeys.has(sess.key)) {
        if (loggedKeys) loggedKeys.add(sess.key);
        log(`⚠️  Bỏ qua ${facility.email} [${sess.code}]: ${sess.error}`, user.username);
      }
      // Không gửi Telegram ở đây nữa — utils/ota-session đã gửi đúng một lần
      // khi khóa tài khoản hoặc khi mở circuit breaker.
      return empty;
    }
  } catch (e) {
    log(`❌ Exception login ${facility.name}: ${e.message}`, user.username);
    return empty;
  }

  for (const roomType of facility.roomTypes) {
    for (const searchType of [SEARCH_TYPES[0]]) {
      const trackerKey = `${facilityId}_${roomType}_${searchType.typeSeachDate}`;
      const prevTotalPages = snapshot.pageTracker[trackerKey] || 1;

      try {
        const lastPageResult = await fetchPageWithSession(facility, roomType, searchType, prevTotalPages, user.username);
        if (!lastPageResult.success) {
          log(`  ⚠️  [${facility.name}] Lỗi lấy trang ${prevTotalPages} (${searchType.name}): ${lastPageResult.error}`, user.username);
          continue;
        }

        const currentTotalPages = lastPageResult.totalPages;
        const pagesToCheck = new Set([currentTotalPages]);

        if (currentTotalPages > prevTotalPages) {
          log(`  📈 [${facility.name}] ${searchType.name} tăng trang: ${prevTotalPages} → ${currentTotalPages}`, user.username);
          pagesToCheck.add(prevTotalPages);
        }

        for (const page of pagesToCheck) {
          let result = lastPageResult;
          if (page !== prevTotalPages) {
            result = await fetchPageWithSession(facility, roomType, searchType, page, user.username);
            await sleep(200);
          }
          if (!result.success) continue;

          for (const b of result.bookings) {
            const enriched = { ...b, facilityId, facilityName: facility.name, roomType, searchType: searchType.name, typeSeachDate: searchType.typeSeachDate };
            const key = bookingKey(enriched);
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              facilityNewBookings.push(enriched);
              log(`  🆕 [${facility.name}] ${enriched.guestName} - ${enriched.room} (${enriched.checkinDate}→${enriched.checkoutDate})`, user.username);
            }
          }
        }

        if (currentTotalPages !== prevTotalPages) {
          pageTrackerUpdates[trackerKey] = currentTotalPages;
        }

        await sleep(200);
      } catch (e) {
        log(`  ❌ Exception ${searchType.name} (${facility.name}): ${e.message}`, user.username);
      }
    }
    await sleep(300);
  }

  return { newBookings: facilityNewBookings, pageTrackerUpdates };
}

// ─── Monitor: check all facilities for one user ───────────────────────────────
async function checkUserBookings(user, snapshot) {
  // Circuit breaker mở = hạ tầng đang chặn (Cloudflare 403, timeout...). Chặn ở
  // đây thì cả tick không phát sinh request nào, kể cả request report — đúng
  // điều kiện để một block theo IP có cơ hội tự hết.
  const cb = otaSession.circuitState();
  if (cb.open) {
    log(`⛔ Circuit breaker đang mở tới ${cb.openUntil} (${cb.lastError || "lỗi hạ tầng"}) — bỏ qua tick`, user.username);
    return [];
  }

  const facilities = loadUserFacilities(user.facilities);
  log(`🚀 Kiểm tra song song ${Object.keys(facilities).length} cơ sở...`, user.username);

  // Dùng chung giữa các facility trong cùng tick để chỉ log một lần cho mỗi
  // tài khoản OTA bị khóa/bị chặn.
  const loggedKeys = new Set();
  const results = await Promise.all(
    Object.entries(facilities).map(([facilityId, facility]) =>
      checkFacility(facilityId, facility, snapshot, user, loggedKeys)
    )
  );

  const allNewBookings = [];
  const updatedPageTracker = { ...snapshot.pageTracker };

  for (const { newBookings, pageTrackerUpdates } of results) {
    for (const b of newBookings) {
      const key = bookingKey(b);
      if (!snapshot.bookingKeys.includes(key)) {
        allNewBookings.push(b);
        snapshot.bookingKeys.push(key);
        snapshot.bookings.push(b);
      }
    }
    Object.assign(updatedPageTracker, pageTrackerUpdates);
  }

  if (allNewBookings.length > 0 || JSON.stringify(updatedPageTracker) !== JSON.stringify(snapshot.pageTracker)) {
    snapshot.pageTracker = updatedPageTracker;
    snapshot.totalBookings = snapshot.bookings.length;
    snapshot.lastUpdated = new Date().toISOString();
    saveSnapshot(snapshot, user.username);
  }

  return allNewBookings;
}

// ─── Notify new bookings for one user ────────────────────────────────────────
async function notifyNewBookings(user, newBookings) {
  if (newBookings.length === 0) {
    log("✅ Không có booking mới", user.username);
    return;
  }

  const today = formatDate(new Date());
  const toNotify = newBookings.filter((b) => {
    if (b.checkinDate !== today) return false;
    if (/gia\s*h[aạ]n/i.test(b.guestName || "")) return false;
    return true;
  });

  const skipped = newBookings.length - toNotify.length;
  if (skipped > 0) log(`   ↩️  Bỏ qua ${skipped} booking (không phải hôm nay hoặc gia hạn)`, user.username);

  if (toNotify.length === 0) {
    log(`🎉 ${newBookings.length} booking mới (không có booking nào cần thông báo hôm nay)`, user.username);
    return;
  }

  const byFacility = {};
  for (const b of toNotify) {
    if (!byFacility[b.facilityName]) byFacility[b.facilityName] = [];
    byFacility[b.facilityName].push(b);
  }

  for (const [facilityName, bookings] of Object.entries(byFacility)) {
    const lines = bookings.map(formatBookingMessage).join("\n");
    const msg = `🔔 <b>Booking mới - ${facilityName}</b>\n\n${lines}`;
    await sendTelegram(msg, user.telegram_bot_token, user.telegram_chat_id, user.username);
  }

  log(`🎉 ${newBookings.length} booking mới (gửi Telegram: ${toNotify.length})`, user.username);
}

// ─── DLD (DayLaDau) integration ──────────────────────────────────────────────
const dld = require("./services/dld");

function dldOrderKey(order) {
  return `dld_${order.id || order.order_id || order._id || JSON.stringify(order).slice(0, 40)}`;
}

// Read user's DLD config from users.json
function loadUserDldConfig(user) {
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    const u    = data.users.find((x) => x.id === user.id);
    return u?.ota_configs?.dld || null;
  } catch (_) { return null; }
}

// Persist updated DLD config (e.g. refreshed token) back to users.json
function saveUserDldConfig(user, cfg) {
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    const u    = data.users.find((x) => x.id === user.id);
    if (!u) return;
    if (!u.ota_configs) u.ota_configs = {};
    u.ota_configs.dld = cfg;
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) { log(`⚠️  [DLD] Cannot save token: ${e.message}`, user.username); }
}

// Fetch today's DLD orders for a user. Returns null if DLD isn't configured.
async function fetchTodayDldOrders(user) {
  const cfg = loadUserDldConfig(user);
  if (!cfg || !cfg.host_id) return null;

  const now = new Date();
  const startTs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  const endTs   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();

  const token = await dld.getToken(cfg, (msg) => log(msg, user.username));
  saveUserDldConfig(user, cfg); // persist refreshed token if getToken logged in
  const orders = await dld.fetchOrdersAll(cfg.host_id, token, startTs, endTs);
  return orders.filter((o) => o.status === "paid" && o.reservation?.status !== "cancelled"); // bỏ qua đơn cancelled/open (chưa thanh toán) và reservation đã hủy
}

function extractDldOrderInfo(order) {
  const listingName = order.listing?.nickname || order.listing?.name || String(order.listing_id || "");
  const guestName   = order.guest?.fullname || "Khách";
  const orderId     = String(order.id || "");
  const checkin  = order.reservation?.start_time
    ? dayjs(order.reservation.start_time).format("HH:mm DD/MM")
    : "";
  const checkout = order.reservation?.end_time
    ? dayjs(order.reservation.end_time).format("HH:mm DD/MM")
    : "";
  const total = order.total
    ? Number(order.total).toLocaleString("vi-VN") + "đ"
    : "";
  return { listingName, guestName, orderId, checkin, checkout, total };
}

// Build the day's DLD baseline: seed dldOrderKeys with today's existing orders
// and return a single-message summary (no per-order Telegram spam).
async function buildDldSnapshot(user) {
  let orders;
  try {
    orders = await fetchTodayDldOrders(user);
  } catch (e) {
    log(`❌ [DLD] Snapshot lỗi: ${e.message}`, user.username);
    await sendTelegramError(`❌ <b>[DLD] Lỗi tạo snapshot</b> [${user.username}]\n${e.message}`, user.username);
    return null;
  }
  if (orders === null) return null; // chưa cấu hình DLD

  const keys = orders.map(dldOrderKey);
  const lines = orders.map((order) => {
    const { listingName, guestName, orderId, checkin, checkout, total } = extractDldOrderInfo(order);
    return `• ${listingName}\n- ${guestName} (#${orderId})${checkin && checkout ? ` — ${checkin}→${checkout}` : ""}${total ? ` — ${total}` : ""}`;
  });
  return { keys, lines };
}

async function checkDldOrders(user, snapshot) {
  const seenKeys = new Set(snapshot.dldOrderKeys || []);
  const newOrders = [];

  try {
    const orders = await fetchTodayDldOrders(user);
    if (orders === null) return [];
    log("🔍 [DLD] Checking new orders...", user.username);
    log(`   [DLD] ${orders.length} orders today`, user.username);

    for (const order of orders) {
      const key = dldOrderKey(order);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      newOrders.push({ order, key });
      log(`  🆕 [DLD] order ${String(order.id || "").slice(-6)} — listing ${order.listing_id || ""}`, user.username);
    }
  } catch (e) {
    log(`❌ [DLD] ${e.message}`, user.username);
    await sendTelegramError(`❌ <b>[DLD] Lỗi kiểm tra đơn mới</b> [${user.username}]\n${e.message}`, user.username);
  }

  return newOrders;
}

async function notifyDldOrders(user, newOrders, snapshot) {
  if (newOrders.length === 0) return;

  if (!snapshot.dldOrderKeys) snapshot.dldOrderKeys = [];
  for (const { key } of newOrders) snapshot.dldOrderKeys.push(key);

  for (const { order } of newOrders) {
    const { listingName, guestName, orderId, checkin, checkout, total } = extractDldOrderInfo(order);

    const lines = [
      `🔔 <b>Đơn mới DayLaDau</b>`,
      `${listingName} - ${guestName} (#${orderId})`,
      checkin && checkout ? `${checkin} → ${checkout}` : "",
      total ? `DayLaDau đã thanh toán ${total}` : "",
    ].filter(Boolean).join("\n");

    await sendTelegram(lines, user.telegram_bot_token, user.telegram_chat_id, user.username);
  }

  log(`🎉 [DLD] Sent Telegram for ${newOrders.length} new orders`, user.username);
}

// ─── Go2Joy integration ──────────────────────────────────────────────────────
const g2j = require("./services/g2j");

function g2jOrderKey(b) {
  return `g2j_${b.bookingSn || b.sn || b.id || JSON.stringify(b).slice(0, 40)}`;
}

function loadUserG2jConfig(user) {
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    const u    = data.users.find((x) => x.id === user.id);
    return u?.ota_configs?.go2joy || null;
  } catch (_) { return null; }
}

function saveUserG2jConfig(user, cfg) {
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    const u    = data.users.find((x) => x.id === user.id);
    if (!u) return;
    if (!u.ota_configs) u.ota_configs = {};
    u.ota_configs.go2joy = cfg;
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) { log(`⚠️  [G2J] Cannot save token: ${e.message}`, user.username); }
}

function todayDateStr() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

// Fetch today's G2J bookings for a user. Returns null if G2J isn't configured.
async function fetchTodayG2jBookings(user) {
  const cfg = loadUserG2jConfig(user);
  if (!cfg || !cfg.user_id) return null;

  const token = await g2j.getToken(cfg, (msg) => log(msg, user.username));
  saveUserG2jConfig(user, cfg);
  return g2j.fetchBookingsAll(token, todayDateStr(), cfg.hotel_sns || [], (msg) => log(msg, user.username));
}

function extractG2jBookingInfo(b) {
  const hotelName  = b.hotelName  || b.hotel_name  || b.hotel?.name  || "";
  const guestName  = b.appUserNickName || b.guestName || b.guest_name || b.guest?.name || "Khách";
  const roomType   = b.roomTypeName || b.room_type_name || b.room?.name || "";
  const checkIn    = b.checkIn    || b.check_in    || b.checkin  || b.startDate  || "";
  const checkOut   = b.checkOut   || b.check_out   || b.checkout || b.endDate    || "";
  const total      = b.totalAmount || b.total_amount || b.total  || b.amount     || "";
  const bookingSn  = String(b.bookingSn || b.sn || b.id || "");
  const totalFmt   = total ? Number(total).toLocaleString("vi-VN") + "đ" : "";
  return { hotelName, guestName, roomType, checkIn, checkOut, bookingSn, totalFmt };
}

// Build the day's G2J baseline: seed g2jOrderKeys with today's existing bookings
// and return a single-message summary (no per-booking Telegram spam).
async function buildG2jSnapshot(user) {
  let bookings;
  try {
    bookings = await fetchTodayG2jBookings(user);
  } catch (e) {
    log(`❌ [G2J] Snapshot lỗi: ${e.message}`, user.username);
    await sendTelegramError(`❌ <b>[G2J] Lỗi tạo snapshot</b> [${user.username}]\n${e.message}`, user.username);
    return null;
  }
  if (bookings === null) return null; // chưa cấu hình G2J

  const keys = bookings.map(g2jOrderKey);
  const lines = bookings.map((b) => {
    const { hotelName, guestName, roomType, checkIn, checkOut, bookingSn, totalFmt } = extractG2jBookingInfo(b);
    return `• ${hotelName}${roomType ? ` - ${roomType}` : ""}\n- ${guestName} (#${bookingSn})${checkIn && checkOut ? ` — ${checkIn}→${checkOut}` : ""}${totalFmt ? ` — ${totalFmt}` : ""}`;
  });
  return { keys, lines };
}

async function checkG2jOrders(user, snapshot) {
  const seenKeys = new Set(snapshot.g2jOrderKeys || []);
  const newOrders = [];

  try {
    const bookings = await fetchTodayG2jBookings(user);
    if (bookings === null) return [];
    log("🔍 [G2J] Checking new bookings...", user.username);
    log(`   [G2J] ${bookings.length} bookings today`, user.username);

    for (const b of bookings) {
      const key = g2jOrderKey(b);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      newOrders.push({ booking: b, key });
      log(`  🆕 [G2J] #${b.bookingSn || b.sn} — ${b.hotelName || b.hotel_name || ""} — ${b.appUserNickName || b.guestName || b.guest_name || ""}`, user.username);
    }
  } catch (e) {
    log(`❌ [G2J] ${e.message}`, user.username);
    await sendTelegramError(`❌ <b>[G2J] Lỗi kiểm tra đơn mới</b> [${user.username}]\n${e.message}`, user.username);
  }

  return newOrders;
}

async function notifyG2jOrders(user, newOrders, snapshot) {
  if (newOrders.length === 0) return;

  if (!snapshot.g2jOrderKeys) snapshot.g2jOrderKeys = [];
  for (const { key } of newOrders) snapshot.g2jOrderKeys.push(key);

  for (const { booking: b } of newOrders) {
    const { hotelName, guestName, roomType, checkIn, checkOut, bookingSn, totalFmt } = extractG2jBookingInfo(b);

    const lines = [
      `🔔 <b>Đơn mới Go2Joy</b>`,
      `${hotelName}${roomType ? ` - ${roomType}` : ""} - ${guestName} (#${bookingSn})`,
      checkIn && checkOut ? `${checkIn} → ${checkOut}` : "",
      totalFmt ? `Go2Joy đã thanh toán ${totalFmt}` : "",
    ].filter(Boolean).join("\n");

    await sendTelegram(lines, user.telegram_bot_token, user.telegram_chat_id, user.username);
  }

  log(`🎉 [G2J] Sent Telegram for ${newOrders.length} new bookings`, user.username);
}

// ─── Per-user monitor loop ────────────────────────────────────────────────────
async function runUserMonitor(user, snapshots) {
  // Init snapshot nếu chưa có hoặc sang ngày mới
  if (!snapshots[user.username]?.lastUpdated || snapshots[user.username].date !== getTodayKey()) {
    log(`📝 Chưa có snapshot ngày ${getTodayKey()}, đang tạo...`, user.username);
    const ok = await buildUserSnapshot(user);
    if (!ok) {
      log("❌ Tạo snapshot thất bại, bỏ qua user này trong tick này", user.username);
      return;
    }
    snapshots[user.username] = loadSnapshot(user.username);
    await sendTelegram(
      `✅ <b>ReportOTA Monitor - ${snapshots[user.username].date}</b>\nSnapshot: ${snapshots[user.username].totalBookings} booking\nKiểm tra mỗi: ${MONITOR_INTERVAL / 1000}s`,
      user.telegram_bot_token, user.telegram_chat_id, user.username
    );

    // DLD: seed dldOrderKeys với các đơn check-in hôm nay đã tồn tại sẵn,
    // báo 1 tin tổng hợp — tránh bị coi nhầm là "🆕 đơn mới" ở tick đầu ngày
    const dldSeed = await buildDldSnapshot(user);
    if (dldSeed) {
      snapshots[user.username].dldOrderKeys = dldSeed.keys;
      saveSnapshot(snapshots[user.username], user.username);
      const msg = [`📸 <b>[DLD] Snapshot hôm nay</b>: ${dldSeed.lines.length} đơn`, ...dldSeed.lines].join("\n\n");
      await sendTelegram(msg, user.telegram_bot_token, user.telegram_chat_id, user.username);
    }

    // G2J: cùng pattern với DLD — seed g2jOrderKeys, báo 1 tin tổng hợp
    const g2jSeed = await buildG2jSnapshot(user);
    if (g2jSeed) {
      snapshots[user.username].g2jOrderKeys = g2jSeed.keys;
      saveSnapshot(snapshots[user.username], user.username);
      const msg = [`📸 <b>[G2J] Snapshot hôm nay</b>: ${g2jSeed.lines.length} đơn`, ...g2jSeed.lines].join("\n\n");
      await sendTelegram(msg, user.telegram_bot_token, user.telegram_chat_id, user.username);
    }
  }

  // Blue PMS check
  try {
    const newBookings = await checkUserBookings(user, snapshots[user.username]);
    await notifyNewBookings(user, newBookings);
  } catch (e) {
    log(`❌ Lỗi trong tick: ${e.message}`, user.username);
    await sendTelegramError(
      `❌ <b>Lỗi Monitor</b> [${user.username}]\n${e.message}\nTự động thử lại...`,
      user.username
    );
  }

  // DLD check
  try {
    const newDldOrders = await checkDldOrders(user, snapshots[user.username]);
    await notifyDldOrders(user, newDldOrders, snapshots[user.username]);
    if (newDldOrders.length > 0) saveSnapshot(snapshots[user.username], user.username);
  } catch (e) {
    log(`❌ [DLD] ${e.message}`, user.username);
    await sendTelegramError(`❌ <b>[DLD] Lỗi trong tick</b> [${user.username}]\n${e.message}`, user.username);
  }

  // G2J check
  try {
    const newG2jOrders = await checkG2jOrders(user, snapshots[user.username]);
    await notifyG2jOrders(user, newG2jOrders, snapshots[user.username]);
    if (newG2jOrders.length > 0) saveSnapshot(snapshots[user.username], user.username);
  } catch (e) {
    log(`❌ [G2J] ${e.message}`, user.username);
    await sendTelegramError(`❌ <b>[G2J] Lỗi trong tick</b> [${user.username}]\n${e.message}`, user.username);
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────
async function monitorLoop() {
  const users = loadActiveUsers();
  if (users.length === 0) {
    log("❌ Không có user nào đủ điều kiện (active=true, telegram_bot_token, telegram_chat_id, facilities).");
    log("   Kiểm tra config/users.json.");
    process.exit(1);
  }

  log(`🚀 Khởi động monitor cho ${users.length} user: ${users.map((u) => u.username).join(", ")}`);
  log(`   Interval: ${MONITOR_INTERVAL / 1000}s`);

  // snapshots[username] = snapshot object, được cập nhật in-place
  const snapshots = {};

  async function tick() {
    log(`\n⏱  Tick - kiểm tra booking mới cho tất cả user...`);
    // Chạy tất cả user song song trong mỗi tick
    await Promise.all(users.map((user) => runUserMonitor(user, snapshots)));
    setTimeout(tick, MONITOR_INTERVAL);
  }

  // Khởi tạo snapshot cho tất cả user trước khi bắt đầu tick
  await Promise.all(users.map((user) => runUserMonitor(user, snapshots)));
  setTimeout(tick, MONITOR_INTERVAL);
}

// ─── CLI commands ─────────────────────────────────────────────────────────────
// Chỉ chạy khi được gọi trực tiếp (node booking-monitor.js), để file này còn
// require được từ script test mà không khởi động vòng lặp monitor.
if (require.main === module) {
  const command = process.argv[2];
  const targetUsername = process.argv[3] || null;

  if (command === "snapshot") {
    (async () => {
      const users = loadActiveUsers();
      const targets = targetUsername ? users.filter((u) => u.username === targetUsername) : users;
      if (targets.length === 0) {
        log(`❌ Không tìm thấy user "${targetUsername || ""}" trong users.json`);
        process.exit(1);
      }
      let allOk = true;
      for (const user of targets) {
        const ok = await buildUserSnapshot(user);
        if (!ok) allOk = false;
      }
      log(allOk ? "✅ Snapshot hoàn tất" : "⚠️  Một số snapshot thất bại");
      process.exit(allOk ? 0 : 1);
    })();
  } else {
    monitorLoop().catch((e) => {
      log(`💥 Lỗi nghiêm trọng: ${e.message}`);
      process.exit(1);
    });
  }
}

module.exports = {
  performLogin,
  loginFacility,
  resolveMultiHotel,
  fetchPage,
  fetchPageWithSession,
  checkFacility,
  checkUserBookings,
  loadUserFacilities,
  loadActiveUsers,
};
