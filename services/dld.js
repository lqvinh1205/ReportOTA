/**
 * services/dld.js
 * Pure DLD API helpers — no file I/O.
 * Caller is responsible for loading/saving the cfg object (from users.json ota_configs.dld).
 */

const axios = require("axios");

const DLD_API_BASE   = "https://api.dayladau.com/v1";
const DLD_LOGIN_URL  = "https://api.dayladau.com/login";
const TOKEN_BUFFER_MS      = 5 * 60 * 1000;
const TOKEN_DEFAULT_TTL_MS = 23 * 60 * 60 * 1000;

const HEADERS = {
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9,vi;q=0.8",
  "content-type": "text/plain",
  origin: "https://host.dayladau.com",
  referer: "https://host.dayladau.com/",
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
};

// Call DLD login, return { token, expiresAt }
async function login(emailOrPhone, password) {
  const resp = await axios.post(
    DLD_LOGIN_URL,
    JSON.stringify({ email_or_phone: emailOrPhone, password }),
    { headers: HEADERS }
  );
  const data  = resp.data;
  const token =
    data.token || data.access_token || data.x_access_token ||
    data.data?.token || data.data?.access_token;
  if (!token) throw new Error(`DLD login failed: no token (HTTP ${resp.status})`);

  const expiresAt =
    data.expires_at || data.expire_at ||
    (data.expires_in
      ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
      : new Date(Date.now() + TOKEN_DEFAULT_TTL_MS).toISOString());
  return { token, expiresAt };
}

/**
 * Return a valid token. Mutates cfg.access_token / cfg.token_expires_at when
 * a new token is obtained — caller must persist cfg afterwards.
 *
 * @param {object}   cfg - user's ota_configs.dld object (mutable)
 * @param {Function} log - optional logger
 * @returns {string} access token
 */
async function getToken(cfg, log = console.log) {
  if (cfg.access_token && cfg.token_expires_at) {
    if (Date.now() < new Date(cfg.token_expires_at).getTime() - TOKEN_BUFFER_MS) {
      return cfg.access_token;
    }
  } else {
  }
  if (!cfg.email_or_phone || !cfg.password) {
    throw new Error("DLD credentials not configured (email_or_phone / password missing)");
  }
  const { token, expiresAt } = await login(cfg.email_or_phone, cfg.password);
  cfg.access_token    = token;
  cfg.token_expires_at = expiresAt;
  // Caller saves cfg
  log(`[DLD] Logged in, token valid until ${expiresAt}`);
  return token;
}


async function fetchOrdersAll(hostId, token, startTs, endTs) {
  const all = [];
  const limit = 100;
  let offset = 0;
  while (true) {
    const url = `${DLD_API_BASE}/hosts/${hostId}/orders?offset=${offset}&limit=${limit}&start_checkin=${startTs}&end_checkin=${endTs}&x_access_token=${token}`;
    const resp = await axios.get(url, { headers: HEADERS });
    const data = resp.data;
    const items = Array.isArray(data) ? data : (data.data || data.orders || data.items || []);
    if (!items || items.length === 0) break;
    all.push(...items);
    if (items.length < limit) break;
    offset += limit;
    await new Promise((r) => setTimeout(r, 200));
  }
  return all;
}

module.exports = { login, getToken, fetchOrdersAll, HEADERS };
