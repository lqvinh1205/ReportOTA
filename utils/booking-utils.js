/**
 * utils/booking-utils.js
 * Shared booking utilities used by server.js, booking-monitor.js, etc.
 */

/**
 * Trả về chuỗi thanh toán theo nguồn OTA.
 * @param {string} source
 * @returns {string}
 */
function getTextPayment(source) {
  if (!source) return "thu khách";
  const config = {
    "Booking.com": "thu khách",
    "Khách lẻ": "thu khách",
    Ctrip: `${source} đã thanh toán`,
    DayLaDau: `${source} đã thanh toán`,
    Expedia: `${source} đã thanh toán`,
    Agoda: `${source} đã thanh toán`,
    Go2Joy: `${source} đã thanh toán`,
    "Airbnb XML": `${source} đã thanh toán`,
  };
  return config[source] || `${source} đã thanh toán`;
}

module.exports = { getTextPayment };
