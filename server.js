const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { URLSearchParams } = require("url");
const dayjs = require("dayjs");
const bcrypt = require("bcrypt");
const customParseFormat = require("dayjs/plugin/customParseFormat");
dayjs.extend(customParseFormat);

const {
  authenticateToken,
  checkFacilityAccess,
  generateToken,
  loadUsers,
  loadFacilities,
  getUserOtaConfig,
  saveUserOtaConfig,
} = require("./middleware/auth");
const otaSession = require("./utils/ota-session");

// Load environment variables
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "0.0.0.0";

// Configure CORS - Allow all origins if CORS_ORIGINS is 'all'
const corsOptions = {
  origin:
    process.env.CORS_ORIGINS === "all"
      ? true
      : process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(",")
      : true,
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from current directory
app.use(express.static("."));

// OTA API parameters
const params = {
  txtEmail: process.env.OTA_EMAIL,
  txtPassword: process.env.OTA_PASSWORD,
};

const baseUrl = process.env.OTA_BASE_URL || "https://id.bluejaypms.com";
const loginPath = `${baseUrl}/login`;
const reservationPath = `${baseUrl}/app/Reservation`;

// Cloudflare (đứng trước OTA) chặn IP datacenter với 403 "Sorry, you have been blocked".
// Nếu IP server không được whitelist, đặt OTA_PROXY trỏ tới proxy có IP được chấp nhận
// (vd: OTA_PROXY=http://user:pass@1.2.3.4:8080). Chỉ request tới host OTA đi qua proxy,
// các call khác (Telegram, DLD, Go2Joy) vẫn đi trực tiếp.
// Giữ giống booking-monitor.js:30-70 — sửa một bên thì phải sửa cả bên kia.
const otaProxyUrl = process.env.OTA_PROXY || "";
const otaHost = new URL(baseUrl).host;

function parseProxyUrl(raw) {
  const u = new URL(raw);
  const proxy = {
    protocol: u.protocol.replace(":", ""),
    host: u.hostname,
    port: Number(u.port) || (u.protocol === "https:" ? 443 : 80),
  };
  if (u.username) {
    proxy.auth = {
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password || ""),
    };
  }
  return proxy;
}

if (otaProxyUrl) {
  try {
    const otaProxy = parseProxyUrl(otaProxyUrl);
    axios.interceptors.request.use((config) => {
      const target = new URL(config.url, baseUrl);
      if (target.host === otaHost) {
        config.proxy = otaProxy;
      }
      return config;
    });
    console.log(
      `🌐 OTA proxy enabled: ${otaProxy.protocol}://${otaProxy.host}:${otaProxy.port} (chỉ cho ${otaHost})`,
    );
  } catch (e) {
    console.error("❌ OTA_PROXY không hợp lệ, bỏ qua:", e.message);
  }
}

// Store session cookies
let sessionCookies = "";

// Helper function to extract cookies from response
function extractCookies(response) {
  const cookies = response.headers["set-cookie"];
  if (cookies) {
    return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
  }
  return "";
}

function mergeCookieStrings(...cookieStrings) {
  const cookieMap = new Map();

  cookieStrings.filter(Boolean).forEach((cookieString) => {
    cookieString.split(";").forEach((part) => {
      const trimmed = part.trim();
      if (!trimmed) return;

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) return;

      const name = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!name) return;

      cookieMap.set(name, value);
    });
  });

  return Array.from(cookieMap.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function isOtaLoginSuccessful(loginResponse, cookies) {
  const redirectLocation = loginResponse.headers.location || "";
  const hasValidRedirect =
    loginResponse.status >= 300 &&
    loginResponse.status < 400 &&
    redirectLocation &&
    !/\/login/i.test(redirectLocation);
  const hasTokenCookie = /(?:^|;\s*)HtToken=/.test(cookies || "");

  return hasValidRedirect && hasTokenCookie;
}

function isRedirectToLogin(response) {
  if (!response) return false;
  if (response.status < 300 || response.status >= 400) return false;

  const location = response.headers?.location || "";
  return /\/app\/login|\/login/i.test(location);
}

function extractHiddenField(html, fieldName) {
  const match = html.match(
    new RegExp(`${fieldName}[^>]*value=\"([^\"]*)\"`, "i"),
  );
  return match ? match[1] : "";
}

async function canAccessReservation(cookies, roomType, fromDate, toDate) {
  const probeParams = {
    TypeSeachDate: 1,
    FromDate: fromDate,
    ToDate: toDate,
    RoomType: roomType,
    RoomDetail: "",
    SourceType: "",
    Source: "",
    Status: "1,0,3,4,2",
    Seach: "",
    IsExtensionFilder: true,
    p: 1,
  };

  const probeUrl = `${reservationPath}?${new URLSearchParams(
    probeParams,
  ).toString()}`;
  const response = await axios.get(probeUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
      "Cache-Control": "no-cache",
      Referer: `${baseUrl}/`,
      Cookie: cookies,
    },
    maxRedirects: 0,
    validateStatus: function (status) {
      return status >= 200 && status < 400;
    },
  });

  return !isRedirectToLogin(response);
}

async function resolveMultiHotelSessionCookies(
  initialCookies,
  hotelId,
) {
  const myHotelsUrl = `${baseUrl}/my-hotels`;

  const myHotelsResponse = await axios.get(myHotelsUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
      "Cache-Control": "no-cache",
      Cookie: initialCookies,
    },
  });

  const pageHtml = String(myHotelsResponse.data || "");

  // Parse all hotel rows: pair each hrId value with its __doPostBack eventTarget
  // HTML structure: <input ... name="lvHotels$ctrl{N}$hrId" value="{hotelNumericId}" />
  //                 <a ... href="javascript:__doPostBack('lvHotels$ctrl{N}$lbtNameHotel','')">
  const hotelRows = [];
  const hrIdRegex = /name="(lvHotels\$ctrl(\d+)\$hrId)"[^>]*value="(\d+)"/g;
  let hrMatch;
  while ((hrMatch = hrIdRegex.exec(pageHtml)) !== null) {
    const idx = hrMatch[2];
    const parsedId = parseInt(hrMatch[3], 10);
    // The corresponding __doPostBack target for this row
    const eventTarget = `lvHotels$ctrl${idx}$lbtNameHotel`;
    hotelRows.push({ idx, hotelNumericId: parsedId, eventTarget });
  }

  console.log(`🏨 Found ${hotelRows.length} hotel(s) on /my-hotels:`, hotelRows.map(h => `${h.hotelNumericId}→${h.eventTarget}`));

  if (hotelRows.length === 0) {
    return { success: false, error: "No hotel options found on /my-hotels" };
  }

  // Find the row matching the configured hotelId
  const targetRow = hotelId
    ? hotelRows.find((h) => h.hotelNumericId === Number(hotelId))
    : null;

  if (!targetRow) {
    return {
      success: false,
      error: `Hotel ID ${hotelId} not found on /my-hotels page. Available IDs: ${hotelRows.map((h) => h.hotelNumericId).join(", ")}`,
    };
  }

  console.log(`🎯 Selecting hotel ID ${hotelId} via eventTarget: ${targetRow.eventTarget}`);

  const postData = new URLSearchParams({
    __EVENTTARGET: targetRow.eventTarget,
    __EVENTARGUMENT: "",
    __VIEWSTATE: extractHiddenField(pageHtml, "__VIEWSTATE"),
    __VIEWSTATEGENERATOR: extractHiddenField(pageHtml, "__VIEWSTATEGENERATOR"),
    __EVENTVALIDATION: extractHiddenField(pageHtml, "__EVENTVALIDATION"),
  });

  const selectHotelResponse = await axios.post(
    myHotelsUrl,
    postData.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
        "Cache-Control": "no-cache",
        Referer: myHotelsUrl,
        Origin: baseUrl,
        Cookie: initialCookies,
      },
      maxRedirects: 0,
      validateStatus: function (status) {
        return status >= 200 && status < 400;
      },
    },
  );

  const finalCookies = mergeCookieStrings(
    initialCookies,
    extractCookies(selectHotelResponse),
  );

  console.log(`✅ Hotel context selected, cookies updated.`);

  return {
    success: true,
    cookies: finalCookies,
    selectedTarget: targetRow.eventTarget,
    selectedHotelId: hotelId,
  };
}

// Performs OTA login for a facility and resolves multi-hotel cookie context if needed.
// Returns { success, cookies, error?, facility? }
async function loginAndResolveCookies(facility) {
  const loginResult = await performLogin(facility.email, facility.password);
  if (!loginResult.success) {
    return { success: false, error: loginResult.error || "OTA login failed", otaStatus: loginResult.status, redirectLocation: loginResult.redirectLocation };
  }

  let cookies = loginResult.cookies;

  if (/\/my-hotels/i.test(loginResult.redirectLocation || "")) {
    console.log("🏨 Multi-hotel account detected, selecting hotel context...");
    if (!facility.hotelId) {
      return {
        success: false,
        error: `Facility "${facility.name}" is a multi-hotel account but has no hotelId configured in facilities.json`,
      };
    }
    const contextResult = await resolveMultiHotelSessionCookies(cookies, facility.hotelId);
    if (!contextResult.success) {
      return { success: false, error: contextResult.error };
    }
    cookies = contextResult.cookies;
    console.log("✅ Selected hotel context:", contextResult.selectedTarget, "(hotelId:", facility.hotelId, ")");
  }

  return { success: true, cookies };
}

// Reusable login function - returns cookies locally, does NOT modify the global sessionCookies
async function performLogin(facilityEmail = null, facilityPassword = null) {
  let localCookies = "";
  try {
    console.log("🔐 Starting login process...");

    // Use facility credentials or default params
    const email = facilityEmail || params.txtEmail;
    const password = facilityPassword || params.txtPassword;

    // First, get the login page to extract viewstate and other hidden fields
    const loginPageResponse = await axios.get(loginPath, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
        "Cache-Control": "no-cache",
      },
    });

    // Extract session cookies into local variable
    localCookies = extractCookies(loginPageResponse);
    console.log("📄 Login page loaded, cookies:", localCookies);

    // Extract hidden form fields from login page
    const loginPageHtml = loginPageResponse.data;
    const viewStateMatch =
      loginPageHtml.match(/__VIEWSTATE[^>]*value="([^"]*)"/) || [];
    const viewStateGeneratorMatch =
      loginPageHtml.match(/__VIEWSTATEGENERATOR[^>]*value="([^"]*)"/) || [];
    const eventValidationMatch =
      loginPageHtml.match(/__EVENTVALIDATION[^>]*value="([^"]*)"/) || [];

    const viewState = viewStateMatch[1] || "";
    const viewStateGenerator = viewStateGeneratorMatch[1] || "";
    const eventValidation = eventValidationMatch[1] || "";

    console.log("🔍 Extracted form fields:");
    console.log("ViewState:", viewState.substring(0, 50) + "...");
    console.log("ViewStateGenerator:", viewStateGenerator);
    console.log("EventValidation:", eventValidation.substring(0, 50) + "...");

    // Prepare login form data
    const loginData = new URLSearchParams({
      __EVENTTARGET: "lkLogin",
      __EVENTARGUMENT: "",
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: viewStateGenerator,
      __EVENTVALIDATION: eventValidation,
      ddlLangCode: "vi-VN",
      txtEmail: email,
      txtPassword: password,
      hfClientTime: new Date().toISOString(),
    });

    // Perform login
    const loginResponse = await axios.post(loginPath, loginData.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
        "Cache-Control": "no-cache",
        Origin: baseUrl,
        Referer: loginPath,
        Cookie: localCookies,
      },
      maxRedirects: 0,
      validateStatus: function (status) {
        return status >= 200 && status < 400; // Accept redirects
      },
    });

    // Merge login-page cookies and post-login cookies into one request cookie jar.
    const newCookies = extractCookies(loginResponse);
    localCookies = mergeCookieStrings(localCookies, newCookies);

    console.log("✅ Login response status:", loginResponse.status);
    console.log("🍪 Updated cookies:", localCookies);

    if (!isOtaLoginSuccessful(loginResponse, localCookies)) {
      return {
        success: false,
        status: loginResponse.status,
        error:
          "OTA login failed. Check OTA username/password for this facility.",
        redirectLocation: loginResponse.headers.location || null,
      };
    }

    return {
      success: true,
      status: loginResponse.status,
      message: "Login successful",
      cookies: localCookies,
      redirectLocation: loginResponse.headers.location || null,
    };
  } catch (error) {
    console.error("❌ Login error:", error.message);
    return {
      success: false,
      error: error.message,
      details: error.response
        ? {
            status: error.response.status,
            data: error.response.data.substring(0, 500),
          }
        : null,
    };
  }
}

// Login endpoint
app.post("/api/login", async (req, res) => {
  try {
    const loginResult = await performLogin();
    res.json(loginResult);
  } catch (error) {
    console.error("❌ Login endpoint error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Fetch report endpoint
app.get("/api/report", async (req, res) => {
  try {
    console.log("📊 Fetching report...");
    console.log("params", params);

    const queryString = new URLSearchParams(params).toString();
    const reportUrl = `${reservationPath}?${queryString}`;

    console.log("🔗 Report URL:", reportUrl);
    console.log("🍪 Using cookies:", sessionCookies);

    const reportResponse = await axios.get(reportUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
        "Cache-Control": "no-cache",
        Referer: `${baseUrl}/`,
        Cookie: sessionCookies,
      },
      maxRedirects: 5,
    });

    console.log("✅ Report fetched successfully");
    console.log("📏 Data length:", reportResponse.data.length);

    // Parse HTML to extract meaningful data
    const htmlData = reportResponse.data;

    // Parse booking data from the report
    const parsedData = parseBookingData(htmlData);

    res.json({
      success: true,
      status: reportResponse.status,
      ...parsedData,
    });
  } catch (error) {
    console.error("❌ Report fetch error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response
        ? {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data
              ? error.response.data.substring(0, 500)
              : null,
          }
        : null,
    });
  }
});

// Facility and RoomType configuration - Load from config file
let facilities = loadFacilities();

// facilities.json giờ vừa là config vừa là nơi lưu session/cờ khóa, và
// booking-monitor.js (process khác) cũng ghi vào đó. Trước đây file này chỉ
// được đọc một lần lúc boot nên admin sửa gì cũng phải restart container —
// và tệ hơn: server.js sẽ giữ mật khẩu cũ trong khi monitor đã dùng mật khẩu
// mới, khiến hai process luân phiên hủy session của nhau.
// Middleware này đọc lại khi file đổi (so sánh mtime), nên ~12 chỗ dùng biến
// `facilities` bên dưới không phải sửa gì.
app.use((req, res, next) => {
  const fresh = otaSession.getFacilities();
  if (fresh && Object.keys(fresh).length) facilities = fresh;
  next();
});

// Ánh xạ lỗi session sang HTTP. LƯU Ý: không dùng 401/403 cho trường hợp khóa
// tài khoản OTA — fetchWithAuth (script.js) và authedFetch (ota-settings.js)
// coi 401/403 là "hết phiên đăng nhập" và redirect thẳng về login.html, admin
// sẽ bị đá ra ngoài thay vì đọc được thông báo.
function sendOtaSessionError(res, sess, facilityId, facility) {
  const facilityInfo = { id: facilityId, name: facility && facility.name };
  switch (sess.code) {
    case "LOCKED":
      return res.status(423).json({
        success: false,
        code: "OTA_ACCOUNT_LOCKED",
        error: sess.error,
        facility: facilityInfo,
        account: {
          key: sess.key,
          lockedAt: sess.lockedAt,
          lockReason: sess.lockReason,
          consecutiveFailures: sess.consecutiveFailures,
        },
      });
    case "CIRCUIT_OPEN":
      res.set("Retry-After", String(Math.ceil((sess.retryAfterMs || 0) / 1000)));
      return res.status(503).json({
        success: false,
        code: "OTA_CIRCUIT_OPEN",
        error: sess.error,
        facility: facilityInfo,
        openUntil: sess.openUntil,
        retryAfterSeconds: Math.ceil((sess.retryAfterMs || 0) / 1000),
      });
    case "NO_CREDENTIALS":
      return res.status(500).json({
        success: false,
        code: "OTA_NO_CREDENTIALS",
        error: sess.error,
        facility: facilityInfo,
      });
    case "SESSION_REJECTED":
      return res.status(401).json({
        success: false,
        code: "OTA_SESSION_REJECTED",
        error: sess.error,
        facility: facilityInfo,
      });
    default:
      return res.status(401).json({
        success: false,
        code: "OTA_LOGIN_FAILED",
        error: sess.error,
        facility: facilityInfo,
        consecutiveFailures: sess.consecutiveFailures,
        remainingAttempts: sess.remainingAttempts,
      });
  }
}

// ===== AUTHENTICATION ENDPOINTS =====

// User login endpoint
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Username and password required",
      });
    }

    // Load users
    const users = loadUsers();
    const user = users.find((u) => u.username === username && u.active);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
        code: "INVALID_CREDENTIALS",
      });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
        code: "INVALID_CREDENTIALS",
      });
    }

    // Generate token
    const token = generateToken(user);

    // Get user facilities
    const userFacilities = user.facilities.map((facilityId) => ({
      id: facilityId,
      name: facilities[facilityId]?.name || facilityId,
      roomTypes: facilities[facilityId]?.roomTypes || [],
    }));

    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
        facilities: userFacilities,
      },
    });
  } catch (error) {
    console.error("❌ Login error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Verify token endpoint
app.get("/api/auth/verify", authenticateToken, (req, res) => {
  const userFacilities = req.user.facilities.map((facilityId) => ({
    id: facilityId,
    name: facilities[facilityId]?.name || facilityId,
    roomTypes: facilities[facilityId]?.roomTypes || [],
  }));

  res.json({
    success: true,
    user: {
      ...req.user,
      facilities: userFacilities,
    },
  });
});

// Get user profile
app.get("/api/auth/profile", authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: req.user,
  });
});

// ===== END AUTHENTICATION ENDPOINTS =====

// Get facilities endpoint - Now requires authentication
app.get("/api/facilities", authenticateToken, (req, res) => {
  // Filter facilities based on user's access
  const userFacilityIds = req.user.facilities || [];

  let accessibleFacilities;
  if (req.user.role === "admin") {
    // Admin can see all facilities
    accessibleFacilities = Object.keys(facilities);
  } else {
    // Other users can only see their assigned facilities
    accessibleFacilities = userFacilityIds;
  }

  const facilitiesInfo = accessibleFacilities.map((key) => ({
    id: key,
    name: facilities[key]?.name || key,
    roomTypes: facilities[key]?.roomTypes || [],
    address: facilities[key]?.address || "",
  }));

  res.json({
    success: true,
    facilities: facilitiesInfo,
  });
});

// Combined login and fetch endpoint with multi-TypeSeachDate support
app.post("/api/login-and-fetch", async (req, res) => {
  try {
    console.log("🚀 Starting login and comprehensive fetch process...");

    // First, perform login using the same logic as /api/login endpoint
    console.log("🔐 Starting login process...");

    // Get the login page to extract viewstate and other hidden fields
    const loginPageResponse = await axios.get(loginPath, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
        "Cache-Control": "no-cache",
      },
    });

    // Extract session cookies
    sessionCookies = extractCookies(loginPageResponse);
    console.log("📄 Login page loaded, cookies:", sessionCookies);

    // Extract hidden form fields from login page
    const loginPageHtml = loginPageResponse.data;
    const viewStateMatch =
      loginPageHtml.match(/__VIEWSTATE[^>]*value="([^"]*)"/) || [];
    const viewStateGeneratorMatch =
      loginPageHtml.match(/__VIEWSTATEGENERATOR[^>]*value="([^"]*)"/) || [];
    const eventValidationMatch =
      loginPageHtml.match(/__EVENTVALIDATION[^>]*value="([^"]*)"/) || [];

    const viewState = viewStateMatch[1] || "";
    const viewStateGenerator = viewStateGeneratorMatch[1] || "";
    const eventValidation = eventValidationMatch[1] || "";

    console.log("🔍 Extracted form fields:");
    console.log("ViewState:", viewState.substring(0, 50) + "...");
    console.log("ViewStateGenerator:", viewStateGenerator);
    console.log("EventValidation:", eventValidation.substring(0, 50) + "...");

    // Prepare login form data using the same format as /api/login
    const loginData = new URLSearchParams({
      __EVENTTARGET: "lkLogin",
      __EVENTARGUMENT: "",
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: viewStateGenerator,
      __EVENTVALIDATION: eventValidation,
      ddlLangCode: "vi-VN",
      txtEmail: params.txtEmail, // Use the same params as /api/login
      txtPassword: params.txtPassword, // Use the same params as /api/login
      hfClientTime: new Date().toISOString(),
    });

    // Perform login using the same headers as /api/login
    const loginResponse = await axios.post(loginPath, loginData.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
        "Cache-Control": "no-cache",
        Origin: baseUrl,
        Referer: loginPath,
        Cookie: sessionCookies,
      },
      maxRedirects: 0,
      validateStatus: function (status) {
        return status >= 200 && status < 400; // Accept redirects
      },
    });

    // Update session cookies
    const newCookies = extractCookies(loginResponse);
    if (newCookies) {
      sessionCookies = newCookies;
    }

    console.log("✅ Login response status:", loginResponse.status);
    console.log("🍪 Updated cookies:", sessionCookies);

    const loginResult = {
      success: true,
      status: loginResponse.status,
      message: "Login successful",
      cookies: sessionCookies,
      redirectLocation: loginResponse.headers.location || null,
    };

    // Define TypeSeachDate categories for comprehensive room status report
    const searchTypes = [
      { name: "Phòng đến", typeSeachDate: 0, description: "Check-in today" },
      { name: "Phòng đi", typeSeachDate: 1, description: "Check-out today" },
      { name: "Phòng lưu", typeSeachDate: 3, description: "Currently staying" },
    ];

    let allBookings = [];
    let fetchSummary = {
      totalBookings: 0,
      totalPages: 0,
      totalPagesProcessed: 0,
      searchTypes: [],
    };

    // Fetch data for each TypeSeachDate
    for (const searchType of searchTypes) {
      console.log(
        `\n🔍 Fetching data for ${searchType.name} (TypeSeachDate=${searchType.typeSeachDate})...`,
      );

      let typeBookings = [];
      let currentPage = 1;
      let totalPages = 1;
      let fetchedPages = 0;

      do {
        console.log(`📄 ${searchType.name} - Fetching page ${currentPage}...`);

        // Update params for current search type and page
        const pageParams = {
          ...params,
          TypeSeachDate: searchType.typeSeachDate, // Key change: use TypeSeachDate instead of TypeSearchDate
          p: currentPage,
        };

        console.log(
          `🔗 Fetching ${searchType.name} page ${currentPage} with params:`,
          pageParams,
        );

        const queryString = new URLSearchParams(pageParams).toString();
        const reportUrl = `${reservationPath}?${queryString}`;

        const reportResponse = await axios.get(reportUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
            "Cache-Control": "no-cache",
            Referer: `${baseUrl}/`,
            Cookie: sessionCookies,
          },
          maxRedirects: 5,
        });

        const parsedData = parseBookingData(reportResponse.data);

        if (parsedData.success) {
          totalPages = parsedData.totalPages;

          // Add search type info to each booking
          const bookingsWithType = parsedData.bookings.map((booking) => ({
            ...booking,
            searchType: searchType.name,
            typeSeachDate: searchType.typeSeachDate,
          }));

          typeBookings = typeBookings.concat(bookingsWithType);
          fetchedPages++;

          console.log(
            `✅ ${searchType.name} - Page ${currentPage}/${totalPages} - Found ${parsedData.bookingsOnPage} bookings`,
          );

          // If only 1 page, break early
          if (totalPages === 1) {
            console.log(
              `📄 ${searchType.name} - Only 1 page of data available`,
            );
            break;
          }
        } else {
          console.log(
            `❌ ${searchType.name} - Failed to parse page ${currentPage}`,
          );
          break;
        }

        currentPage++;

        // Safety limit to prevent infinite loop
        if (fetchedPages >= 20) {
          console.log(
            `⚠️  ${searchType.name} - Reached safety limit of 20 pages`,
          );
          break;
        }

        // Small delay between requests
        if (currentPage <= totalPages) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } while (currentPage <= totalPages);

      // Add type summary to fetch summary
      fetchSummary.searchTypes.push({
        name: searchType.name,
        typeSeachDate: searchType.typeSeachDate,
        description: searchType.description,
        bookings: typeBookings.length,
        pages: fetchedPages,
        totalPages: totalPages,
      });

      console.log(
        `🎉 ${searchType.name} - Completed! ${typeBookings.length} bookings from ${fetchedPages} pages`,
      );

      // Add to all bookings
      allBookings = allBookings.concat(typeBookings);
      fetchSummary.totalBookings += typeBookings.length;
      fetchSummary.totalPages += totalPages;
      fetchSummary.totalPagesProcessed += fetchedPages;

      // Small delay between different search types
      if (searchTypes.indexOf(searchType) < searchTypes.length - 1) {
        console.log("⏳ Waiting before next search type...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.log(`\n🎊 COMPREHENSIVE FETCH COMPLETED!`);
    console.log(`📊 Total bookings: ${allBookings.length}`);
    console.log(
      `📑 Total pages processed: ${fetchSummary.totalPagesProcessed}/${fetchSummary.totalPages}`,
    );
    fetchSummary.searchTypes.forEach((type) => {
      console.log(
        `   ${type.name}: ${type.bookings} bookings (${type.pages}/${type.totalPages} pages)`,
      );
    });

    const reportResult = {
      success: true,
      totalBookings: allBookings.length,
      fetchSummary: fetchSummary,
      bookings: allBookings,
      timestamp: new Date().toISOString(),
      searchTypesUsed: searchTypes,
    };

    res.json({
      success: true,
      login: loginResult,
      report: reportResult,
      message: `Comprehensive fetch completed - ${allBookings.length} bookings from ${fetchSummary.totalPagesProcessed} pages across ${searchTypes.length} search types`,
    });
  } catch (error) {
    console.error("❌ Comprehensive fetch error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Combined login and fetch endpoint with facility support
app.post(
  "/api/login-and-fetch-facility",
  authenticateToken,
  checkFacilityAccess,
  async (req, res) => {
    try {
      const { facilityId, fromDate, toDate } = req.body;

      if (!facilityId || !facilities[facilityId]) {
        return res.status(400).json({
          success: false,
          error: "Invalid facility ID",
          availableFacilities: Object.keys(facilities),
        });
      }

      const facility = facilities[facilityId];
      console.log(
        `🏢 Starting comprehensive fetch for facility: ${facility.name}`,
      );

      let requestCookies;
      // Đã login lại một lần vì session bị OTA từ chối? (chống vòng lặp login)
      let retriedLogin = false;
      {
        const sess = await otaSession.ensureFacilityCookies(facility, loginAndResolveCookies);
        if (!sess.ok) return sendOtaSessionError(res, sess, facilityId, facility);
        requestCookies = sess.cookies;
        console.log(
          sess.fromCache
            ? `♻️  Dùng session đã lưu cho ${facility.name}`
            : `✅ Login successful for facility: ${facility.name}`,
        );
      }

      // Define search types
      const searchTypes = [
        { name: "Phòng đến", typeSeachDate: 0, description: "Check-in today" },
        { name: "Phòng đi", typeSeachDate: 1, description: "Check-out today" },
        {
          name: "Phòng lưu",
          typeSeachDate: 3,
          description: "Currently staying",
        },
      ];

      let allBookings = [];
      let fetchSummary = {
        facility: facility.name,
        facilityId: facilityId,
        totalBookings: 0,
        totalRoomTypes: facility.roomTypes.length,
        totalSearchTypes: searchTypes.length,
        roomTypeSummary: [],
      };

      // Fetch data for each room type and search type combination
      for (const roomType of facility.roomTypes) {
        console.log(`\n🏠 Processing RoomType: ${roomType}`);

        let roomTypeBookings = [];
        let roomTypeSummary = {
          roomType: roomType,
          totalBookings: 0,
          searchTypes: [],
        };

        for (const searchType of searchTypes) {
          console.log(`  🔍 ${searchType.name} for RoomType ${roomType}...`);

          let typeBookings = [];
          let currentPage = 1;
          let totalPages = 1;
          let fetchedPages = 0;

          do {
            const pageParams = {
              TypeSeachDate: searchType.typeSeachDate,
              FromDate: fromDate,
              ToDate: toDate,
              RoomType: roomType,
              RoomDetail: "",
              SourceType: "",
              Source: "",
              Status: "1,0,3,4,2",
              Seach: "",
              IsExtensionFilder: true,
              p: currentPage,
            };

            const queryString = new URLSearchParams(pageParams).toString();
            const reportUrl = `${reservationPath}?${queryString}`;

            const reportResponse = await axios.get(reportUrl, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
                Accept:
                  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
                "Cache-Control": "no-cache",
                Referer: `${baseUrl}/`,
                Cookie: requestCookies,
              },
              maxRedirects: 0,
              validateStatus: function (status) {
                return status >= 200 && status < 400;
              },
            });

            if (isRedirectToLogin(reportResponse)) {
              // Session (có thể lấy từ cache) đã chết: hủy cache, login lại
              // ĐÚNG MỘT LẦN rồi thử lại chính trang này.
              if (!retriedLogin) {
                retriedLogin = true;
                console.log("🔄 OTA session hết hạn, đăng nhập lại...");
                otaSession.invalidate(otaSession.accountKey(facility), requestCookies);
                const again = await otaSession.ensureFacilityCookies(
                  facility,
                  loginAndResolveCookies,
                );
                if (!again.ok) return sendOtaSessionError(res, again, facilityId, facility);
                requestCookies = again.cookies;
                continue; // thử lại cùng currentPage với cookie mới
              }
              return res.status(401).json({
                success: false,
                code: "OTA_SESSION_REJECTED",
                error:
                  "OTA session is not authenticated. Reservation request was redirected to login.",
                facility: {
                  id: facilityId,
                  name: facility.name,
                },
                reportUrl: reportUrl,
                redirectLocation: reportResponse.headers.location || null,
              });
            }

            const parsedData = parseBookingData(reportResponse.data);

            if (parsedData.success) {
              totalPages = parsedData.totalPages;

              const bookingsWithInfo = parsedData.bookings.map((booking) => ({
                ...booking,
                facilityId: facilityId,
                facilityName: facility.name,
                roomType: roomType,
                searchType: searchType.name,
                typeSeachDate: searchType.typeSeachDate,
              }));

              typeBookings = typeBookings.concat(bookingsWithInfo);
              fetchedPages++;

              console.log(
                `    ✅ Page ${currentPage}/${totalPages} - ${parsedData.bookingsOnPage} bookings`,
              );

              if (totalPages === 1) break;
            } else {
              console.log(`    ❌ Failed to parse page ${currentPage}`);
              break;
            }

            currentPage++;

            if (fetchedPages >= 20) {
              console.log(`    ⚠️ Reached safety limit of 20 pages`);
              break;
            }

            if (currentPage <= totalPages) {
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
          } while (currentPage <= totalPages);

          roomTypeSummary.searchTypes.push({
            name: searchType.name,
            typeSeachDate: searchType.typeSeachDate,
            bookings: typeBookings.length,
            pages: fetchedPages,
          });

          roomTypeBookings = roomTypeBookings.concat(typeBookings);
          console.log(
            `    🎉 ${searchType.name} completed: ${typeBookings.length} bookings`,
          );

          await new Promise((resolve) => setTimeout(resolve, 300));
        }

        roomTypeSummary.totalBookings = roomTypeBookings.length;
        fetchSummary.roomTypeSummary.push(roomTypeSummary);
        allBookings = allBookings.concat(roomTypeBookings);

        console.log(
          `🏠 RoomType ${roomType} completed: ${roomTypeBookings.length} total bookings`,
        );

        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      fetchSummary.totalBookings = allBookings.length;

      console.log(`\n🎊 FACILITY FETCH COMPLETED FOR ${facility.name}!`);
      console.log(`📊 Total bookings: ${allBookings.length}`);

      res.json({
        success: true,
        facility: {
          id: facilityId,
          name: facility.name,
          roomTypes: facility.roomTypes,
        },
        summary: fetchSummary,
        totalBookings: allBookings.length,
        bookings: allBookings,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("❌ Facility fetch error:", error.message);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },
);

// Simple health check endpoint for Docker
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Detailed health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    server: "OTA Report Server",
    timestamp: new Date().toISOString(),
    sessionCookies: sessionCookies ? "Available" : "None",
  });
});

// Reusable: login + fetch calendar + build room list for a facility
async function fetchRoomListForFacility(facility) {
  const calendarUrl = `${baseUrl}/app/calendar`;

  // withSession: dùng cookie đã lưu; nếu OTA redirect về /login thì hủy cache,
  // login lại đúng một lần và thử lại.
  const outcome = await otaSession.withSession(
    facility,
    loginAndResolveCookies,
    async (cookies) => {
      console.log("🌐 Fetching calendar page for room list...");
      return axios.get(calendarUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
          Cookie: cookies,
          "Cache-Control": "no-cache",
        },
        // Trước đây không đặt maxRedirects nên axios tự theo redirect về
        // /login, rồi extractCalendarOptionData parse trang login và báo
        // "Failed to extract calendar data" — sai nguyên nhân. Với session
        // cache thì lỗi này xảy ra thường xuyên hơn, nên phải chặn redirect.
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
      });
    },
    { isRejected: (resp) => isRedirectToLogin(resp) },
  );

  if (!outcome.ok) {
    return { success: false, error: outcome.error, code: outcome.code, sessionError: outcome };
  }

  const calendarResponse = outcome.result;
  if (calendarResponse.status !== 200) {
    return { success: false, error: `Calendar page request failed: ${calendarResponse.status}` };
  }

  console.log("✅ Calendar page loaded successfully");

  // Extract room data from calendar
  const calendarData = extractCalendarOptionData(calendarResponse.data);

  if (!calendarData.success) {
    return { success: false, error: "Failed to extract calendar data" };
  }

  // Filter rooms by facility room types
  const facilityRooms = calendarData.listRoom.filter((room) => {
    const roomTypeId =
      room.RoomTypeId || room.Group || room.TypeRoomId || room.Type;
    return facility.roomTypes.includes(roomTypeId);
  });

  // Transform room data to simple format for report generation
  const roomList = facilityRooms.map((room) => ({
    id: room.Id,
    name: room.Name,
    roomNumber: room.Number,
    roomTypeId:
      room.RoomTypeId || room.Group || room.TypeRoomId || room.Type,
    floor: room.Floor || null,
  }));

  console.log(`✅ Found ${roomList.length} rooms for facility ${facility.name}`);

  return { success: true, roomList };
}

// New API endpoint to get list of rooms for a facility
app.post(
  "/api/list-rooms",
  authenticateToken,
  checkFacilityAccess,
  async (req, res) => {
    try {
      const { facilityId } = req.body;

      if (!facilityId || !facilities[facilityId]) {
        return res.status(400).json({
          success: false,
          error: "Invalid facility ID",
          availableFacilities: Object.keys(facilities),
        });
      }

      const facility = facilities[facilityId];
      console.log(`🏠 Getting room list for facility: ${facility.name}`);

      const roomsOutcome = await fetchRoomListForFacility(facility);
      const { success: roomsOk, roomList, error: roomsErr } = roomsOutcome;
      if (!roomsOk) {
        if (roomsOutcome.sessionError) {
          return sendOtaSessionError(res, roomsOutcome.sessionError, facilityId, facility);
        }
        return res.status(401).json({
          success: false,
          error: roomsErr,
          facility: { id: facilityId, name: facility.name },
        });
      }

      // Save room count to user's facilities_count array in users.json
      try {
        const usersPath = path.join(__dirname, "config/users.json");
        const usersData = JSON.parse(fs.readFileSync(usersPath, "utf8"));
        const userIndex = usersData.users.findIndex((u) => u.id === req.user.id);
        if (userIndex !== -1) {
          const targetUser = usersData.users[userIndex];
          const facilityIndex = (targetUser.facilities || []).indexOf(facilityId);
          if (facilityIndex !== -1) {
            if (!Array.isArray(targetUser.facilities_count)) {
              targetUser.facilities_count = new Array(targetUser.facilities.length).fill(null);
            }
            targetUser.facilities_count[facilityIndex] = roomList.length;
            fs.writeFileSync(usersPath, JSON.stringify(usersData, null, 2), "utf8");
          }
        }
      } catch (saveErr) {
        console.error("⚠️ Failed to save room count:", saveErr.message);
      }

      res.json({
        success: true,
        facility: {
          id: facilityId,
          name: facility.name,
          roomTypes: facility.roomTypes,
        },
        totalRooms: roomList.length,
        rooms: roomList,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("❌ List rooms error:", error.message);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },
);

// Get cached room counts for the current user
app.get("/api/room-counts", authenticateToken, (req, res) => {
  const allUsers = loadUsers();
  const user = allUsers.find((u) => u.id === req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, error: "User not found" });
  }

  const userFacilities = user.facilities || [];
  const facilitiesCount = user.facilities_count || [];

  const facilityData = userFacilities.map((fid, idx) => ({
    facilityId: fid,
    name: facilities[fid]?.name || fid,
    roomCount: facilitiesCount[idx] ?? null,
  }));

  const totalRooms = facilityData.reduce((sum, f) => sum + (f.roomCount || 0), 0);

  res.json({
    success: true,
    totalRooms,
    facilities: facilityData,
  });
});

// Actively re-sync room counts for all of the current user's facilities.
// Clears facilities_count first so facilities removed from the user's access
// list don't leave stale counts behind, then re-fetches each remaining facility.
app.post("/api/sync-room-counts", authenticateToken, async (req, res) => {
  try {
    const usersPath = path.join(__dirname, "config/users.json");
    const usersData = JSON.parse(fs.readFileSync(usersPath, "utf8"));
    const userIndex = usersData.users.findIndex((u) => u.id === req.user.id);
    if (userIndex === -1) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const targetUser = usersData.users[userIndex];
    const userFacilities = targetUser.facilities || [];

    targetUser.facilities_count = new Array(userFacilities.length).fill(null);

    const results = [];
    for (let idx = 0; idx < userFacilities.length; idx++) {
      const facilityId = userFacilities[idx];
      const facility = facilities[facilityId];
      if (!facility) {
        results.push({ facilityId, success: false, error: "Facility not found" });
        continue;
      }

      const { success, roomList, error } = await fetchRoomListForFacility(facility);
      if (success) {
        targetUser.facilities_count[idx] = roomList.length;
        results.push({ facilityId, name: facility.name, success: true, roomCount: roomList.length });
      } else {
        results.push({ facilityId, name: facility.name, success: false, error });
      }
    }

    fs.writeFileSync(usersPath, JSON.stringify(usersData, null, 2), "utf8");

    const totalRooms = targetUser.facilities_count.reduce((sum, c) => sum + (c || 0), 0);

    res.json({
      success: true,
      totalRooms,
      facilities: results,
    });
  } catch (error) {
    console.error("❌ Sync room counts error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// New endpoint: Revenue report with date range
app.post(
  "/api/revenue-report",
  authenticateToken,
  checkFacilityAccess,
  async (req, res) => {
    try {
      const { facilityId, fromDate, toDate } = req.body;

      if (!facilityId || !facilities[facilityId]) {
        return res.status(400).json({
          success: false,
          error: "Invalid facility ID",
          availableFacilities: Object.keys(facilities),
        });
      }

      if (!fromDate || !toDate) {
        return res.status(400).json({
          success: false,
          error: "fromDate and toDate are required (format: DD/MM/YYYY)",
        });
      }

      const facility = facilities[facilityId];
      console.log(
        `💰 Generating revenue report for facility: ${facility.name} (${fromDate} - ${toDate})`,
      );

      // Session dùng lại từ cache, chỉ login khi cần
      let revenueCookies;
      let revenueRetried = false;
      {
        const sess = await otaSession.ensureFacilityCookies(facility, loginAndResolveCookies);
        if (!sess.ok) return sendOtaSessionError(res, sess, facilityId, facility);
        revenueCookies = sess.cookies;
      }

      // Fetch bookings for the date range with TypeSeachDate=0 (check-in/arrival)
      const searchTypes = [
        { name: "Phòng đến", typeSeachDate: 0, description: "Check-in" },
      ];

      let allBookings = [];

      for (const roomType of facility.roomTypes) {
        for (const searchType of searchTypes) {
          let currentPage = 1;
          let totalPages = 1;

          do {
            const pageParams = {
              TypeSeachDate: searchType.typeSeachDate,
              FromDate: fromDate,
              ToDate: toDate,
              RoomType: roomType,
              RoomDetail: "",
              SourceType: "",
              Source: "",
              Status: "1,0,3,4,2",
              Seach: "",
              IsExtensionFilder: true,
              p: currentPage,
            };

            console.log("pageParams", pageParams);

            const queryString = new URLSearchParams(pageParams).toString();
            const reportUrl = `${reservationPath}?${queryString}`;

            const reportResponse = await axios.get(reportUrl, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
                Accept:
                  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
                "Cache-Control": "no-cache",
                Referer: `${baseUrl}/`,
                Cookie: revenueCookies,
              },
              // BUG cũ: maxRedirects: 5 khiến session chết bị axios tự follow
              // về trang /login, rồi parseBookingData parse trang login và trả
              // về BÁO CÁO DOANH THU 0 BOOKING với success: true. Trước đây bị
              // che vì mọi request đều login mới; có session cache thì nó xảy
              // ra thật. Phải chặn redirect và xử lý tường minh.
              maxRedirects: 0,
              validateStatus: (s) => s >= 200 && s < 400,
            });

            if (isRedirectToLogin(reportResponse)) {
              if (!revenueRetried) {
                revenueRetried = true;
                console.log("🔄 OTA session hết hạn, đăng nhập lại...");
                otaSession.invalidate(otaSession.accountKey(facility), revenueCookies);
                const again = await otaSession.ensureFacilityCookies(
                  facility,
                  loginAndResolveCookies,
                );
                if (!again.ok) return sendOtaSessionError(res, again, facilityId, facility);
                revenueCookies = again.cookies;
                continue; // thử lại cùng trang với cookie mới
              }
              return res.status(401).json({
                success: false,
                code: "OTA_SESSION_REJECTED",
                error:
                  "OTA session is not authenticated. Revenue request was redirected to login.",
                facility: { id: facilityId, name: facility.name },
              });
            }

            const parsedData = parseBookingData(reportResponse.data);

            if (parsedData.success) {
              totalPages = parsedData.totalPages;

              // Add bookings with metadata
              const bookingsWithMeta = parsedData.bookings.map((booking) => ({
                ...booking,
                typeSeachDate: searchType.typeSeachDate,
                searchType: searchType.name,
                roomType: roomType,
              }));

              allBookings = allBookings.concat(bookingsWithMeta);

              console.log(
                `  📄 Page ${currentPage}/${totalPages}: ${parsedData.bookings.length} bookings`,
              );
            }

            currentPage++;
          } while (currentPage <= totalPages);
        }
      }

      console.log(`✅ Total bookings fetched: ${allBookings.length}`);

      // Sort bookings by check-in date
      allBookings.sort((a, b) => {
        const dateA = dayjs(a.checkinDate, "DD/MM/YYYY");
        const dateB = dayjs(b.checkinDate, "DD/MM/YYYY");
        return dateA.diff(dateB);
      });

      console.log(`✅ Bookings sorted by check-in date`);

      // Group bookings by OTA source
      const revenueByOTA = {};
      let totalRevenue = 0;

      allBookings.forEach((booking) => {
        const source = booking.source || "Khách lẻ";
        const totalAmount = parseFloat(
          booking.totalAmount.replace(/[^\d.-]/g, "") || 0,
        );

        if (!revenueByOTA[source]) {
          revenueByOTA[source] = {
            source: source,
            totalBookings: 0,
            totalRevenue: 0,
            bookings: [],
          };
        }

        revenueByOTA[source].totalBookings++;
        revenueByOTA[source].totalRevenue += totalAmount;
        revenueByOTA[source].bookings.push(booking);
        totalRevenue += totalAmount;
      });

      res.json({
        success: true,
        facility: {
          id: facilityId,
          name: facility.name,
        },
        dateRange: {
          from: fromDate,
          to: toDate,
        },
        summary: {
          totalBookings: allBookings.length,
          totalRevenue: totalRevenue,
        },
        revenueByOTA: Object.values(revenueByOTA),
        bookings: allBookings,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("❌ Revenue report error:", error.message);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },
);

// Helper function to parse booking data from HTML
function parseBookingData(html) {
  try {
    console.log("🔍 Parsing HTML data length:", html.length);

    // Find pagination info using DataTables paginate element
    let currentPage = 1;
    let totalPages = 1;

    // Try to match the DataTables pagination block
    const paginateBlockMatch = html.match(
      /<div[^>]*class="[^"]*dataTables_paginate[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    );
    if (paginateBlockMatch) {
      const paginateHtml = paginateBlockMatch[1];

      // Find all page number links
      const pageNumberMatches = [
        ...paginateHtml.matchAll(
          /<a[^>]*class="[^"]*paginate_button(?!.*current)[^"]*"[^>]*href="[^"]*p=(\d+)[^"]*"[^>]*>(\d+)<\/a>/gi,
        ),
      ];
      const currentPageMatch = paginateHtml.match(
        /<a[^>]*class="[^"]*paginate_button current[^"]*"[^>]*href="[^"]*p=(\d+)[^"]*"[^>]*>(\d+)<\/a>/i,
      );

      // Get all page numbers
      let pageNumbers = pageNumberMatches.map((m) => parseInt(m[2]));
      if (currentPageMatch) {
        currentPage = parseInt(currentPageMatch[2]);
        pageNumbers.push(currentPage);
      }
      if (pageNumbers.length > 0) {
        totalPages = Math.max(...pageNumbers);
      }
      console.log(
        "📄 Pagination found (DataTables):",
        currentPage,
        "/",
        totalPages,
      );
    } else {
      // Fallback: Try to match old pagination text
      const paginationMatch = html.match(
        /Trang\s+(\d+)\s+\/\s+(\d+)|Page\s+(\d+)\s+of\s+(\d+)/i,
      );
      if (paginationMatch) {
        currentPage = parseInt(paginationMatch[1] || paginationMatch[3]) || 1;
        totalPages = parseInt(paginationMatch[2] || paginationMatch[4]) || 1;
        console.log(
          "📄 Pagination found (text):",
          currentPage,
          "/",
          totalPages,
        );
      }
    }

    // Find the main booking table
    const bookingTableMatch = html.match(
      /<table[^>]*class="[^"]*card-table[^"]*"[^>]*>([\s\S]*?)<\/table>/i,
    );

    if (!bookingTableMatch) {
      console.log("❌ No booking table found in HTML");
      // Try alternative table pattern
      const altTableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
      if (altTableMatch) {
        console.log("✅ Found alternative table");
      } else {
        console.log("❌ No table found at all");
      }
    } else {
      console.log("✅ Booking table found");
    }

    let bookings = [];

    if (bookingTableMatch) {
      const tableContent = bookingTableMatch[1];

      // Extract table rows (skip header)
      const rowMatches =
        tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
      console.log("🔍 Found", rowMatches.length, "table rows");

      for (let i = 1; i < rowMatches.length; i++) {
        // Skip header row
        const row = rowMatches[i];
        const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];

        console.log(`Row ${i}: ${cells.length} cells`);

        if (cells.length >= 15) {
          // Ensure we have enough columns
          const booking = {
            bookingCode: extractTextFromCell(cells[0]),
            otaReference: extractTextFromCell(cells[1]),
            guestName: extractTextFromCell(cells[2]),
            property: extractTextFromCell(cells[3]),
            room: extractTextFromCell(cells[4]),
            source: extractTextFromCell(cells[5]),
            status: extractTextFromCell(cells[6]),
            bookingDate: extractTextFromCell(cells[7]),
            checkinDate: extractTextFromCell(cells[8]),
            checkinTime: extractTextFromCell(cells[9]),
            checkoutDate: extractTextFromCell(cells[10]),
            checkoutTime: extractTextFromCell(cells[11]),
            totalAmount: extractTextFromCell(cells[15]),
            paid: extractTextFromCell(cells[13]),
            balance: extractTextFromCell(cells[15]),
            notes: cells.length > 19 ? extractNoteFromCell(cells[19]) : "",
          };

          // Expedia: giá ở cột totalAmount là giá gộp OTA, giá net thực nhận
          // nằm trong "Collect Amount" của ghi chú phòng (cell 19)
          if (booking.source === "Expedia") {
            const collectAmount = extractExpediaCollectAmount(booking.notes);
            if (collectAmount) {
              booking.totalAmount = collectAmount;
              booking.balance = collectAmount;
            }
          }

          // Clean up the data
          booking.totalAmount = booking.totalAmount
            .replace(/[^\d,.-]/g, "")
            .trim();
          booking.paid = booking.paid.replace(/[^\d,.-]/g, "").trim();
          booking.balance = booking.balance.replace(/[^\d,.-]/g, "").trim();

          bookings.push(booking);
        } else {
          console.log(`Row ${i}: Only ${cells.length} cells, skipping`);
        }
      }
    }

    console.log("✅ Parsed", bookings.length, "bookings");

    return {
      success: true,
      status: 200,
      currentPage: currentPage,
      totalPages: totalPages,
      bookingsOnPage: bookings.length,
      bookings: bookings,
      dataLength: html.length,
      hasMorePages: currentPage < totalPages,
    };
  } catch (error) {
    console.error("❌ Parse error:", error.message);
    return {
      success: false,
      error: error.message,
      currentPage: 1,
      totalPages: 1,
      bookings: [],
    };
  }
}

// Helper function to extract clean text from table cell
function extractTextFromCell(cellHtml) {
  if (!cellHtml) return "";

  // Remove HTML tags and get text content
  let text = cellHtml.replace(/<[^>]*>/g, "").trim();

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));

  return text.trim();
}

// Helper function to extract room note text from the ShowNotes(...) onclick
// attribute of a table cell (the note text lives in the attribute, not in the
// cell's inner text, so extractTextFromCell can't be reused here)
function extractNoteFromCell(cellHtml) {
  if (!cellHtml) return "";

  const onclickMatch = cellHtml.match(
    /onclick="ShowNotes\('([\s\S]*?)'\);?"/i,
  );
  if (!onclickMatch) return "";

  let text = onclickMatch[1];

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));

  // Strip inner HTML tags (<b>, <br/>, ...) left over from the decoded note
  text = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  return text;
}

// Helper function to extract the Expedia net amount ("Collect Amount")
// from a decoded room note string
function extractExpediaCollectAmount(noteText) {
  if (!noteText) return "";

  const match = noteText.match(/Collect Amount:\s*[₫đ]?\s*([\d.,]+)/i);
  return match ? match[1]?.replace(/,/g, ".") : "";
}

// Helper function to extract CalendarOption data from HTML
function extractCalendarOptionData(html) {
  try {
    const listRoomMatch = html.match(
      /CalendarOption\.ListRoom\s*=\s*(\[[\s\S]*?\]);/,
    );
    const bookingGroupMatch = html.match(
      /CalendarOption\.BookingGroup\s*=\s*(\[[\s\S]*?\]);/,
    );

    let listRoom = [];
    let bookingGroup = [];

    if (listRoomMatch && listRoomMatch[1]) {
      try {
        listRoom = JSON.parse(listRoomMatch[1]);
        console.log("✅ Extracted ListRoom data:", listRoom.length, "rooms");
      } catch (e) {
        console.warn("⚠️ Failed to parse ListRoom:", e.message);
      }
    }

    if (bookingGroupMatch && bookingGroupMatch[1]) {
      try {
        bookingGroup = JSON.parse(bookingGroupMatch[1]);
        console.log(
          "✅ Extracted BookingGroup data:",
          bookingGroup.length,
          "bookings",
        );
      } catch (e) {
        console.warn("⚠️ Failed to parse BookingGroup:", e.message);
      }
    }

    return {
      success: true,
      listRoom: listRoom,
      bookingGroup: bookingGroup,
    };
  } catch (error) {
    console.error("❌ Calendar data extraction error:", error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

// ===== DLD (DAYLADAU) INTEGRATION ENDPOINTS =====
const dld = require("./services/dld");

// GET /api/dld/config — return current user's DLD config (no secrets exposed)
app.get("/api/dld/config", authenticateToken, (req, res) => {
  const cfg = getUserOtaConfig(req.user.id, "dld") || {};
  res.json({
    success: true,
    host_id:          cfg.host_id          || "",
    email_or_phone:   cfg.email_or_phone   || "",
    has_password:     !!(cfg.password),
    has_token:        !!(cfg.access_token),
    token_expires_at: cfg.token_expires_at || null,
  });
});

// PUT /api/dld/config — update current user's DLD credentials
app.put("/api/dld/config", authenticateToken, (req, res) => {
  const { host_id, email_or_phone, password } = req.body;
  const cfg = getUserOtaConfig(req.user.id, "dld") || {};
  if (host_id        !== undefined) cfg.host_id        = host_id;
  if (email_or_phone !== undefined) cfg.email_or_phone = email_or_phone;
  if (password       !== undefined) {
    cfg.password         = password;
    cfg.access_token     = "";
    cfg.token_expires_at = null;
  }
  saveUserOtaConfig(req.user.id, "dld", cfg);
  res.json({ success: true });
});

// POST /api/dld/test-login — test credentials, cache new token for current user
app.post("/api/dld/test-login", authenticateToken, async (req, res) => {
  const cfg = getUserOtaConfig(req.user.id, "dld") || {};
  if (!cfg.email_or_phone || !cfg.password) {
    return res.status(400).json({ success: false, error: "Credentials not configured" });
  }
  try {
    const { token, expiresAt } = await dld.login(cfg.email_or_phone, cfg.password);
    cfg.access_token     = token;
    cfg.token_expires_at = expiresAt;
    saveUserOtaConfig(req.user.id, "dld", cfg);
    res.json({ success: true, token_expires_at: expiresAt });
  } catch (e) {
    console.error("❌ DLD test-login error:", e.message);
    res.status(401).json({ success: false, error: e.message });
  }
});


// ===== END DLD ENDPOINTS =====

// ===== GO2JOY (G2J) INTEGRATION ENDPOINTS =====
const g2j = require("./services/g2j");

// GET /api/g2j/config
app.get("/api/g2j/config", authenticateToken, (req, res) => {
  const cfg = getUserOtaConfig(req.user.id, "go2joy") || {};
  res.json({
    success: true,
    user_id:          cfg.user_id          || "",
    has_password:     !!(cfg.password),
    has_token:        !!(cfg.access_token),
    token_expires_at: cfg.token_expires_at || null,
    hotel_sns:        cfg.hotel_sns        || [],
  });
});

// PUT /api/g2j/config
app.put("/api/g2j/config", authenticateToken, (req, res) => {
  const { user_id, password, hotel_sns } = req.body;
  const cfg = getUserOtaConfig(req.user.id, "go2joy") || {};
  if (user_id    !== undefined) cfg.user_id    = user_id;
  if (hotel_sns  !== undefined) cfg.hotel_sns  = hotel_sns; // number[]
  if (password   !== undefined) {
    cfg.password         = password;
    cfg.access_token     = "";
    cfg.token_expires_at = null;
  }
  saveUserOtaConfig(req.user.id, "go2joy", cfg);
  res.json({ success: true });
});

// POST /api/g2j/test-login
app.post("/api/g2j/test-login", authenticateToken, async (req, res) => {
  const cfg = getUserOtaConfig(req.user.id, "go2joy") || {};
  if (!cfg.user_id || !cfg.password) {
    return res.status(400).json({ success: false, error: "Credentials not configured" });
  }
  try {
    const { token, expiresAt } = await g2j.login(cfg.user_id, cfg.password);
    cfg.access_token     = token;
    cfg.token_expires_at = expiresAt;
    saveUserOtaConfig(req.user.id, "go2joy", cfg);
    res.json({ success: true, token_expires_at: expiresAt });
  } catch (e) {
    console.error("❌ G2J test-login error:", e.message);
    res.status(401).json({ success: false, error: e.message });
  }
});

// ===== END G2J ENDPOINTS =====

// Start server
app.listen(PORT, HOST, () => {
  console.log("🚀 OTA Report Server started successfully!");
  console.log(`📡 Server running at: http://${HOST}:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log("📋 Available endpoints:");
  console.log("   GET  /api/health                    - Health check");
  console.log("   POST /api/login                     - Login to OTA system");
  console.log("   GET  /api/report                    - Fetch report data");
  console.log(
    "   POST /api/login-and-fetch           - Combined login + fetch",
  );
  console.log(
    "   POST /api/login-and-fetch-facility  - Login + fetch by facility",
  );
  console.log(
    "   GET  /api/facilities                - Get facility information",
  );
  console.log(
    "   POST /api/list-rooms                - Get room list by facility (auto-saves room count)",
  );
  console.log(
    "   GET  /api/room-counts               - Get cached room counts per facility for current user",
  );
  console.log(
    "   POST /api/sync-room-counts          - Actively re-sync room counts for all of the user's facilities",
  );
  console.log("");
  console.log("💡 Usage examples:");
  console.log("   curl -X POST http://localhost:3001/api/login");
  console.log("   curl http://localhost:3001/api/report");
  console.log("   curl -X POST http://localhost:3001/api/login-and-fetch");
  console.log(
    "   curl -X POST http://localhost:3001/api/login-and-fetch-facility",
  );
  console.log("   curl http://localhost:3001/api/facilities");
  console.log(
    '   curl -X POST -H "Content-Type: application/json" -d \'{"facilityId":"era_apartment_3"}\' http://localhost:3001/api/list-rooms',
  );
});

// Helper functions (keep only these, remove all duplicated functions)

function getCurrentDateString() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `${day}/${month}/${year}`;
}

module.exports = app;

// Helper function to format date

function getCurrentDateString() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `${day}/${month}/${year}`;
}

module.exports = app;
