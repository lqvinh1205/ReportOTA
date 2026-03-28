/**
 * booking-monitor.js
 * Service độc lập theo dõi booking mới và gửi thông báo Telegram.
 *
 * Cấu hình (thêm vào .env):
 *   TELEGRAM_BOT_TOKEN=<bot_token>
 *   TELEGRAM_CHAT_ID=<chat_id>
 *   MONITOR_INTERVAL_MS=120000   (mặc định: 2 phút)
 *   MONITOR_DATE_RANGE_DAYS=7    (mặc định: 7 ngày kể từ hôm nay)
 */

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { URLSearchParams } = require("url");
const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");
dayjs.extend(customParseFormat);
  
// ─── Config ────────────────────────────────────────────────────────────────
const BASE_URL = process.env.OTA_BASE_URL || "https://id.bluejaypms.com";
const LOGIN_PATH = `${BASE_URL}/login`;
const RESERVATION_PATH = `${BASE_URL}/app/Reservation`;

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const MONITOR_INTERVAL = parseInt(process.env.MONITOR_INTERVAL_MS) || 2 * 60 * 1000;
const MONITOR_FACILITIES = process.env.MONITOR_FACILITIES
  ? process.env.MONITOR_FACILITIES.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

const { getTextPayment } = require("./utils/booking-utils");

const SNAPSHOTS_DIR = path.join(__dirname, "snapshots");
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

// ─── Utilities ─────────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  console.log(`[${ts}] ${msg}`);
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

/** Tạo unique key để nhận dạng booking */
function bookingKey(b) {
  return `${b.bookingCode}|${b.otaReference}|${b.facilityId}`;
}

/** Trích số phòng từ tên phòng */
function extractRoomNumber(roomName) {
  if (!roomName) return roomName;
  const m = roomName.match(/(?:P?\s*)?(\d+)\s*$/i);
  return m ? m[1] : roomName;
}

// ─── Snapshot I/O ───────────────────────────────────────────────────────────
function getTodayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getTodaySnapshotFile() {
  if (!fs.existsSync(SNAPSHOTS_DIR)) fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  return path.join(SNAPSHOTS_DIR, `snapshot_${getTodayKey()}.json`);
}

function loadSnapshot() {
  const file = getTodaySnapshotFile();
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf-8");
      return JSON.parse(raw);
    }
  } catch (e) {
    log(`⚠️  Không đọc được snapshot: ${e.message}`);
  }
  return { lastUpdated: null, date: getTodayKey(), totalBookings: 0, bookings: [], pageTracker: {}, bookingKeys: [] };
}

function saveSnapshot(snapshot) {
  const file = getTodaySnapshotFile();
  try {
    fs.writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf-8");
  } catch (e) {
    log(`❌ Không ghi được snapshot: ${e.message}`);
  }
}

// ─── Facilities ─────────────────────────────────────────────────────────────
function loadFacilities() {
  try {
    const raw = fs.readFileSync(FACILITIES_FILE, "utf-8");
    const all = JSON.parse(raw).facilities || {};
    if (MONITOR_FACILITIES.length === 0) return all;
    return Object.fromEntries(
      Object.entries(all).filter(([id]) => MONITOR_FACILITIES.includes(id))
    );
  } catch (e) {
    log(`❌ Không đọc được facilities.json: ${e.message}`);
    return {};
  }
}

// ─── Cookie helpers ─────────────────────────────────────────────────────────
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

// ─── OTA Login ──────────────────────────────────────────────────────────────
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
    return { success: false, error: e.message };
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

// ─── Booking Parser ─────────────────────────────────────────────────────────
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
        bookings.push({
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
          totalAmount: extractText(cells[14]).replace(/[^\d,.-]/g, "").trim(),
          paid: extractText(cells[13]).replace(/[^\d,.-]/g, "").trim(),
          notes: cells.length > 16 ? extractText(cells[16]) : "",
        });
      }
    }
  }

  return { success: true, currentPage, totalPages, bookings };
}

// ─── Fetch single page ───────────────────────────────────────────────────────
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

  // console.log(`${dayjs().format("YYYY-MM-DD HH:mm:ss")} - ${RESERVATION_PATH}?${params}`);
  

  const resp = await axios.get(`${RESERVATION_PATH}?${params}`, {
    headers: { ...HTTP_HEADERS, Referer: `${BASE_URL}/`, Cookie: cookies },
    maxRedirects: 0,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  if (isRedirectToLogin(resp)) return { success: false, error: "Session hết hạn, cần đăng nhập lại" };
  return { success: true, ...parseBookings(resp.data) };
}

// ─── Fetch ALL pages for a facility ─────────────────────────────────────────
async function fetchAllBookings(facilityId, facility) {
  log(`📥 Lấy toàn bộ booking cho ${facility.name}...`);

  const loginResult = await loginFacility(facility);
  if (!loginResult.success) {
    log(`❌ Đăng nhập thất bại (${facility.name}): ${loginResult.error}`);
    return { success: false, error: loginResult.error };
  }

  const { cookies } = loginResult;
  const allBookings = [];
  const seenKeys = new Set();
  const pageTracker = {};

  for (const roomType of facility.roomTypes) {
    for (const searchType of [SEARCH_TYPES[0]]) {
      const key = `${facilityId}_${roomType}_${searchType.typeSeachDate}`;
      let currentPage = 1;
      let totalPages = 1;

      do {
        const result = await fetchPage(cookies, roomType, searchType, currentPage);
        if (!result.success) {
          log(`  ⚠️  ${searchType.name} trang ${currentPage}: ${result.error}`);
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

        log(`  ✅ ${searchType.name} trang ${currentPage}/${totalPages}: ${result.bookings.length} booking`);
        if (totalPages === 1 || currentPage >= totalPages) break;

        currentPage++;
        await sleep(200);
      } while (currentPage <= totalPages && currentPage <= 50);

      pageTracker[key] = totalPages;
      await sleep(300);
    }
    await sleep(500);
  }

  log(`✅ ${facility.name}: tổng ${allBookings.length} booking`);
  return { success: true, bookings: allBookings, pageTracker };
}

// ─── Telegram ───────────────────────────────────────────────────────────────
async function sendTelegram(message) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    log("⚠️  Chưa cấu hình TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID");
    return;
  }
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "HTML",
    });
    log("📨 Đã gửi Telegram");
  } catch (e) {
    log(`❌ Gửi Telegram thất bại: ${e.message}`);
  }
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

// ─── Snapshot builder ────────────────────────────────────────────────────────
async function buildSnapshot() {
  const today = getTodayKey();
  log(`🔄 Đang tạo snapshot ngày ${today}...`);

  const facilities = loadFacilities();
  if (Object.keys(facilities).length === 0) {
    log("❌ Không tìm thấy cấu hình facilities");
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
    const result = await fetchAllBookings(facilityId, facility);
    if (result.success) {
      snapshot.bookings.push(...result.bookings);
      Object.assign(snapshot.pageTracker, result.pageTracker);
    } else {
      errorCount++;
      await sendTelegram(`⚠️ <b>Lỗi tạo snapshot</b>\nFacility: ${facility.name}\nLỗi: ${result.error}`);
    }
    await sleep(1000);
  }

  snapshot.totalBookings = snapshot.bookings.length;
  snapshot.bookingKeys = snapshot.bookings.map(bookingKey);
  saveSnapshot(snapshot);

  log(`✅ Snapshot ${today} hoàn tất: ${snapshot.totalBookings} booking (${errorCount} lỗi)`);
  return true;
}

// ─── Monitor: check last page (1 facility) ───────────────────────────────────
async function checkFacility(facilityId, facility, snapshot) {
  const facilityNewBookings = [];
  const pageTrackerUpdates = {};
  const seenKeys = new Set(snapshot.bookingKeys); // dedup trong cùng facility

  let cookies;
  try {
    const loginResult = await loginFacility(facility);
    if (!loginResult.success) {
      log(`⚠️  Không đăng nhập được ${facility.name}: ${loginResult.error}`);
      await sendTelegram(`⚠️ <b>Lỗi kết nối</b>\nFacility: ${facility.name}\nLỗi: ${loginResult.error}\nĐang thử lại sau...`);
      return { newBookings: [], pageTrackerUpdates: {} };
    }
    cookies = loginResult.cookies;
  } catch (e) {
    log(`❌ Exception login ${facility.name}: ${e.message}`);
    return { newBookings: [], pageTrackerUpdates: {} };
  }

  for (const roomType of facility.roomTypes) {
    for (const searchType of [SEARCH_TYPES[0]]) {
      const trackerKey = `${facilityId}_${roomType}_${searchType.typeSeachDate}`;
      const prevTotalPages = snapshot.pageTracker[trackerKey] || 1;

      try {
        const lastPageResult = await fetchPage(cookies, roomType, searchType, prevTotalPages);
        if (!lastPageResult.success) {
          log(`  ⚠️  [${facility.name}] Lỗi lấy trang ${prevTotalPages} (${searchType.name}): ${lastPageResult.error}`);
          continue;
        }

        const currentTotalPages = lastPageResult.totalPages;
        const pagesToCheck = new Set([currentTotalPages]);

        if (currentTotalPages > prevTotalPages) {
          log(`  📈 [${facility.name}] ${searchType.name} tăng trang: ${prevTotalPages} → ${currentTotalPages}`);
          pagesToCheck.add(prevTotalPages);
        }

        for (const page of pagesToCheck) {
          let result = lastPageResult;
          if (page !== prevTotalPages) {
            result = await fetchPage(cookies, roomType, searchType, page);
            await sleep(200);
          }
          if (!result.success) continue;

          for (const b of result.bookings) {
            const enriched = { ...b, facilityId, facilityName: facility.name, roomType, searchType: searchType.name, typeSeachDate: searchType.typeSeachDate };
            const key = bookingKey(enriched);
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              facilityNewBookings.push(enriched);
              log(`  🆕 [${facility.name}] ${enriched.guestName} - ${enriched.room} (${enriched.checkinDate}→${enriched.checkoutDate})`);
            }
          }
        }

        if (currentTotalPages !== prevTotalPages) {
          pageTrackerUpdates[trackerKey] = currentTotalPages;
        }

        await sleep(200);
      } catch (e) {
        log(`  ❌ Exception ${searchType.name} (${facility.name}): ${e.message}`);
      }
    }
    await sleep(300);
  }

  return { newBookings: facilityNewBookings, pageTrackerUpdates };
}

// ─── Monitor: check all facilities in parallel ────────────────────────────────
async function checkLastPages(snapshot) {
  const facilities = loadFacilities();
  log(`🚀 Kiểm tra song song ${Object.keys(facilities).length} cơ sở...`);

  // Chạy tất cả facility song song
  const results = await Promise.all(
    Object.entries(facilities).map(([facilityId, facility]) =>
      checkFacility(facilityId, facility, snapshot)
    )
  );

  // Gom kết quả và cập nhật snapshot một lần duy nhất
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
    saveSnapshot(snapshot);
  }

  return allNewBookings;
}

// ─── Main loop ───────────────────────────────────────────────────────────────
async function monitorLoop() {
  let snapshot = loadSnapshot();

  // Nếu chưa có snapshot của ngày hôm nay → tạo mới
  if (!snapshot.lastUpdated || snapshot.date !== getTodayKey()) {
    log(`📝 Chưa có snapshot ngày ${getTodayKey()}, đang tạo...`);
    const ok = await buildSnapshot();
    if (!ok) {
      log("❌ Tạo snapshot thất bại. Thử lại sau 1 phút...");
      setTimeout(monitorLoop, 60_000);
      return;
    }
    snapshot = loadSnapshot();
    await sendTelegram(`✅ <b>ReportOTA Monitor - ${snapshot.date}</b>\nSnapshot: ${snapshot.totalBookings} booking\nKiểm tra mỗi: ${MONITOR_INTERVAL / 1000}s`);
  }

  log(`\n🔍 Bắt đầu theo dõi booking mới (mỗi ${MONITOR_INTERVAL / 1000}s)...`);
  log(`   Snapshot ngày ${snapshot.date}: ${snapshot.totalBookings} booking`);

  async function tick() {
    try {
      // Nếu sang ngày mới → rebuild snapshot cho ngày hôm nay
      if (snapshot.date !== getTodayKey()) {
        log(`🌅 Sang ngày mới (${getTodayKey()}), đang tạo snapshot...`);
        const ok = await buildSnapshot();
        if (ok) {
          snapshot = loadSnapshot();
          await sendTelegram(`✅ <b>ReportOTA Monitor - ${snapshot.date}</b>\nSnapshot mới: ${snapshot.totalBookings} booking`);
        }
        setTimeout(tick, MONITOR_INTERVAL);
        return;
      }

      log("⏱  Kiểm tra booking mới...");
      const newBookings = await checkLastPages(snapshot);

      if (newBookings.length > 0) {
        const today = formatDate(new Date());

        // Lọc booking đủ điều kiện gửi Telegram:
        // - checkinDate = hôm nay
        // - tên khách KHÔNG chứa "gia hạn" (case-insensitive)
        const toNotify = newBookings.filter((b) => {
          if (b.checkinDate !== today) return false;
          if (/gia\s*h[aạ]n/i.test(b.guestName || "")) return false;
          return true;
        });

        const skipped = newBookings.length - toNotify.length;
        if (skipped > 0) log(`   ↩️  Bỏ qua ${skipped} booking (không phải hôm nay hoặc gia hạn) - đã lưu vào JSON`);

        if (toNotify.length > 0) {
          // Gom nhóm theo facility
          const byFacility = {};
          for (const b of toNotify) {
            if (!byFacility[b.facilityName]) byFacility[b.facilityName] = [];
            byFacility[b.facilityName].push(b);
          }

          for (const [facilityName, bookings] of Object.entries(byFacility)) {
            const lines = bookings.map(formatBookingMessage).join("\n");
            const msg = `🔔 <b>Booking mới - ${facilityName}</b>\n\n${lines}`;
            await sendTelegram(msg);
          }

          log(`🎉 Phát hiện ${newBookings.length} booking mới (gửi Telegram: ${toNotify.length})`);
        } else {
          log(`🎉 Phát hiện ${newBookings.length} booking mới (không có booking nào cần thông báo hôm nay)`);
        }
      } else {
        log("✅ Không có booking mới");
      }
    } catch (e) {
      log(`❌ Lỗi trong tick: ${e.message}`);
      await sendTelegram(`❌ <b>Lỗi Monitor</b>\n${e.message}\nTự động thử lại...`);
    }

    setTimeout(tick, MONITOR_INTERVAL);
  }

  setTimeout(tick, MONITOR_INTERVAL);
}

// ─── CLI commands ────────────────────────────────────────────────────────────
const command = process.argv[2];

if (command === "snapshot") {
  buildSnapshot().then((ok) => {
    if (ok) log("✅ Snapshot hoàn tất");
    else log("❌ Snapshot thất bại");
    process.exit(ok ? 0 : 1);
  });
} else {
  // Mặc định: chạy monitor liên tục
  log("🚀 Khởi động Booking Monitor Service...");
  monitorLoop().catch((e) => {
    log(`💥 Lỗi nghiêm trọng: ${e.message}`);
    process.exit(1);
  });
}
