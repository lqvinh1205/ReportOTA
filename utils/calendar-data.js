/**
 * utils/calendar-data.js
 *
 * Lấy booking từ /app/calendar (JSON nhúng sẵn trong HTML: CalendarOption.ListRoom,
 * CalendarOption.BookingGroup) thay vì scrape bảng /app/Reservation nhiều lần
 * (mỗi roomType × mỗi TypeSeachDate 0/1/3 × mỗi trang). Dùng chung giữa server.js
 * và booking-monitor.js, giống cách utils/ota-session.js đã dùng chung.
 *
 * Field mapping totalAmount/paid/balance dùng chung 1 giá trị (BookingGroup.Balance):
 * test sống trên dữ liệu thật cho thấy BookingGroup.Total luôn = 0 (không dùng
 * được), còn Balance mới là tổng tiền booking thật, khớp đúng totalAmount hiện
 * tại của /app/Reservation. Calendar không có field nào cho "số tiền còn nợ"
 * tách biệt.
 */

const axios = require("axios");
const { URLSearchParams } = require("url");
const dayjs = require("dayjs");
const customParseFormat = require("dayjs/plugin/customParseFormat");
dayjs.extend(customParseFormat);

const otaSession = require("./ota-session");

const BASE_URL = process.env.OTA_BASE_URL || "https://id.bluejaypms.com";

const HTTP_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
};

// Xác nhận sống trên 30 booking thật (đối chiếu với /app/Reservation):
// 0=Đã xác nhận, 1=Đang giữ phòng, 3=Đã nhận phòng, 4=Đã trả phòng.
const STATUS_TEXT = {
  0: "Đã xác nhận",
  1: "Đang giữ phòng",
  3: "Đã nhận phòng",
  4: "Đã trả phòng",
};

function isRedirectToLogin(resp) {
  if (!resp) return false;
  if (resp.status < 300 || resp.status >= 400) return false;
  return /\/app\/login|\/login/i.test(resp.headers?.location || "");
}

// Giống extractExpediaCollectAmount ở server.js/booking-monitor.js: giá hiển
// thị chung là giá gộp OTA, giá net thực nhận nằm trong ghi chú "Collect Amount".
function extractExpediaCollectAmount(noteText) {
  if (!noteText) return "";
  const match = noteText.match(/Collect Amount:\s*[₫đ]?\s*([\d.,]+)/i);
  return match ? match[1].replace(/,/g, ".") : "";
}

// VND không có phần thập phân; /app/Reservation hiển thị số dạng "10.341.358"
// (dấu chấm ngăn cách hàng nghìn) — format lại để downstream (vốn parse chuỗi
// kiểu này) nhận được đúng định dạng như trước, không đổi hành vi hiện có.
function formatVndAmount(n) {
  const num = Math.round(Number(n) || 0);
  return num.toLocaleString("vi-VN");
}

function extractCalendarOptionData(html) {
  const listRoomMatch = html.match(/CalendarOption\.ListRoom\s*=\s*(\[[\s\S]*?\]);/);
  const bookingGroupMatch = html.match(/CalendarOption\.BookingGroup\s*=\s*(\[[\s\S]*?\]);/);
  let listRoom = [];
  let bookingGroup = [];
  if (listRoomMatch) {
    try { listRoom = JSON.parse(listRoomMatch[1]); } catch (e) { /* HTML không đúng dạng mong đợi, trả mảng rỗng */ }
  }
  if (bookingGroupMatch) {
    try { bookingGroup = JSON.parse(bookingGroupMatch[1]); } catch (e) { /* như trên */ }
  }
  return { listRoom, bookingGroup };
}

/**
 * GET /app/calendar không tham số — dùng cho danh sách phòng (không cần lọc
 * theo ngày). Giữ đúng hành vi của fetchRoomListForFacility cũ trong server.js.
 */
async function fetchCalendarPageRaw(facility, loginFn, opts = {}) {
  const log = opts.log || console.log;
  const calendarUrl = `${BASE_URL}/app/calendar`;

  const outcome = await otaSession.withSession(
    facility,
    loginFn,
    async (cookies) => {
      log(`🌐 GET /app/calendar cho ${facility.name}`);
      return axios.get(calendarUrl, {
        headers: { ...HTTP_HEADERS, Cookie: cookies, "Cache-Control": "no-cache" },
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
      });
    },
    { isRejected: (resp) => isRedirectToLogin(resp) },
  );

  if (!outcome.ok) return { ok: false, error: outcome.error, code: outcome.code, sessionError: outcome };
  if (outcome.result.status !== 200) return { ok: false, error: `Calendar page request failed: ${outcome.result.status}` };
  return { ok: true, ...extractCalendarOptionData(outcome.result.data) };
}

/**
 * POST /app/calendar cho facility, lọc theo BeginShowDate/EndShowDate và
 * RoomTypeIds (mặc định = facility.roomTypes, truyền được nhiều giá trị —
 * xác nhận sống: repeated-key hoạt động đúng, lọc chính xác theo roomType).
 */
async function fetchCalendarData(facility, loginFn, beginShowDate, endShowDate, opts = {}) {
  const log = opts.log || console.log;
  const roomTypeIds = opts.roomTypeIds || facility.roomTypes;
  const calendarUrl = `${BASE_URL}/app/calendar`;

  const body = new URLSearchParams();
  body.append("BeginShowDate", beginShowDate);
  body.append("EndShowDate", endShowDate);
  roomTypeIds.forEach((id) => body.append("RoomTypeIds", id));
  body.append("Floors", opts.floors || "");

  const outcome = await otaSession.withSession(
    facility,
    loginFn,
    async (cookies) => {
      log(`🌐 POST /app/calendar cho ${facility.name} (${beginShowDate} → ${endShowDate})`);
      return axios.post(calendarUrl, body.toString(), {
        headers: {
          ...HTTP_HEADERS,
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: BASE_URL,
          Referer: calendarUrl,
          Cookie: cookies,
        },
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
      });
    },
    { isRejected: (resp) => isRedirectToLogin(resp) },
  );

  if (!outcome.ok) return { ok: false, error: outcome.error, code: outcome.code, sessionError: outcome };
  if (outcome.result.status !== 200) return { ok: false, error: `Calendar page request failed: ${outcome.result.status}` };
  return { ok: true, fromCache: outcome.fromCache, ...extractCalendarOptionData(outcome.result.data) };
}

// Lọc ListRoom theo facility.roomTypes, ra danh sách phòng đơn giản — thay
// logic đã có trong fetchRoomListForFacility (server.js).
function filterRoomsForFacility(listRoom, facility) {
  return listRoom
    .filter((room) => {
      const roomTypeId = room.RoomTypeId || room.Group || room.TypeRoomId || room.Type;
      return facility.roomTypes.includes(roomTypeId);
    })
    .map((room) => ({
      id: room.Id,
      name: room.Name,
      roomNumber: room.Number,
      roomTypeId: room.RoomTypeId || room.Group || room.TypeRoomId || room.Type,
      floor: room.Floor || null,
    }));
}

async function getRoomList(facility, loginFn, opts = {}) {
  const result = await fetchCalendarPageRaw(facility, loginFn, opts);
  if (!result.ok) return { success: false, error: result.error, code: result.code, sessionError: result.sessionError };
  return { success: true, roomList: filterRoomsForFacility(result.listRoom, facility) };
}

/**
 * Join Details[0].RoomId -> ListRoom để ra tên phòng, map từng BookingGroup
 * thành object booking đúng shape cũ (bookingCode, otaReference, guestName,
 * property, room, source, status, checkinDate/Time, checkoutDate/Time,
 * totalAmount, paid, balance, notes), sort tăng dần theo checkinDate.
 * Không có bookingDate (ngày đặt) — field này không tồn tại trong BookingGroup
 * và không được dùng ở đâu trong frontend nên bỏ hẳn.
 *
 * `id` (= BookingGroup.Id) được giữ thêm để dùng làm khoá dedup phía server:
 * `bookingCode` (= Code) là mã đặt phòng chung cho cả group, nhiều phòng
 * trong 1 group (GroupId) share cùng Code nên không dùng để phân biệt từng
 * phòng được — `id` thì luôn duy nhất theo từng dòng/phòng.
 */
function mapBookingGroupToBookings(bookingGroup, listRoom, ctx = {}) {
  const roomById = new Map(listRoom.map((r) => [r.Id, r]));

  // Sort tăng dần theo BeginDate trước khi map — tránh phải nhét field nội bộ
  // (_beginDate) vào object booking trả ra ngoài.
  const sortedGroup = [...bookingGroup].sort((a, b) =>
    a.BeginDate < b.BeginDate ? -1 : a.BeginDate > b.BeginDate ? 1 : 0,
  );

  return sortedGroup.map((b) => {
    const detail = (b.Details && b.Details[0]) || {};
    const room = roomById.get(detail.RoomId);

    let totalAmount = formatVndAmount((b.Payment || 0) + (b.Balance || 0));
    let paid = formatVndAmount(b.Balance);

    const notes = (b.Notes && b.Notes[0] && b.Notes[0].Note) || "";
    const source = b.ChanelName || "";

    // Expedia: giá hiển thị chung là giá gộp OTA, giá net thực nhận nằm trong
    // "Collect Amount" của ghi chú — giữ đúng logic override cũ.
    if (source === "Expedia") {
      const collectAmount = extractExpediaCollectAmount(notes);
      if (collectAmount) {
        totalAmount = collectAmount;
        paid = collectAmount;
      }
    }

    return {
      id: b.Id,
      bookingCode: b.Code,
      otaReference: b.ChanelId,
      guestName: b.Customer || b.Name || "",
      property: ctx.facilityName || "",
      room: room ? room.Name : "",
      roomType: detail.TypeRoomId,
      source,
      status: STATUS_TEXT[b.Status] || String(b.Status),
      checkinDate: b.BeginDate ? dayjs(b.BeginDate).format("DD/MM/YYYY") : "",
      checkinTime: (b.ArrivalTime || "").slice(0, 5),
      checkoutDate: b.EndDate ? dayjs(b.EndDate).format("DD/MM/YYYY") : "",
      checkoutTime: (b.DepartureTime || "").slice(0, 5),
      totalAmount,
      paid,
      notes,
      facilityId: ctx.facilityId,
      facilityName: ctx.facilityName,
    };
  });
}

/**
 * Đến = BeginDate == D; đi = EndDate == D; lưu = BeginDate < D < EndDate (loại
 * trừ 2 đầu mút — 1 booking check-in hôm nay CHỈ tính là "đến", không tính
 * thêm là "lưu"; ngày mai (check-out) nó tính là "đi". Ba nhóm loại trừ lẫn
 * nhau, khác với cách /app/Reservation gốc gộp "lưu" bao trùm cả ngày đến —
 * xác nhận đây là hành vi mong muốn, không phải theo y nguyên OTA). Thay thế
 * 3 lần gọi TypeSeachDate 0/1/3 bằng 1 lần lọc trên dữ liệu đã fetch.
 */
function categorizeByDate(bookings, targetDateDDMMYYYY) {
  const target = dayjs(targetDateDDMMYYYY, "DD/MM/YYYY");
  const arriving = [];
  const departing = [];
  const staying = [];

  for (const b of bookings) {
    const begin = dayjs(b.checkinDate, "DD/MM/YYYY");
    const end = dayjs(b.checkoutDate, "DD/MM/YYYY");

    if (begin.isSame(target, "day")) {
      arriving.push({ ...b, typeSeachDate: 0, searchType: "Phòng đến" });
    } else if (end.isSame(target, "day")) {
      departing.push({ ...b, typeSeachDate: 1, searchType: "Phòng đi" });
    } else if (begin.isBefore(target, "day") && end.isAfter(target, "day")) {
      staying.push({ ...b, typeSeachDate: 3, searchType: "Phòng lưu" });
    }
  }

  return { arriving, departing, staying };
}

module.exports = {
  extractCalendarOptionData,
  fetchCalendarPageRaw,
  fetchCalendarData,
  filterRoomsForFacility,
  getRoomList,
  mapBookingGroupToBookings,
  categorizeByDate,
};
