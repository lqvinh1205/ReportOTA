// ===== CORE BOOKING DATA FETCHING LOGIC =====

// Node.js server endpoints - Auto detect based on current location
const API_BASE_URL = window.location.protocol + "//" + window.location.host;

// ===== AUTHENTICATION =====

// Get auth token from localStorage
function getAuthToken() {
  return localStorage.getItem('authToken');
}

// Get current user
function getCurrentUser() {
  const userStr = localStorage.getItem('user');
  return userStr ? JSON.parse(userStr) : null;
}

// Logout function
function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('user');
  window.location.href = 'login.html';
}

// Check authentication on page load
function checkAuth() {
  const token = getAuthToken();
  if (!token) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

// Verify token with server
async function verifyAuth() {
  const token = getAuthToken();
  if (!token) {
    window.location.href = 'login.html';
    return false;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/verify`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      logout();
      return false;
    }

    const result = await response.json();
    if (result.success) {
      // Update user data
      localStorage.setItem('user', JSON.stringify(result.user));
      return true;
    } else {
      logout();
      return false;
    }
  } catch (error) {
    console.error('Auth verification error:', error);
    return false;
  }
}

// Helper to make authenticated API calls
async function fetchWithAuth(url, options = {}) {
  const token = getAuthToken();
  if (!token) {
    logout();
    throw new Error('No authentication token');
  }

  const authOptions = {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  const response = await fetch(url, authOptions);
  
  if (response.status === 401 || response.status === 403) {
    logout();
    throw new Error('Authentication failed');
  }

  return response;
}

// ===== MAIN FETCH FUNCTIONS =====

// Fetch single page via Node.js server
async function fetchReportViaServer() {
  const facilityId = document.getElementById("facilitySelect").value;

  if (!facilityId) {
    updateApiStatus("error", "Vui lòng chọn cơ sở trước khi fetch dữ liệu");
    return;
  }

  showLoading("Đang lấy dữ liệu booking...");
  updateApiStatus("pending", "Đang gọi server...");

  try {
    console.log("🚀 Calling Node.js server for login and fetch...");

    const response = await fetchWithAuth(
      `${API_BASE_URL}/api/login-and-fetch-facility`,
      {
        method: "POST",
        body: JSON.stringify({
          facilityId: facilityId,
          fromDate: dayjs().format("YYYY-MM-DD"),
          toDate: dayjs().format("YYYY-MM-DD"),
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const result = await response.json();

    if (result.success) {
      console.log("✅ Server response successful");

      if (result.bookings && result.bookings.length > 0) {
        window.lastBookingData = {
          success: true,
          totalBookings: result.totalBookings,
          bookings: result.bookings,
          timestamp: result.timestamp,
          fetchSummary: result.summary,
          facility: result.facility,
        };

        updateLoading("Đang tạo báo cáo...");
        await generateReportWithRoomList(result.bookings, facilityId);
        updateApiStatus(
          "success",
          `✅ Thành công! Lấy được ${result.totalBookings} booking từ ${result.facility.name}`
        );
      } else {
        console.error("Unexpected response structure:", result);
        throw new Error(
          `Không tìm thấy dữ liệu booking. Response: ${Object.keys(result).join(", ")}`
        );
      }
    } else {
      throw new Error(result.error || "Server operation failed");
    }
  } catch (error) {
    console.error("❌ Server fetch error:", error);
    updateApiStatus("error", `Server error: ${error.message}`);
    showNotification(`Server Error: ${error.message}`, "error");
  } finally {
    hideLoading();
  }
}

// Check server health
async function checkServerHealth() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/health`);
    const health = await response.json();

    console.log("🏥 Server health:", health);
    updateApiStatus("success", `Server OK - ${health.sessionCookies}`);
    showNotification("Server is running!", "success");

    return true;
  } catch (error) {
    console.error("❌ Server health check failed:", error);
    updateApiStatus("error", "Server not running");
    showNotification(
      "Node.js server not running! Please start it first.",
      "error"
    );

    return false;
  }
}

// Login via server only
async function loginViaServer() {
  updateApiStatus("pending", "Logging in via server...");

  try {
    const response = await fetch(`${API_BASE_URL}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const result = await response.json();

    if (result.success) {
      console.log("✅ Server login successful");
      updateApiStatus("success", "Login successful via server");
      showNotification("Login successful!", "success");
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error("❌ Server login error:", error);
    updateApiStatus("error", `Login error: ${error.message}`);
    showNotification(`Login Error: ${error.message}`, "error");
  }
}

// ===== BOOKING DATA DISPLAY FUNCTIONS =====

// Display booking data in a professional format
function displayBookingData(reportData) {
  // Store booking data globally for report generation
  window.lastBookingData = reportData;

  // Remove existing booking report if exists
  const existingReport = document.getElementById("booking-report-section");
  if (existingReport) {
    existingReport.remove();
  }

  if (!reportData || !reportData.bookings) {
    return;
  }

  const bookings = reportData.bookings;

  // Create booking report section
  const bookingSection = document.createElement("section");
  bookingSection.id = "booking-report-section";
  bookingSection.className = "booking-report-section";

  bookingSection.innerHTML = `
        <div class="container">
            <!-- Booking Summary Section -->
            <div class="booking-summary-card">
                <div class="summary-header">
                    <h2 class="summary-title">
                        📊 Booking Summary Report
                    </h2>
                    <div class="summary-timestamp">
                        Generated: ${new Date(
                          reportData.timestamp || Date.now()
                        ).toLocaleString("vi-VN")}
                    </div>
                </div>
                
                <div class="summary-cards">
                    <div class="summary-card primary">
                        <div class="card-icon">🏨</div>
                        <div class="card-content">
                            <div class="card-number">${
                              reportData.totalBookings || bookings.length
                            }</div>
                            <div class="card-label">Total Bookings</div>
                        </div>
                    </div>
                    
                    <div class="summary-card success">
                        <div class="card-icon">📄</div>
                        <div class="card-content">
                            <div class="card-number">${
                              reportData.fetchSummary?.totalPagesProcessed ||
                              reportData.pagesProcessed ||
                              1
                            }</div>
                            <div class="card-label">Pages Processed</div>
                        </div>
                    </div>
                    
                    <div class="summary-card info">
                        <div class="card-icon">📑</div>
                        <div class="card-content">
                            <div class="card-number">${
                              reportData.fetchSummary?.searchTypes?.length || 1
                            }</div>
                            <div class="card-label">Search Types</div>
                        </div>
                    </div>
                    
                    <div class="summary-card warning">
                        <div class="card-icon">💰</div>
                        <div class="card-content">
                            <div class="card-number">${calculateTotalRevenue(
                              bookings
                            )}</div>
                            <div class="card-label">Total Revenue</div>
                        </div>
                    </div>
                </div>
                
                <div class="summary-breakdown">
                    <div class="breakdown-item">
                        <span class="breakdown-label">Processing Status:</span>
                        <span class="breakdown-value ${
                          reportData.pagesProcessed === reportData.totalPages
                            ? "complete"
                            : "partial"
                        }">
                            ${
                              reportData.pagesProcessed ===
                              reportData.totalPages
                                ? "✅ Complete"
                                : "⏳ Partial"
                            }
                        </span>
                    </div>
                    <div class="breakdown-item">
                        <span class="breakdown-label">Data Source:</span>
                        <span class="breakdown-value">BlueJay PMS - ${
                          reportData.facility?.name || "Era Apartment"
                        }</span>
                    </div>
                    <div class="breakdown-item">
                        <span class="breakdown-label">Report Period:</span>
                        <span class="breakdown-value">August 1-10, 2025</span>
                    </div>
                </div>
            </div>
            
            <!-- Booking Table Section -->
            <div class="booking-table-card">
                <div class="table-header">
                    <h3 class="table-title">📋 Detailed Booking List</h3>
                    <div class="table-actions">
                        <button onclick="exportBookings()" class="export-btn">📊 Export CSV</button>
                        <button onclick="getReport()" class="report-btn">📋 Tạo báo cáo</button>
                    </div>
                </div>
                
                <div class="booking-table-container">
                    <table class="booking-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Booking Code</th>
                                <th>OTA Reference</th>
                                <th>Guest Name</th>
                                <th>Room</th>
                                <th>Source</th>
                                <th>Type</th>
                                <th>Status</th>
                                <th>Check-in</th>
                                <th>Check-out</th>
                                <th>Total Amount</th>
                                <th>Balance</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${bookings
                              .map(
                                (booking, index) => `
                                <tr class="booking-row">
                                    <td class="row-number">${index + 1}</td>
                                    <td class="booking-code">${
                                      booking.bookingCode || ""
                                    }</td>
                                    <td class="ota-ref">${
                                      booking.otaReference || "N/A"
                                    }</td>
                                    <td class="guest-name">${
                                      booking.guestName || ""
                                    }</td>
                                    <td class="room-info">${
                                      booking.room || "Unassigned"
                                    }</td>
                                    <td class="source-info">${
                                      booking.source || ""
                                    }</td>
                                    <td><span class="type-badge ${getTypeClass(
                                      booking.searchType
                                    )}">${
                                  booking.searchType || "N/A"
                                }</span></td>
                                    <td><span class="status-badge ${getStatusClass(
                                      booking.status
                                    )}">${booking.status || ""}</span></td>
                                    <td class="date-info">${
                                      booking.checkinDate || ""
                                    }</td>
                                    <td class="date-info">${
                                      booking.checkoutDate || ""
                                    }</td>
                                    <td class="amount">${
                                      booking.totalAmount
                                    }</td>
                                    <td class="amount ${
                                      parseFloat(
                                        booking.balance?.replace(
                                          /[^\d.-]/g,
                                          ""
                                        ) || 0
                                      ) > 0
                                        ? "has-balance"
                                        : ""
                                    }">${booking.balance}</td>
                                </tr>
                            `
                              )
                              .join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        
        ${getBookingStyles()}
    `;

  // Insert after first section (API testing section)
  const firstSection = document.querySelector(".demo-section");
  if (firstSection && firstSection.parentNode) {
    firstSection.parentNode.insertBefore(
      bookingSection,
      firstSection.nextSibling
    );
  } else {
    // Fallback: append to main container
    const mainContainer = document.querySelector(".container");
    if (mainContainer) {
      mainContainer.appendChild(bookingSection);
    } else {
      document.body.appendChild(bookingSection);
    }
  }
}

// ===== HELPER FUNCTIONS =====

// Calculate total revenue
function calculateTotalRevenue(bookings) {
  if (!bookings || bookings.length === 0) return "0 VND";

  const total = bookings.reduce((sum, booking) => {
    const amount = parseFloat(
      booking.totalAmount?.replace(/[^\d.-]/g, "") || 0
    );
    return sum + amount;
  }, 0);

  return total.toString();
}

// Get status class for badges
function getStatusClass(status) {
  if (!status) return "";
  const statusLower = status.toLowerCase();
  if (statusLower.includes("xác nhận")) return "confirmed";
  if (statusLower.includes("giữ phòng")) return "holding";
  if (statusLower.includes("nhận phòng")) return "checked-in";
  if (statusLower.includes("trả phòng")) return "checked-out";
  return "default";
}

// Get type class for TypeSeachDate badges
function getTypeClass(searchType) {
  if (!searchType) return "default";
  const typeLower = searchType.toLowerCase();
  if (typeLower.includes("đến")) return "arriving";
  if (typeLower.includes("đi")) return "departing";
  if (typeLower.includes("lưu")) return "staying";
  return "default";
}

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

// ===== UTILITY FUNCTIONS =====

// Update API status
function updateApiStatus(status, message) {
  const statusElement = document.getElementById("apiStatus");
  if (statusElement) {
    statusElement.className = `status-${status}`;
    statusElement.textContent = message;
  }
}

// Show notification
function showNotification(message, type = "info") {
  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;
  notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${getNotificationColor(type)};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 1000;
        font-weight: 500;
        transform: translateX(400px);
        transition: transform 0.3s ease;
    `;
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.transform = "translateX(0)";
  }, 100);

  setTimeout(() => {
    notification.style.transform = "translateX(400px)";
    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

function getNotificationColor(type) {
  const colors = {
    success: "#10b981",
    warning: "#f59e0b",
    error: "#ef4444",
    info: "#3b82f6",
  };
  return colors[type] || colors.info;
}

// ===== LOADING OVERLAY =====

function showLoading(message = "Đang tải...") {
  const existing = document.getElementById("loading-overlay");
  if (existing) {
    existing.querySelector(".loading-message").textContent = message;
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = "loading-overlay";
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.55); z-index: 9999;
    display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 1rem;
  `;
  overlay.innerHTML = `
    <style>
      @keyframes ota-spin { to { transform: rotate(360deg); } }
    </style>
    <div style="width:52px;height:52px;border:5px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:ota-spin 0.75s linear infinite;"></div>
    <div class="loading-message" style="color:#fff;font-size:1.05rem;font-weight:500;text-align:center;padding:0 1rem;">${message}</div>
  `;
  document.body.appendChild(overlay);
}

function updateLoading(message) {
  const msgEl = document.querySelector("#loading-overlay .loading-message");
  if (msgEl) msgEl.textContent = message;
}

function hideLoading() {
  const overlay = document.getElementById("loading-overlay");
  if (overlay) overlay.remove();
}

// ===== EXPORT FUNCTIONS =====

// Export bookings to CSV (placeholder)
function exportBookings() {
  alert("📊 Export feature coming soon!");
}

// Get detailed room report
function getReport() {
  const bookings = getCurrentBookingsData();
  if (!bookings || bookings.length === 0) {
    showNotification("Không có dữ liệu booking để tạo báo cáo!", "warning");
    return;
  }

  // Get facility ID from current selection
  const facilityId = document.getElementById("facilitySelect").value;
  if (!facilityId) {
    showNotification("Vui lòng chọn cơ sở để tạo báo cáo!", "warning");
    return;
  }

  // Fetch room list and generate report
  generateReportWithRoomList(bookings, facilityId);
}

// Get current bookings data from the displayed table
function getCurrentBookingsData() {
  const reportSection = document.getElementById("booking-report-section");
  if (!reportSection) return null;

  // Try to get data from the last fetch
  if (window.lastBookingData && window.lastBookingData.bookings) {
    return window.lastBookingData.bookings;
  }

  return null;
}

// New function to fetch room list and generate report
async function generateReportWithRoomList(bookings, facilityId) {
  try {
    console.log("🏠 Fetching room list for report generation...");

    // Fetch room list from server
    const response = await fetchWithAuth(`${API_BASE_URL}/api/list-rooms`, {
      method: "POST",
      body: JSON.stringify({
        facilityId: facilityId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const roomData = await response.json();

    if (roomData.success && roomData.rooms) {
      console.log(
        "✅ Room list fetched successfully:",
        roomData.rooms.length,
        "rooms"
      );

      // Extract room numbers for vacant room calculation
      const allRoomNumbers = roomData.rooms.map((room) => room.roomNumber);

      // Generate report text with room list
      const reportText = generateReportText(bookings, allRoomNumbers);

      // Show report popup
      showSimpleReportPopup(reportText);
    } else {
      console.warn(
        "⚠️ Failed to fetch room list, generating report without vacant rooms"
      );
      // Fallback to original method without room list
      const reportText = generateReportText(bookings);
      showSimpleReportPopup(reportText);
    }
  } catch (error) {
    console.error("❌ Error fetching room list:", error);
    showNotification(
      "Lỗi khi lấy danh sách phòng, tạo báo cáo cơ bản...",
      "warning"
    );

    // Fallback to original method without room list
    const reportText = generateReportText(bookings);
    showSimpleReportPopup(reportText);
  }
}

// Updated generateReportText function to accept room list parameter
function generateReportText(bookings, allRoomNumbers = null) {
  const currentDate = new Date().toLocaleDateString("vi-VN");

  // Get facility name from the last booking data or fallback to default
  let facilityName = "Era Apartment - 58 Nguyễn Khánh Toàn"; // Default fallback

  // Try to get facility name from global booking data
  if (
    window.lastBookingData &&
    window.lastBookingData.facility &&
    window.lastBookingData.facility.name
  ) {
    facilityName = window.lastBookingData.facility.name;
  }

  // Categorize rooms by TypeSeachDate
  const departed = []; // TypeSeachDate = 1 (Phòng đi)
  const staying = []; // TypeSeachDate = 3 (Phòng lưu)
  const arriving = []; // TypeSeachDate = 0 (Phòng đến)
  const vacant = []; // Phòng trống

  // Get all occupied room numbers
  const occupiedRooms = new Set();
  const arrivingRoomNumbers = new Set(); // track arriving room numbers to avoid duplicates in staying

  bookings.forEach((booking) => {
    const roomNumber = convertBookingRoomName(booking.room) || "Unassigned";
    const typeSeachDate = booking.typeSeachDate;

    // Categorize based on TypeSeachDate from server data
    if (typeSeachDate === 1) {
      // Phòng đi (departed)
      departed.push(roomNumber);
      // occupiedRooms.add(roomNumber);
    } else if (typeSeachDate === 3) {
      // Phòng lưu (staying)
      staying.push(roomNumber);
      occupiedRooms.add(roomNumber);
    } else if (typeSeachDate === 0) {
      // Phòng đến (arriving) - with full details
      // Sử dụng Day.js để xử lý ngày tháng đơn giản hơn
      dayjs.extend(dayjs_plugin_customParseFormat);

      const checkinDate = dayjs(booking.checkinDate, "DD/MM/YYYY");
      const checkoutDate = dayjs(booking.checkoutDate, "DD/MM/YYYY");
      const nights = Math.max(1, checkoutDate.diff(checkinDate, "day"));
      // otaReference
      const guestName = booking.guestName || "";
      const paymentText = getTextPayment(booking.source);
      const code = booking?.otaReference
        ? `(${booking?.otaReference?.slice(-4)})`
        : booking?.source != "Go2Joy"
        ? `(${booking.bookingCode})`
        : "";
      const totalAmount = booking.totalAmount || "0";

      const roomInfo = `P${roomNumber} - ${guestName} ${code} - ${nights} đêm - ${paymentText} ${totalAmount}`;
      arriving.push(roomInfo);
      occupiedRooms.add(roomNumber);
      arrivingRoomNumbers.add(String(roomNumber));
    }
  });

  // Remove staying rooms that also appear in arriving
  if (arrivingRoomNumbers.size > 0 && staying.length > 0) {
    const originalStayingCount = staying.length;
    const filtered = staying.filter((r) => !arrivingRoomNumbers.has(String(r)));
    // replace staying contents with filtered list
    staying.length = 0;
    staying.push(...filtered);
    console.log(
      `🔁 Removed ${
        originalStayingCount - filtered.length
      } duplicate staying rooms overlapping arriving`
    );
  }

  // Calculate vacant rooms using room list from server (if available)
  if (allRoomNumbers && Array.isArray(allRoomNumbers)) {
    console.log("🔍 Calculating vacant rooms from server room list...");
    allRoomNumbers.forEach((rawNumber) => {
      // Normalize server room number (e.g., "P302" → "302") before comparing
      const normalized = convertBookingRoomName(String(rawNumber));
      if (!occupiedRooms.has(normalized)) {
        vacant.push(normalized);
      }
    });
    console.log(
      "✅ Found",
      vacant.length,
      "vacant rooms from",
      allRoomNumbers.length,
      "total rooms"
    );
  } else {
    console.log("⚠️ No room list provided, skipping vacant room calculation");
  }

  // Build report text
  let reportText = `${facilityName}\nBáo cáo ngày: ${currentDate}\n\n`;

  reportText += `TỔNG QUAN:\n`;

  if (departed.length > 0) {
    reportText += `- Phòng đi: ${departed.join(", ")}\n`;
  } else {
    reportText += `- Phòng đi: Không có\n`;
  }

  if (staying.length > 0) {
    reportText += `- Phòng lưu: ${staying.join(", ")}\n`;
  } else {
    reportText += `- Phòng lưu: Không có\n`;
  }

  if (vacant.length > 0) {
    reportText += `- Phòng trống: ${vacant.join(", ")}\n`;
  } else if (allRoomNumbers) {
    // Only show "Không có" if we actually checked for vacant rooms
    reportText += `- Phòng trống: Không có\n`;
  } else {
    // If no room list was provided, indicate that vacant rooms weren't calculated
    reportText += `- Phòng trống: Chưa tính toán (thiếu danh sách phòng)\n`;
  }

  if (arriving.length > 0) {
    reportText += `- Phòng đến:\n`;
    arriving.forEach((room) => {
      reportText += `${room}\n`;
    });
  } else {
    reportText += `- Phòng đến: Không có\n`;
  }

  return reportText;
}

// Extract pure room number from various formats:
// "1N1K - 450"    → "450"
// "STUDIO - P502" → "502"
// "1N1K - P304"   → "304"
// "P502"          → "502"
// "403"           → "403"
function convertBookingRoomName(roomName) {
  if (!roomName) return roomName;

  // Match digits after "- " or "- P" (handles both "- 450" and "- P502")
  const dashMatch = roomName.match(/-\s*P?(\d+)/i);
  if (dashMatch) return dashMatch[1];

  // Strip leading "P" from plain "P502" format
  const pMatch = roomName.match(/^P(\d+)$/i);
  if (pMatch) return pMatch[1];

  return roomName;
}

// Show simple popup with copyable text
function showSimpleReportPopup(reportText) {
  // Remove existing popup
  const existingPopup = document.getElementById("simple-report-popup");
  if (existingPopup) {
    existingPopup.remove();
  }

  // Create simple popup
  const popup = document.createElement("div");
  popup.id = "simple-report-popup";
  popup.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border: 2px solid #ccc;
        border-radius: 8px;
        padding: 20px;
        width: 800px;
        max-width: 95vw;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        z-index: 1000;
        font-family: monospace;
    `;

  popup.innerHTML = `
        <div style="margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center;">
            <h3 style="margin: 0; color: #333;">📊 Báo Cáo Tình Trạng Phòng</h3>
            <button onclick="closeSimpleReportPopup()" style="background: #ff5252; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">✕</button>
        </div>
        
        <textarea id="reportTextArea" readonly style="
            width: 100%;
            height: 400px;
            font-family: monospace;
            font-size: 13px;
            line-height: 1.4;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            resize: vertical;
            background: #f9f9f9;
        ">${reportText}</textarea>
        
        <div style="margin-top: 15px; text-align: center;">
            <button onclick="copyReportText()" style="
                background: #4CAF50;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 4px;
                cursor: pointer;
                margin-right: 10px;
                font-size: 14px;
            ">📋 Copy Text</button>
            
            <button onclick="closeSimpleReportPopup()" style="
                background: #666;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
            ">Đóng</button>
        </div>
    `;

  // Add overlay
  const overlay = document.createElement("div");
  overlay.id = "overlay";
  overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        z-index: 999;
    `;
  overlay.onclick = closeSimpleReportPopup;

  document.body.appendChild(overlay);
  document.body.appendChild(popup);

  // Auto-select text for easy copying
  document.getElementById("reportTextArea").focus();
  document.getElementById("reportTextArea").select();
}

// Close simple report popup
function closeSimpleReportPopup() {
  const popup = document.getElementById("simple-report-popup");
  const overlay = document.getElementById("overlay");
  if (popup) popup.remove();
  if (overlay) overlay.remove();
}

// Copy report text to clipboard
function copyReportText() {
  const textArea = document.getElementById("reportTextArea");
  if (textArea) {
    textArea.select();
    textArea.setSelectionRange(0, 99999); // For mobile devices

    try {
      document.execCommand("copy");
      showNotification("Đã copy báo cáo vào clipboard!", "success");
    } catch (err) {
      // Fallback for modern browsers
      navigator.clipboard
        .writeText(textArea.value)
        .then(() => {
          showNotification("Đã copy báo cáo vào clipboard!", "success");
        })
        .catch(() => {
          showNotification(
            "Không thể copy. Vui lòng copy thủ công.",
            "warning"
          );
        });
    }
  }
}

// ===== LEGACY SUPPORT FUNCTIONS =====

// Display raw report data (for backward compatibility)
function displayReportData(data) {
  let reportSection = document.getElementById("reportSection");
  if (!reportSection) {
    reportSection = document.createElement("section");
    reportSection.id = "reportSection";
    reportSection.className = "demo-section";
    reportSection.innerHTML = `
            <h2>OTA Report Data</h2>
            <div id="reportContent" class="report-content"></div>
        `;
    document.querySelector(".main-content")?.appendChild(reportSection) ||
      document.body.appendChild(reportSection);
  }

  const reportContent = document.getElementById("reportContent");

  const parser = new DOMParser();
  const doc = parser.parseFromString(data, "text/html");

  const tables = doc.querySelectorAll("table");
  const forms = doc.querySelectorAll("form");

  if (tables.length > 0) {
    reportContent.innerHTML = "<h3>Found " + tables.length + " table(s):</h3>";
    tables.forEach((table, index) => {
      const tableContainer = document.createElement("div");
      tableContainer.innerHTML = `<h4>Table ${index + 1}:</h4>`;
      tableContainer.appendChild(table.cloneNode(true));
      reportContent.appendChild(tableContainer);
    });
  } else if (forms.length > 0) {
    reportContent.innerHTML =
      "<h3>Found " + forms.length + " form(s) - might need authentication</h3>";
  } else {
    reportContent.innerHTML = `
            <h3>Raw Response Preview:</h3>
            <pre style="max-height: 400px; overflow-y: auto; background: #f5f5f5; padding: 1rem; border-radius: 4px;">${escapeHtml(
              data.substring(0, 2000)
            )}${data.length > 2000 ? "\n... (truncated)" : ""}</pre>
            <p><strong>Total length:</strong> ${data.length} characters</p>
        `;
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ===== FACILITY MANAGEMENT =====

let facilities = [];

// Load facilities when page loads
document.addEventListener("DOMContentLoaded", async () => {
  // Verify token with server first - redirect to login if expired
  const isAuthenticated = await verifyAuth();
  if (!isAuthenticated) return;

  await loadFacilities();

  // Set default date range to current day
  const today = new Date();
  
  document.getElementById("fromDate").valueAsDate = today;
  document.getElementById("toDate").valueAsDate = today;
});

// Load facilities from server
async function loadFacilities() {
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/api/facilities`);
    const data = await response.json();

    if (data.success) {
      facilities = data.facilities;
      const select = document.getElementById("facilitySelect");
      select.innerHTML = '<option value="">Chọn một cơ sở...</option>';

      facilities.forEach((facility) => {
        const option = document.createElement("option");
        option.value = facility.id;
        option.textContent = `${facility.name} (${facility.roomTypes.length} loại phòng)`;
        select.appendChild(option);
      });
    } else {
      console.error("Failed to load facilities");
      const select = document.getElementById("facilitySelect");
      select.innerHTML = '<option value="">Lỗi tải danh sách cơ sở</option>';
    }
  } catch (error) {
    console.error("Error loading facilities:", error);
    // If it's an auth error, logout() already handles redirect - don't swallow it
    if (error.message === 'Authentication failed') return;
    const select = document.getElementById("facilitySelect");
    select.innerHTML = '<option value="">Lỗi kết nối server</option>';
  }
}

// ===== BOOKING STYLES =====

function getBookingStyles() {
  return `
        <style>
            /* Booking Report Section */
            .booking-report-section {
                padding: 2rem 0;
                background: var(--bg-color, #f8fafc);
                min-height: 100vh;
            }
            
            .booking-report-section .container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 0 2rem;
            }
            
            /* Booking Summary Card */
            .booking-summary-card {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border-radius: 16px;
                padding: 2rem;
                margin-bottom: 2rem;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            }
            
            .summary-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 2rem;
                flex-wrap: wrap;
                gap: 1rem;
            }
            
            .summary-title {
                font-size: 2rem;
                font-weight: 700;
                margin: 0;
                text-shadow: 0 2px 4px rgba(0,0,0,0.3);
            }
            
            .summary-timestamp {
                background: rgba(255,255,255,0.2);
                padding: 0.5rem 1rem;
                border-radius: 20px;
                font-size: 0.9rem;
                backdrop-filter: blur(10px);
            }
            
            .summary-cards {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 1.5rem;
                margin-bottom: 2rem;
            }
            
            .summary-card {
                background: rgba(255,255,255,0.15);
                border-radius: 12px;
                padding: 1.5rem;
                display: flex;
                align-items: center;
                gap: 1rem;
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255,255,255,0.2);
                transition: transform 0.3s ease, box-shadow 0.3s ease;
            }
            
            .summary-card:hover {
                transform: translateY(-4px);
                box-shadow: 0 8px 25px rgba(0,0,0,0.3);
            }
            
            .card-icon {
                font-size: 2.5rem;
                opacity: 0.9;
            }
            
            .card-content {
                flex: 1;
            }
            
            .card-number {
                font-size: 2rem;
                font-weight: 700;
                margin-bottom: 0.25rem;
            }
            
            .card-label {
                font-size: 0.9rem;
                opacity: 0.8;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .summary-breakdown {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 1rem;
                padding-top: 1.5rem;
                border-top: 1px solid rgba(255,255,255,0.2);
            }
            
            .breakdown-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 0.95rem;
            }
            
            .breakdown-label {
                opacity: 0.8;
            }
            
            .breakdown-value {
                font-weight: 600;
            }
            
            .breakdown-value.complete {
                color: #4ade80;
            }
            
            .breakdown-value.partial {
                color: #fbbf24;
            }
            
            /* Booking Table Card */
            .booking-table-card {
                background: var(--card-bg, white);
                border-radius: 16px;
                overflow: hidden;
                box-shadow: 0 10px 30px rgba(0,0,0,0.1);
                border: 1px solid var(--accent-color, #e2e8f0);
            }
            
            .table-header {
                background: var(--primary-color, #3b82f6);
                color: white;
                padding: 1.5rem 2rem;
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-wrap: wrap;
                gap: 1rem;
            }
            
            .table-title {
                margin: 0;
                font-size: 1.5rem;
                font-weight: 600;
            }
            
            .table-actions {
                display: flex;
                gap: 0.75rem;
            }
            
            .export-btn, .report-btn {
                background: rgba(255,255,255,0.2);
                color: white;
                border: none;
                padding: 0.5rem 1rem;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.3s ease;
                font-size: 0.9rem;
                font-weight: 500;
            }
            
            .export-btn:hover, .report-btn:hover {
                background: rgba(255,255,255,0.3);
                transform: translateY(-1px);
            }
            
            .booking-table-container {
                overflow-x: auto;
                max-height: 600px;
                overflow-y: auto;
            }
            
            .booking-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 0.9rem;
            }
            
            .booking-table th {
                background: #f8fafc;
                color: #1e293b;
                padding: 1rem 0.75rem;
                text-align: left;
                font-weight: 600;
                border-bottom: 2px solid #e2e8f0;
                position: sticky;
                top: 0;
                z-index: 10;
            }
            
            .booking-table td {
                padding: 0.75rem;
                border-bottom: 1px solid #f1f5f9;
            }
            
            .booking-row:hover {
                background: #f8fafc;
            }
            
            .booking-row:nth-child(even) {
                background: #fafbfc;
            }
            
            .booking-row:nth-child(even):hover {
                background: #f1f5f9;
            }
            
            .row-number {
                background: #e2e8f0;
                color: #64748b;
                font-weight: 600;
                text-align: center;
                width: 50px;
            }
            
            .booking-code {
                font-family: monospace;
                font-weight: 600;
                color: var(--primary-color, #3b82f6);
            }
            
            .guest-name {
                font-weight: 500;
                color: #1e293b;
            }
            
            .room-info {
                font-size: 0.85rem;
                color: #64748b;
            }
            
            .status-badge {
                padding: 0.25rem 0.75rem;
                border-radius: 20px;
                font-size: 0.8rem;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.025em;
            }
            
            .status-badge.confirmed {
                background: #dcfce7;
                color: #166534;
            }
            
            .status-badge.holding {
                background: #fef3c7;
                color: #92400e;
            }
            
            .status-badge.checked-in {
                background: #dbeafe;
                color: #1e40af;
            }
            
            .status-badge.checked-out {
                background: #f3f4f6;
                color: #374151;
            }
            
            .status-badge.default {
                background: #e5e7eb;
                color: #6b7280;
            }
            
            .type-badge {
                padding: 0.25rem 0.75rem;
                border-radius: 20px;
                font-size: 0.8rem;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.025em;
            }
            
            .type-badge.arriving {
                background: #dbeafe;
                color: #1e40af;
            }
            
            .type-badge.departing {
                background: #fee2e2;
                color: #dc2626;
            }
            
            .type-badge.staying {
                background: #dcfce7;
                color: #166534;
            }
            
            .type-badge.default {
                background: #f3f4f6;
                color: #6b7280;
            }
            
            .amount {
                text-align: right;
                font-family: monospace;
                font-weight: 600;
            }
            
            .amount.has-balance {
                color: #dc2626;
                background: #fef2f2;
                padding: 0.25rem 0.5rem;
                border-radius: 4px;
            }
            
            .date-info {
                font-size: 0.85rem;
                color: #64748b;
            }
            
            /* Responsive Design */
            @media (max-width: 768px) {
                .booking-report-section .container {
                    padding: 0 1rem;
                }
                
                .booking-summary-card {
                    padding: 1.5rem;
                }
                
                .summary-title {
                    font-size: 1.5rem;
                }
                
                .summary-cards {
                    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                    gap: 1rem;
                }
                
                .summary-card {
                    padding: 1rem;
                }
                
                .card-number {
                    font-size: 1.5rem;
                }
                
                .table-header {
                    padding: 1rem;
                }
                
                .table-title {
                    font-size: 1.25rem;
                }
                
                .booking-table th,
                .booking-table td {
                    padding: 0.5rem 0.25rem;
                    font-size: 0.8rem;
                }
            }
        </style>
    `;
}

// ===== REVENUE REPORT FUNCTIONS =====

// Generate revenue report with date range
async function generateRevenueReport() {
  const facilityId = document.getElementById("facilitySelect").value;
  const fromDateInput = document.getElementById("fromDate").value;
  const toDateInput = document.getElementById("toDate").value;

  if (!facilityId) {
    showNotification("Vui lòng chọn cơ sở trước!", "warning");
    return;
  }

  if (!fromDateInput || !toDateInput) {
    showNotification("Vui lòng chọn khoảng thời gian!", "warning");
    return;
  }

  // Convert from YYYY-MM-DD to DD/MM/YYYY
  const fromDate = convertToVNDate(fromDateInput);
  const toDate = convertToVNDate(toDateInput);

  updateApiStatus("pending", "Đang tạo báo cáo doanh thu...");
  showNotification("Đang fetch dữ liệu doanh thu...", "info");

  try {
    console.log("💰 Generating revenue report...", {
      facilityId,
      fromDate,
      toDate,
    });

    const response = await fetchWithAuth(`${API_BASE_URL}/api/revenue-report`, {
      method: "POST",
      body: JSON.stringify({
        facilityId: facilityId,
        fromDate: fromDate,
        toDate: toDate,
      }),
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const result = await response.json();

    if (result.success) {
      console.log("✅ Revenue report generated:", result);

      // Store globally for export
      window.lastRevenueReport = result;

      // Show export popup directly without display
      showRevenueExportPopup(result);

      updateApiStatus(
        "success",
        `✅ Báo cáo doanh thu: ${result.summary.totalBookings} bookings, ${formatCurrency(
          result.summary.totalRevenue
        )} VND`
      );
      showNotification("Báo cáo doanh thu đã sẵn sàng!", "success");
    } else {
      throw new Error(result.error || "Failed to generate revenue report");
    }
  } catch (error) {
    console.error("❌ Revenue report error:", error);
    updateApiStatus("error", `Error: ${error.message}`);
    showNotification(`Error: ${error.message}`, "error");
  }
}

// Convert YYYY-MM-DD to DD/MM/YYYY
function convertToVNDate(dateString) {
  const [year, month, day] = dateString.split("-");
  return `${day}/${month}/${year}`;
}

// Format currency
function formatCurrency(amount) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(amount));
}

// Calculate total nights from bookings
function calculateTotalNights(bookings) {
  if (!bookings || bookings.length === 0) return 0;

  dayjs.extend(dayjs_plugin_customParseFormat);

  const totalNights = bookings.reduce((sum, booking) => {
    const checkinDate = dayjs(booking.checkinDate, "DD/MM/YYYY");
    const checkoutDate = dayjs(booking.checkoutDate, "DD/MM/YYYY");
    const nights = Math.max(1, checkoutDate.diff(checkinDate, "day"));
    return sum + nights;
  }, 0);

  return totalNights;
}

// Get OTA source name
function getOTASourceName(source) {
  const sourceMap = {
    "Booking.com": "Booking.com",
    Agoda: "Agoda",
    Expedia: "Expedia",
    "Airbnb XML": "Airbnb",
    Ctrip: "Ctrip",
    Go2Joy: "Go2Joy",
    DayLaDau: "DayLaDau",
    "Khách lẻ": "Khách lẻ",
  };
  return sourceMap[source] || source;
}

// Show revenue export popup with copyable text
function showRevenueExportPopup(reportData) {
  const { facility, dateRange, summary, bookings } = reportData;

  // Generate Excel-formatted text (tab-separated) - No headers
  // Use all bookings directly (already sorted by backend)
  let excelText = ``;

  dayjs.extend(dayjs_plugin_customParseFormat);
  
  bookings.forEach((booking) => {
    const checkinDate = dayjs(booking.checkinDate, "DD/MM/YYYY");
    const checkoutDate = dayjs(booking.checkoutDate, "DD/MM/YYYY");
    const nights = Math.max(1, checkoutDate.diff(checkinDate, "day"));

    // Format: Ngày(empty) phòng TênKhách NgàyĐến NgàyĐi TổngSốĐêm Đơngiá TổngTiền HH(empty) ThựcThu NGUỒN
    excelText += `\t${booking.room}\t${booking.guestName}\t${booking.checkinDate}\t${booking.checkoutDate}\t${nights}\t\t${booking.totalAmount}\t\t${booking.totalAmount}\t${getOTASourceName(booking.source)}\n`;
  });

  // Remove existing popup
  const existingPopup = document.getElementById("revenue-export-popup");
  if (existingPopup) {
    existingPopup.remove();
  }

  // Create popup
  const popup = document.createElement("div");
  popup.id = "revenue-export-popup";
  popup.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    border: 2px solid #ccc;
    border-radius: 8px;
    padding: 20px;
    width: 90vw;
    max-width: 1200px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    z-index: 1000;
    font-family: monospace;
  `;

  popup.innerHTML = `
    <div style="margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center;">
      <h3 style="margin: 0; color: #333;">💰 Báo Cáo Doanh Thu - ${
        facility.name
      }</h3>
      <button onclick="closeRevenueExportPopup()" style="background: #ff5252; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">✕</button>
    </div>
    
    <div style="margin-bottom: 10px; padding: 10px; background: #e3f2fd; border-radius: 4px;">
      <p style="margin: 5px 0;"><strong>Kỳ báo cáo:</strong> ${dateRange.from} - ${
    dateRange.to
  }</p>
      <p style="margin: 5px 0;"><strong>Tổng booking:</strong> ${
        summary.totalBookings
      } | <strong>Tổng doanh thu:</strong> ${formatCurrency(
    summary.totalRevenue
  )} VND</p>
      <p style="margin: 5px 0; color: #d32f2f;"><strong>📋 Hướng dẫn:</strong> Copy text bên dưới và paste vào Excel (Ctrl+V). Dữ liệu sẽ tự động phân chia vào các cột.</p>
    </div>
    
    <textarea id="revenueTextArea" readonly style="
      width: 100%;
      height: 400px;
      font-family: monospace;
      font-size: 12px;
      line-height: 1.4;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      resize: vertical;
      background: #f9f9f9;
    ">${excelText}</textarea>
    
    <div style="margin-top: 15px; text-align: center;">
      <button onclick="copyRevenueText()" style="
        background: #4CAF50;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 4px;
        cursor: pointer;
        margin-right: 10px;
        font-size: 14px;
      ">📋 Copy Text</button>
      
      <button onclick="downloadRevenueCSV()" style="
        background: #2196F3;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 4px;
        cursor: pointer;
        margin-right: 10px;
        font-size: 14px;
      ">💾 Download CSV</button>
      
      <button onclick="closeRevenueExportPopup()" style="
        background: #666;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
      ">Đóng</button>
    </div>
  `;

  // Add overlay
  const overlay = document.createElement("div");
  overlay.id = "revenue-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    z-index: 999;
  `;
  overlay.onclick = closeRevenueExportPopup;

  document.body.appendChild(overlay);
  document.body.appendChild(popup);

  // Auto-select text for easy copying
  document.getElementById("revenueTextArea").focus();
  document.getElementById("revenueTextArea").select();
}

// Close revenue export popup
function closeRevenueExportPopup() {
  const popup = document.getElementById("revenue-export-popup");
  const overlay = document.getElementById("revenue-overlay");
  if (popup) popup.remove();
  if (overlay) overlay.remove();
}

// Copy revenue text to clipboard
function copyRevenueText() {
  const textArea = document.getElementById("revenueTextArea");
  if (textArea) {
    textArea.select();
    textArea.setSelectionRange(0, 99999);

    try {
      document.execCommand("copy");
      showNotification(
        "✅ Đã copy báo cáo! Paste vào Excel (Ctrl+V)",
        "success"
      );
    } catch (err) {
      navigator.clipboard
        .writeText(textArea.value)
        .then(() => {
          showNotification(
            "✅ Đã copy báo cáo! Paste vào Excel (Ctrl+V)",
            "success"
          );
        })
        .catch(() => {
          showNotification("Lỗi khi copy. Vui lòng copy thủ công.", "error");
        });
    }
  }
}

// Download revenue as CSV
function downloadRevenueCSV() {
  const textArea = document.getElementById("revenueTextArea");
  if (!textArea) return;

  const csvContent = textArea.value;
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  const facilityName =
    window.lastRevenueReport?.facility?.name || "revenue_report";
  const dateRange = window.lastRevenueReport?.dateRange || {};
  const fileName = `${facilityName}_${dateRange.from?.replace(
    /\//g,
    "-"
  )}_${dateRange.to?.replace(/\//g, "-")}.csv`;

  link.setAttribute("href", url);
  link.setAttribute("download", fileName);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showNotification("✅ Đã tải file CSV!", "success");
}

// Export revenue to Excel (wrapper function)
function exportRevenueToExcel() {
  if (window.lastRevenueReport) {
    showRevenueExportPopup(window.lastRevenueReport);
  } else {
    showNotification("Vui lòng tạo báo cáo doanh thu trước!", "warning");
  }
}

// ===== INITIALIZATION =====
console.log("Core Booking Data Script Loaded ✅");
