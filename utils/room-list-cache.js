/**
 * utils/room-list-cache.js
 *
 * ListRoom trả về từ POST /app/calendar (calendarData.fetchCalendarData) THIẾU
 * phòng một cách ngẫu nhiên — xác nhận sống: chỉ 7/14 phòng cho 1 facility,
 * lỗi từ chính OTA server (không phải bug parse phía client). GET /app/calendar
 * (không tham số ngày, calendarData.fetchCalendarPageRaw) luôn trả ListRoom
 * đầy đủ. Module này cache kết quả GET đó theo facilityId, tái sử dụng cho cả
 * việc join tên phòng (mapBookingGroupToBookings) lẫn /api/list-rooms, thay vì
 * gọi GET /app/calendar mỗi lần — OTA (BlueJay) rất nhạy với số lượng request
 * (xem utils/ota-session.js).
 *
 * Cố tình đơn giản: cache phẳng theo facilityId, đọc/ghi file trực tiếp,
 * không có _rev/optimistic-concurrency hay inflight-singleflight như
 * utils/ota-session.js — rủi ro 2 process (server.js + booking-monitor.js)
 * ghi đè nhau hiếm khi xảy ra và hậu quả nhẹ (fetch lại sớm hơn TTL).
 */

const fs = require("fs");
const path = require("path");

const calendarData = require("./calendar-data");

const CACHE_PATH = path.join(__dirname, "..", "config", "room-list-cache.json");
const TTL_MS = Number(process.env.ROOM_LIST_CACHE_TTL_MS) || 6 * 60 * 60 * 1000;

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
  } catch (_) {
    return {};
  }
}

function writeCache(cache) {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
  } catch (e) {
    console.error(`❌ Không ghi được ${CACHE_PATH}: ${e.message}`);
  }
}

/**
 * Trả về { ok:true, listRoom, fromCache } hoặc { ok:false, error, code, sessionError }
 * (mirror shape lỗi của fetchCalendarPageRaw).
 */
async function getCachedListRoom(facilityId, facility, loginFn, opts = {}) {
  const cache = readCache();
  const entry = cache[facilityId];

  if (!opts.forceRefresh && entry && Date.now() < entry.expiresAt) {
    return { ok: true, listRoom: entry.listRoom, fromCache: true };
  }

  const result = await calendarData.fetchCalendarPageRaw(facility, loginFn, opts);
  if (!result.ok) {
    return { ok: false, error: result.error, code: result.code, sessionError: result.sessionError };
  }

  cache[facilityId] = {
    listRoom: result.listRoom,
    fetchedAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
  };
  writeCache(cache);

  return { ok: true, listRoom: result.listRoom, fromCache: false };
}

module.exports = { getCachedListRoom };
