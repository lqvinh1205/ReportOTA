/**
 * services/g2j.js
 * Pure Go2Joy (ha.go2joy.vn) API helpers — no file I/O.
 * Caller is responsible for loading/saving cfg (from users.json ota_configs.go2joy).
 *
 * cfg shape:
 *   user_id, password, access_token, token_expires_at (ISO string),
 *   hotel_sns: number[]   ← hotelSn values this user owns (for filtering)
 */

const axios = require("axios");

const G2J_API_BASE  = "https://api-ha.go2joy.vn/api/v1/web/ha";
const G2J_LOGIN_URL = `${G2J_API_BASE}/sign-in`;
const G2J_SITE_URL  = "https://ha.go2joy.vn/";
const TOKEN_BUFFER_MS      = 5 * 60 * 1000;
const TOKEN_DEFAULT_TTL_MS = 23 * 60 * 60 * 1000;
const VERSION_MISMATCH_CODE = "API_GNR_009";

// Frontend version — injected by Go2Joy SPA into all axios requests.
// Seed value only; auto-corrected at runtime by discoverVersion() whenever
// the API rejects a request with API_GNR_009 (version mismatch), so this
// never needs to be hand-updated when Go2Joy ships a new SPA build.
let currentVersion = "21.3.0";

const BASE_HEADERS = {
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
  "Country-Code": "VN",
  Localization: "vi",
  Origin: "https://ha.go2joy.vn",
  Referer: "https://ha.go2joy.vn/",
  Requester: "ha",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  "sec-ch-ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Linux"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
};

function headers() {
  return { ...BASE_HEADERS, Version: currentVersion };
}

// Scrape the live frontend version straight from ha.go2joy.vn's HTML
// (`<html version="X.Y.Z">`), so calls self-heal after a Go2Joy SPA deploy.
async function discoverVersion() {
  const resp = await axios.get(G2J_SITE_URL, { validateStatus: () => true });
  const match = String(resp.data || "").match(/version="([0-9]+\.[0-9]+\.[0-9]+)"/);
  if (!match) throw new Error("G2J: could not discover current app version from ha.go2joy.vn");
  currentVersion = match[1];
  return currentVersion;
}

// Run an axios call; on API_GNR_009 (version mismatch), re-discover the live
// version once and retry the same call before giving up.
async function withVersionRetry(makeRequest, log = console.log) {
  let resp = await makeRequest();
  if (resp.data?.code === VERSION_MISMATCH_CODE) {
    log(`[G2J] Version "${currentVersion}" không khớp — dò lại version mới…`);
    await discoverVersion();
    log(`[G2J] Version mới: ${currentVersion} — thử lại request…`);
    resp = await makeRequest();
  }
  return resp;
}

// POST /sign-in → { token, expiresAt (ISO string) }
async function login(userId, password, log = console.log) {
  const resp = await withVersionRetry(() => axios.post(
    G2J_LOGIN_URL,
    { userId, password, remember: 0 },
    {
      headers: { ...headers(), "Content-Type": "application/json" },
      validateStatus: () => true, // don't throw on 4xx/5xx
    }
  ), log);
  const data = resp.data || {};
  if (resp.status !== 200 || data.code !== 1 || !data.data?.accessToken) {
    throw new Error(`G2J login failed (HTTP ${resp.status}): ${data.message || JSON.stringify(data)}`);
  }
  const raw = data.data;
  // expiresAt từ Go2Joy là Unix seconds (không phải ms)
  const expiresAt = raw.expiresAt
    ? new Date(raw.expiresAt * 1000).toISOString()
    : new Date(Date.now() + TOKEN_DEFAULT_TTL_MS).toISOString();
  return { token: raw.accessToken, expiresAt };
}

// Return valid token; auto-login if missing or near expiry. Mutates cfg — caller must save.
async function getToken(cfg, log = console.log) {
  if (cfg.access_token && cfg.token_expires_at) {
    if (Date.now() < new Date(cfg.token_expires_at).getTime() - TOKEN_BUFFER_MS) {
      return cfg.access_token;
    }
  } else {
  }
  if (!cfg.user_id || !cfg.password) {
    throw new Error("G2J credentials not configured (user_id / password missing)");
  }
  const { token, expiresAt } = await login(cfg.user_id, cfg.password, log);
  cfg.access_token     = token;
  cfg.token_expires_at = expiresAt;
  log(`[G2J] Logged in, token valid until ${expiresAt}`);
  return token;
}

// Fetch one page of bookings. bookingStatus=3 = confirmed/paid.
async function fetchBookingsPage(token, date, page = 1, hotelSn = "", log = console.log) {
  const url = `${G2J_API_BASE}/user-bookings`;
  const resp = await withVersionRetry(() => axios.get(url, {
    headers: { ...headers(), Authorization: `Bearer ${token}` },
    validateStatus: () => true,
    params: {
      hotelSn,
      bookingStatus: 3,
      keyword: "",
      limit: 100,
      page,
      startDate: date,
      endDate: date,
      bookingType: "",
      sortByColumn: "",
      sortByValue: "",
    },
  }), log);
  const data = resp.data || {};
  if (resp.status !== 200 || data.code !== 1) {
    throw new Error(`G2J bookings error (HTTP ${resp.status}): ${data.message || JSON.stringify(data)}`);
  }
  const inner = data.data || {};
  const items = inner.bookingList || [];
  const total = inner.meta?.total ?? items.length;
  return { items, total };
}

// Fetch ALL bookings for the given date, filtered by cfg.hotel_sns
async function fetchBookingsAll(token, date, hotelSns = [], log = console.log) {
  const all = [];

  if (hotelSns.length === 0) {
    // Fetch without hotel filter — returns all hotels in the group
    let page = 1;
    while (true) {
      const { items, total } = await fetchBookingsPage(token, date, page, "", log);
      all.push(...items);
      if (all.length >= total || items.length === 0) break;
      page++;
      await new Promise((r) => setTimeout(r, 200));
    }
  } else {
    // Fetch per-hotel to avoid needing to filter large result sets
    for (const sn of hotelSns) {
      let page = 1;
      while (true) {
        const { items, total } = await fetchBookingsPage(token, date, page, sn, log);
        all.push(...items);
        if (all.length >= total || items.length === 0) break;
        page++;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  return all;
}

module.exports = { login, getToken, fetchBookingsAll, HEADERS: BASE_HEADERS };
