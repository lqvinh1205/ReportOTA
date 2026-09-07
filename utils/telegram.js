/**
 * Telegram helpers dùng chung cho cả server.js và booking-monitor.js.
 *
 * Trước đây toàn bộ code Telegram nằm trong booking-monitor.js, nên server.js
 * không có cách nào báo admin khi chính nó phát hiện lỗi (ví dụ ghi nhận lần
 * đăng nhập sai thứ 3 từ một request API). Tách ra đây để cả hai process dùng.
 *
 * Không gộp/không chặn tin trùng: admin muốn thấy mọi thông báo. Việc chặn
 * spam do cơ chế khóa tài khoản đảm nhiệm — sau OTA_MAX_LOGIN_FAILURES lần
 * là tài khoản bị khóa và không thử login nữa.
 *
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (kênh admin).
 */

const axios = require("axios");

// Gửi tin về kênh Telegram admin chung. Không bao giờ throw.
async function sendAdminAlert(message, logger) {
  const log = logger || console.log;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    log("⚠️  Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID (env)");
    return false;
  }

  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
    });
    log("📨 Đã gửi Telegram lỗi (admin)");
    return true;
  } catch (e) {
    log(`❌ Gửi Telegram lỗi thất bại: ${e.message}`);
    return false;
  }
}

module.exports = { sendAdminAlert };
