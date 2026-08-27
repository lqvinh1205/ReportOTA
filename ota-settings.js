const API = "";

function getToken() { return localStorage.getItem("authToken"); }
function redirectLogin() { window.location.href = "login.html"; }

async function authedFetch(url, opts = {}) {
  const t = getToken();
  if (!t) { redirectLogin(); throw new Error("no token"); }
  const r = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}`, ...(opts.headers || {}) },
  });
  if (r.status === 401 || r.status === 403) { redirectLogin(); throw new Error("auth"); }
  return r;
}

async function init() {
  if (!getToken()) { redirectLogin(); return; }
  try {
    const r = await authedFetch(`${API}/api/auth/verify`);
    const d = await r.json();
    if (!d.success) { redirectLogin(); return; }
    document.getElementById("pageUser").textContent = `👤 ${d.user?.name || d.user?.username}`;
  } catch (_) { redirectLogin(); return; }

  await loadDldConfig();
  await loadG2jConfig();
}

// ─── DLD ─────────────────────────────────────────────────────────────────────

async function loadDldConfig() {
  try {
    const r = await authedFetch(`${API}/api/dld/config`);
    const d = await r.json();
    if (!d.success) return;
    document.getElementById("dldHostId").value = d.host_id || "";
    document.getElementById("dldEmail").value  = d.email_or_phone || "";
    renderTokenBox("dldTokenBox", d);
  } catch (_) {}
}

async function saveDld() {
  const host_id        = document.getElementById("dldHostId").value.trim();
  const email_or_phone = document.getElementById("dldEmail").value.trim();
  const password       = document.getElementById("dldPassword").value;
  if (!host_id) { setStatus("Vui lòng nhập DLD Host ID", "error"); return; }
  try {
    const r = await authedFetch(`${API}/api/dld/config`, {
      method: "PUT",
      body: JSON.stringify({ host_id, ...(email_or_phone ? { email_or_phone } : {}), ...(password ? { password } : {}) }),
    });
    const d = await r.json();
    if (d.success) {
      document.getElementById("dldPassword").value = "";
      setStatus("✅ Đã lưu DLD credentials");
      await loadDldConfig();
    } else { setStatus(d.error || "Lỗi", "error"); }
  } catch (e) { setStatus(e.message, "error"); }
}

async function testDld() {
  const btn = document.getElementById("dldTestBtn");
  btn.disabled = true; btn.textContent = "⏳…";
  try {
    const r = await authedFetch(`${API}/api/dld/test-login`, { method: "POST" });
    const d = await r.json();
    if (d.success) {
      setStatus(`✅ DLD Login OK — hết hạn ${new Date(d.token_expires_at).toLocaleString("vi-VN")}`);
      await loadDldConfig();
    } else { setStatus(`❌ DLD: ${d.error}`, "error"); }
  } catch (e) { setStatus(e.message, "error"); }
  finally { btn.disabled = false; btn.textContent = "🔑 Test Login"; }
}

// ─── Go2Joy ───────────────────────────────────────────────────────────────────

async function loadG2jConfig() {
  try {
    const r = await authedFetch(`${API}/api/g2j/config`);
    const d = await r.json();
    if (!d.success) return;
    document.getElementById("g2jUserId").value    = d.user_id || "";
    document.getElementById("g2jHotelSns").value  = (d.hotel_sns || []).join(", ");
    renderTokenBox("g2jTokenBox", d);
  } catch (_) {}
}

async function saveG2j() {
  const user_id  = document.getElementById("g2jUserId").value.trim();
  const password = document.getElementById("g2jPassword").value;
  const snsRaw   = document.getElementById("g2jHotelSns").value.trim();
  const hotel_sns = snsRaw ? snsRaw.split(",").map((s) => Number(s.trim())).filter(Boolean) : [];
  if (!user_id) { setStatus("Vui lòng nhập G2J User ID", "error"); return; }
  try {
    const r = await authedFetch(`${API}/api/g2j/config`, {
      method: "PUT",
      body: JSON.stringify({ user_id, hotel_sns, ...(password ? { password } : {}) }),
    });
    const d = await r.json();
    if (d.success) {
      document.getElementById("g2jPassword").value = "";
      setStatus("✅ Đã lưu Go2Joy credentials");
      await loadG2jConfig();
    } else { setStatus(d.error || "Lỗi", "error"); }
  } catch (e) { setStatus(e.message, "error"); }
}

async function testG2j() {
  const btn = document.getElementById("g2jTestBtn");
  btn.disabled = true; btn.textContent = "⏳…";
  try {
    const r = await authedFetch(`${API}/api/g2j/test-login`, { method: "POST" });
    const d = await r.json();
    if (d.success) {
      setStatus(`✅ Go2Joy Login OK — hết hạn ${new Date(d.token_expires_at).toLocaleString("vi-VN")}`);
      await loadG2jConfig();
    } else { setStatus(`❌ Go2Joy: ${d.error}`, "error"); }
  } catch (e) { setStatus(e.message, "error"); }
  finally { btn.disabled = false; btn.textContent = "🔑 Test Login"; }
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function renderTokenBox(boxId, cfg) {
  const el = document.getElementById(boxId);
  if (!el) return;
  el.style.display = "block";
  if (!cfg.has_password) {
    el.className = "token-box token-none";
    el.textContent = "Chưa cấu hình mật khẩu";
    return;
  }
  if (cfg.has_token && cfg.token_expires_at) {
    const exp = new Date(cfg.token_expires_at);
    const ok  = exp.getTime() - Date.now() > 5 * 60 * 1000;
    el.className = `token-box ${ok ? "token-ok" : "token-warn"}`;
    el.textContent = ok
      ? `🟢 Token còn hiệu lực đến ${exp.toLocaleString("vi-VN")}`
      : `🟡 Token hết hạn — tự login lại khi cần`;
  } else {
    el.className = "token-box token-none";
    el.textContent = "🔵 Chưa có token — sẽ tự login lần đầu";
  }
}

function setStatus(msg, level = "") {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = level;
}
