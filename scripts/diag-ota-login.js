#!/usr/bin/env node
/**
 * Chẩn đoán lỗi 403 khi tải trang login OTA.
 *
 * Chạy trực tiếp trên server (cùng IP / cùng container với app):
 *   node scripts/diag-ota-login.js
 *   node scripts/diag-ota-login.js --full        # in toàn bộ body, không cắt
 *   node scripts/diag-ota-login.js --post EMAIL PASSWORD
 *
 * Script in ra: status, TOÀN BỘ response header và body của từng biến thể
 * request, để biết 403 do WAF/Cloudflare chặn IP hay do chính OTA trả về.
 */
require("dotenv").config();
const axios = require("axios");

const baseUrl = process.env.OTA_BASE_URL || "https://id.bluejaypms.com";
const loginPath = `${baseUrl}/login`;
const FULL = process.argv.includes("--full");
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

const APP_HEADERS = {
  "User-Agent": UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
  "Cache-Control": "no-cache",
};

function bodyToText(data) {
  if (data == null) return "";
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  try {
    return JSON.stringify(data, null, 2);
  } catch (e) {
    return String(data);
  }
}

function report(name, res) {
  const body = bodyToText(res.data);
  console.log(`\n=== ${name} ===`);
  console.log("status :", res.status, res.statusText || "");
  console.log("headers:");
  Object.entries(res.headers).forEach(([k, v]) => {
    console.log(`  ${k}: ${Array.isArray(v) ? v.join(" | ") : v}`);
  });
  console.log(`body   (${body.length} bytes):`);
  console.log(FULL ? body : body.slice(0, 4000));
  return res.status;
}

// Không throw theo status -> luôn có response để đọc body 403.
async function probe(name, config) {
  try {
    const res = await axios({
      validateStatus: () => true,
      maxRedirects: 0,
      timeout: 30000,
      ...config,
    });
    return report(name, res);
  } catch (error) {
    if (error.response) return report(`${name} (throw)`, error.response);
    console.log(`\n=== ${name} ===`);
    console.log("network error:", error.code || "", error.message);
    return null;
  }
}

(async () => {
  console.log("Target:", loginPath);
  console.log("Node  :", process.version);

  // IP công khai mà OTA nhìn thấy - dùng để đối chiếu whitelist/blocklist.
  await probe("0) IP công khai (ifconfig.me)", {
    method: "get",
    url: "https://ifconfig.me/ip",
  });

  // 1) Y hệt request đang lỗi trong server.js
  await probe("1) GET /login - header giống server.js", {
    method: "get",
    url: loginPath,
    headers: APP_HEADERS,
  });

  // 2) Không header tuỳ chỉnh -> nếu 200 thì 403 đến từ việc lọc header/UA
  await probe("2) GET /login - không header tuỳ chỉnh", {
    method: "get",
    url: loginPath,
  });

  // 3) Header trình duyệt đầy đủ (sec-fetch...) -> nếu 200 thì WAF đòi header browser
  await probe("3) GET /login - header trình duyệt đầy đủ", {
    method: "get",
    url: loginPath,
    headers: {
      ...APP_HEADERS,
      Referer: `${baseUrl}/`,
      Connection: "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "sec-ch-ua": '"Chromium";v="138", "Not(A:Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Linux"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Accept-Encoding": "gzip, deflate, br",
    },
  });

  // 4) Trang gốc - phân biệt chặn cả site hay chỉ /login
  await probe("4) GET / (trang gốc)", {
    method: "get",
    url: `${baseUrl}/`,
    headers: APP_HEADERS,
  });

  // 5) POST login thật (chỉ khi truyền --post EMAIL PASSWORD)
  const postIdx = process.argv.indexOf("--post");
  if (postIdx !== -1) {
    const email = process.argv[postIdx + 1];
    const password = process.argv[postIdx + 2];
    if (!email || !password) {
      console.log("\n--post cần đủ: --post EMAIL PASSWORD");
      return;
    }
    const page = await axios.get(loginPath, {
      headers: APP_HEADERS,
      validateStatus: () => true,
    });
    if (page.status !== 200) {
      console.log("\nBỏ qua POST: GET /login trả về", page.status);
      return;
    }
    const html = bodyToText(page.data);
    const pick = (name) =>
      (html.match(new RegExp(`${name}[^>]*value="([^"]*)"`)) || [])[1] || "";
    const cookies = (page.headers["set-cookie"] || [])
      .map((c) => c.split(";")[0])
      .join("; ");
    const form = new URLSearchParams({
      __EVENTTARGET: "lkLogin",
      __EVENTARGUMENT: "",
      __VIEWSTATE: pick("__VIEWSTATE"),
      __VIEWSTATEGENERATOR: pick("__VIEWSTATEGENERATOR"),
      __EVENTVALIDATION: pick("__EVENTVALIDATION"),
      ddlLangCode: "vi-VN",
      txtEmail: email,
      txtPassword: password,
      hfClientTime: new Date().toISOString(),
    });
    await probe("5) POST /login", {
      method: "post",
      url: loginPath,
      data: form.toString(),
      headers: {
        ...APP_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: baseUrl,
        Referer: loginPath,
        Cookie: cookies,
      },
    });
  }
})();
