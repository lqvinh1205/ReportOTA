const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { URLSearchParams } = require("url");

const app = express();
const PORT = 3001;

// Enable CORS for all origins
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from current directory
app.use(express.static("."));

// OTA API parameters
const params = {
  TypeSeachDate: 0,
  FromDate: getCurrentDateString(),
  ToDate: getCurrentDateString(),
  RoomType: 10559,
  RoomDetail: "",
  SourceType: "",
  Source: "",
  Status: "1,0,3,4,2",
  Seach: "",
  IsExtensionFilder: true,
  p: 1, // Page number
  txtEmail: "ota.eraapartment4@gmail.com",
  txtPassword: "123456",
};

const matrixParams = {};

const baseUrl = "https://id.bluejaypms.com";
const loginPath = `${baseUrl}/login`;
const reservationPath = `${baseUrl}/app/Reservation`;

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

// Reusable login function
async function performLogin(facilityEmail = null, facilityPassword = null) {
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

    return {
      success: true,
      status: loginResponse.status,
      message: "Login successful",
      cookies: sessionCookies,
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

// Facility and RoomType configuration
const facilities = {
  era_apartment_1: {
    name: "Era Cát Linh",
    email: "ota.eraapartment4@gmail.com",
    password: "123456",
    roomTypes: [11246, 11247],
  },
  era_apartment_2: {
    name: "Era 158 Nguyễn Khánh Toàn",
    email: "ota.eraapartment4@gmail.com",
    password: "123456",
    roomTypes: [11248, 11249, 11423, 11424],
  },
  era_apartment_3: {
    name: "Era 58 Nguyễn Khánh Toàn",
    email: "ota.eraapartment4@gmail.com",
    password: "123456",
    roomTypes: [10559],
  },
};

// Get facilities endpoint
app.get("/api/facilities", (req, res) => {
  const facilitiesInfo = Object.keys(facilities).map((key) => ({
    id: key,
    name: facilities[key].name,
    roomTypes: facilities[key].roomTypes,
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
        `\n🔍 Fetching data for ${searchType.name} (TypeSeachDate=${searchType.typeSeachDate})...`
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
          pageParams
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
            `✅ ${searchType.name} - Page ${currentPage}/${totalPages} - Found ${parsedData.bookingsOnPage} bookings`
          );

          // If only 1 page, break early
          if (totalPages === 1) {
            console.log(
              `📄 ${searchType.name} - Only 1 page of data available`
            );
            break;
          }
        } else {
          console.log(
            `❌ ${searchType.name} - Failed to parse page ${currentPage}`
          );
          break;
        }

        currentPage++;

        // Safety limit to prevent infinite loop
        if (fetchedPages >= 20) {
          console.log(
            `⚠️  ${searchType.name} - Reached safety limit of 20 pages`
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
        `🎉 ${searchType.name} - Completed! ${typeBookings.length} bookings from ${fetchedPages} pages`
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
      `📑 Total pages processed: ${fetchSummary.totalPagesProcessed}/${fetchSummary.totalPages}`
    );
    fetchSummary.searchTypes.forEach((type) => {
      console.log(
        `   ${type.name}: ${type.bookings} bookings (${type.pages}/${type.totalPages} pages)`
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
app.post("/api/login-and-fetch-facility", async (req, res) => {
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
      `🏢 Starting comprehensive fetch for facility: ${facility.name}`
    );

    // Use facility credentials for login
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

    sessionCookies = extractCookies(loginPageResponse);

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

    const loginData = new URLSearchParams({
      __EVENTTARGET: "lkLogin",
      __EVENTARGUMENT: "",
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: viewStateGenerator,
      __EVENTVALIDATION: eventValidation,
      ddlLangCode: "vi-VN",
      txtEmail: facility.email,
      txtPassword: facility.password,
    });

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
        return status >= 200 && status < 400;
      },
    });

    const newCookies = extractCookies(loginResponse);
    if (newCookies) {
      sessionCookies = newCookies;
    }

    console.log("✅ Login successful for facility:", facility.name);

    // Define search types
    const searchTypes = [
      { name: "Phòng đến", typeSeachDate: 0, description: "Check-in today" },
      { name: "Phòng đi", typeSeachDate: 1, description: "Check-out today" },
      { name: "Phòng lưu", typeSeachDate: 3, description: "Currently staying" },
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
            FromDate: fromDate || params.FromDate,
            ToDate: toDate || params.ToDate,
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
              Cookie: sessionCookies,
            },
            maxRedirects: 5,
          });

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
              `    ✅ Page ${currentPage}/${totalPages} - ${parsedData.bookingsOnPage} bookings`
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
          `    🎉 ${searchType.name} completed: ${typeBookings.length} bookings`
        );

        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      roomTypeSummary.totalBookings = roomTypeBookings.length;
      fetchSummary.roomTypeSummary.push(roomTypeSummary);
      allBookings = allBookings.concat(roomTypeBookings);

      console.log(
        `🏠 RoomType ${roomType} completed: ${roomTypeBookings.length} total bookings`
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
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    server: "OTA Report Server",
    timestamp: new Date().toISOString(),
    sessionCookies: sessionCookies ? "Available" : "None",
  });
});

// Start server
app.listen(PORT, () => {
  console.log("🚀 OTA Report Server started successfully!");
  console.log(`📡 Server running at: http://localhost:${PORT}`);
  console.log("📋 Available endpoints:");
  console.log("   GET  /api/health               - Health check");
  console.log("   POST /api/login                - Login to OTA system");
  console.log("   GET  /api/report               - Fetch report data");
  console.log("   POST /api/login-and-fetch      - Combined login + fetch");
  console.log("   POST /api/login-and-fetch-all  - Login + fetch ALL pages");
  console.log("   GET  /api/facilities           - Get facility information");
  console.log("");
  console.log("💡 Usage examples:");
  console.log("   curl -X POST http://localhost:3001/api/login");
  console.log("   curl http://localhost:3001/api/report");
  console.log("   curl -X POST http://localhost:3001/api/login-and-fetch");
  console.log("   curl -X POST http://localhost:3001/api/login-and-fetch-all");
  console.log("   curl http://localhost:3001/api/facilities");
});

// Helper function to parse booking data from HTML
function parseBookingData(html) {
  try {
    console.log("🔍 Parsing HTML data length:", html.length);

    // Find pagination info using DataTables paginate element
    let currentPage = 1;
    let totalPages = 1;

    // Try to match the DataTables pagination block
    const paginateBlockMatch = html.match(
      /<div[^>]*class="[^"]*dataTables_paginate[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    if (paginateBlockMatch) {
      const paginateHtml = paginateBlockMatch[1];

      // Find all page number links
      const pageNumberMatches = [
        ...paginateHtml.matchAll(
          /<a[^>]*class="[^"]*paginate_button(?!.*current)[^"]*"[^>]*href="[^"]*p=(\d+)[^"]*"[^>]*>(\d+)<\/a>/gi
        ),
      ];
      const currentPageMatch = paginateHtml.match(
        /<a[^>]*class="[^"]*paginate_button current[^"]*"[^>]*href="[^"]*p=(\d+)[^"]*"[^>]*>(\d+)<\/a>/i
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
        totalPages
      );
    } else {
      // Fallback: Try to match old pagination text
      const paginationMatch = html.match(
        /Trang\s+(\d+)\s+\/\s+(\d+)|Page\s+(\d+)\s+of\s+(\d+)/i
      );
      if (paginationMatch) {
        currentPage = parseInt(paginationMatch[1] || paginationMatch[3]) || 1;
        totalPages = parseInt(paginationMatch[2] || paginationMatch[4]) || 1;
        console.log(
          "📄 Pagination found (text):",
          currentPage,
          "/",
          totalPages
        );
      }
    }

    // Find the main booking table
    const bookingTableMatch = html.match(
      /<table[^>]*class="[^"]*table[^"]*"[^>]*>([\s\S]*?)<\/table>/i
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
            totalAmount: extractTextFromCell(cells[12]),
            paid: extractTextFromCell(cells[13]),
            balance: extractTextFromCell(cells[14]),
            notes: cells.length > 16 ? extractTextFromCell(cells[16]) : "",
          };

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

// New API endpoint to fetch calendar data
app.post("/api/calendar-data", async (req, res) => {
  try {
    const { facilityId } = req.body;
    
    if (!facilityId) {
      return res.status(400).json({
        success: false,
        error: "facilityId is required"
      });
    }

    console.log("📅 Starting calendar data fetch for facility:", facilityId);

    // Get facility configuration
    const facility = facilities[facilityId];
    if (!facility) {
      return res.status(400).json({
        success: false,
        error: "Invalid facilityId"
      });
    }

    // Login first if not already logged in or use facility credentials
    if (!sessionCookies) {
      console.log("🔐 No session found, logging in with facility credentials...");
      const loginResponse = await performLogin(facility.email, facility.password);
      if (!loginResponse.success) {
        return res.status(500).json(loginResponse);
      }
    }

    // Fetch calendar page data
    const calendarUrl = `${baseUrl}/app/calendar`;
    
    console.log("🌐 Fetching calendar page...");
    const calendarResponse = await axios.get(calendarUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
        "Cookie": sessionCookies,
        "Cache-Control": "no-cache",
      },
    });

    if (calendarResponse.status !== 200) {
      throw new Error(`Calendar page request failed: ${calendarResponse.status}`);
    }

    console.log("✅ Calendar page loaded successfully");
    
    // Extract CalendarOption data from the page
    const calendarHtml = calendarResponse.data;
    const calendarData = extractCalendarOptionData(calendarHtml);

    if (!calendarData.success) {
      return res.status(500).json({
        success: false,
        error: "Failed to extract calendar data from page"
      });
    }

    // Transform data to match the format of login-and-fetch-facility
    const transformedBookings = transformCalendarBookings(calendarData.bookingGroup, calendarData.listRoom, facility.roomTypes);

    // Add facility information to each booking to match login-and-fetch-facility format
    const bookingsWithFacilityInfo = transformedBookings.map(booking => {
      // Update property name with facility info to match reservation format
      let propertyName = facility.name.toUpperCase();
      
      // Try to make it more specific like reservation format
      if (booking.room && booking.room !== "Room Unknown") {
        // Extract room prefix for property naming
        const roomPrefix = booking.room.split(' - ')[0]; // Get "STD" from "STD - NKT - 304"
        if (roomPrefix) {
          propertyName = `${facility.name.toUpperCase()} - ${roomPrefix} VIEW`;
        }
      }
      
      return {
        ...booking,
        property: propertyName, // Update with proper facility name format
        facilityId: facilityId,
        facilityName: facility.name,
        roomType: facility.roomTypes[0] || 10559 // Use first room type or default
      };
    });

    // Categorize rooms according to the new spec
    const roomCategories = categorizeRoomsFromCalendar(bookingsWithFacilityInfo, calendarData.listRoom, facility.roomTypes);

    // Response with the same structure as login-and-fetch-facility
    const response = {
      success: true,
      facility: {
        id: facilityId,
        name: facility.name,
        roomTypes: facility.roomTypes
      },
      totalBookings: bookingsWithFacilityInfo.length,
      bookings: bookingsWithFacilityInfo,
      timestamp: new Date().toISOString(),
      summary: {
        source: "calendar",
        totalPagesProcessed: 1,
        searchTypes: ["calendar-data"],
        dataExtracted: {
          listRoom: calendarData.listRoom?.length || 0,
          bookingGroup: calendarData.bookingGroup?.length || 0
        },
        roomCategories: roomCategories
      },
      rawCalendarData: {
        listRoom: calendarData.listRoom,
        bookingGroup: calendarData.bookingGroup
      }
    };

    console.log("✅ Calendar data transformation complete");
    console.log("📊 Total bookings:", bookingsWithFacilityInfo.length);

    res.json(response);

  } catch (error) {
    console.error("❌ Calendar data fetch error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.stack
    });
  }
});

// Helper function to extract CalendarOption data from HTML
function extractCalendarOptionData(html) {
  try {
    // Look for CalendarOption.ListRoom and CalendarOption.BookingGroup in the script
    const listRoomMatch = html.match(/CalendarOption\.ListRoom\s*=\s*(\[[\s\S]*?\]);/);
    const bookingGroupMatch = html.match(/CalendarOption\.BookingGroup\s*=\s*(\[[\s\S]*?\]);/);

    let listRoom = [];
    let bookingGroup = [];

    if (listRoomMatch && listRoomMatch[1]) {
      try {
        // Clean up the JavaScript code and evaluate it safely
        const listRoomCode = listRoomMatch[1];
        listRoom = JSON.parse(listRoomCode);
        console.log("✅ Extracted ListRoom data:", listRoom.length, "rooms");
      } catch (e) {
        console.warn("⚠️ Failed to parse ListRoom:", e.message);
      }
    }

    if (bookingGroupMatch && bookingGroupMatch[1]) {
      try {
        // Clean up the JavaScript code and evaluate it safely
        const bookingGroupCode = bookingGroupMatch[1];
        bookingGroup = JSON.parse(bookingGroupCode);
        console.log("✅ Extracted BookingGroup data:", bookingGroup.length, "bookings");
      } catch (e) {
        console.warn("⚠️ Failed to parse BookingGroup:", e.message);
      }
    }

    return {
      success: true,
      listRoom: listRoom,
      bookingGroup: bookingGroup
    };

  } catch (error) {
    console.error("❌ Calendar data extraction error:", error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Helper function to transform calendar bookings to reservation format
function transformCalendarBookings(bookingGroup, listRoom, facilityRoomTypes = []) {
  if (!bookingGroup || !Array.isArray(bookingGroup)) {
    return [];
  }

  // Create room lookup map and filter by facility room types
  const roomMap = {};
  console.log("🔍 Starting room filtering process...");
  console.log("🔍 listRoom exists:", !!listRoom);
  console.log("🔍 listRoom isArray:", Array.isArray(listRoom));
  console.log("🔍 listRoom length:", listRoom?.length);
  
  if (listRoom && Array.isArray(listRoom)) {
    console.log("🔍 Processing rooms...");
    let roomCount = 0;
    listRoom.forEach((room, index) => {
      roomCount++;
      if (room.Id) {
        // Only include rooms that match the facility's room types
        // Check RoomTypeId, Group, or TypeRoomId properties
        const roomTypeId = room.RoomTypeId || room.Group || room.TypeRoomId || room.Type;
        const shouldInclude = facilityRoomTypes.length === 0 || facilityRoomTypes.includes(roomTypeId);
        
        // Debug: log first few rooms to see what's happening
        if (index < 5) {
          console.log(`🔍 Room ${room.Id} (${room.Name}): roomTypeId=${roomTypeId}, shouldInclude=${shouldInclude}, facilityRoomTypes=${JSON.stringify(facilityRoomTypes)}`);
        }
        
        if (shouldInclude) {
          roomMap[room.Id] = room;
        }
      } else {
        if (index < 5) {
          console.log(`🔍 Room at index ${index} has no Id:`, JSON.stringify(room));
        }
      }
    });
    console.log("🔍 Processed", roomCount, "rooms total");
  } else {
    console.log("🔍 No valid listRoom data");
  }

  console.log("🔍 Total listRoom:", listRoom?.length || 0);
  console.log("🔍 Filtered rooms by roomTypes:", Object.keys(roomMap).length);
  console.log("🔍 Facility roomTypes filter:", facilityRoomTypes);

  // Filter bookings to only include those using rooms that match facility room types
  const filteredBookings = bookingGroup.filter(booking => {
    const roomId = booking.Details?.[0]?.RoomId || booking.RoomId;
    return roomMap[roomId]; // Only include if room is in our filtered room map
  });

  console.log("🔍 Total bookings before filter:", bookingGroup.length);
  console.log("🔍 Bookings after room type filter:", filteredBookings.length);

  // Additional date filtering: only include bookings that meet date criteria
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const dateFilteredBookings = filteredBookings.filter(booking => {
    const checkin = new Date(booking.BeginDate || booking.CheckInDate || booking.FromDate || booking.StartDate);
    checkin.setHours(0, 0, 0, 0);
    
    const checkout = new Date(booking.EndDate || booking.CheckOutDate || booking.ToDate);
    checkout.setHours(0, 0, 0, 0);

    // Phòng đi: end date = now (checkout today)
    const isPhongDi = checkout.getTime() === today.getTime();
    
    // Phòng đến: start date = now (checkin today)
    const isPhongDen = checkin.getTime() === today.getTime();
    
    // Phòng lưu: start date < now < end date (currently staying)
    const isPhongLuu = checkin < today && checkout > today;

    return isPhongDi || isPhongDen || isPhongLuu;
  });

  console.log("🔍 Bookings after date filter:", dateFilteredBookings.length);
  console.log("🔍 Date criteria - Today:", today.toISOString().split('T')[0]);

  return dateFilteredBookings.map((booking, index) => {
    // Get room information from Details[0].RoomId (not booking.RoomId)
    const roomId = booking.Details?.[0]?.RoomId || booking.RoomId;
    const room = roomMap[roomId] || {};
    const roomName = room.Name || `Room ${roomId || 'Unknown'}`;

    // Status mapping for calendar data
    let status = "Unknown";
    if (booking.Status !== undefined && booking.Status !== null) {
      if (typeof booking.Status === 'number') {
        // Map status codes to text like reservation system
        const statusMap = {
          0: "Đã xác nhận", // Confirmed
          1: "Đang giữ phòng", // Reserved/Holding
          2: "Hủy", // Cancelled  
          3: "Đã nhận phòng", // Checked-in
          4: "Đã trả phòng", // Checked-out
        };
        status = statusMap[booking.Status] || `Status ${booking.Status}`;
      } else {
        status = String(booking.Status);
      }
    }

    // Determine searchType and typeSeachDate using ORIGINAL LOGIC from reservation system
    let searchType = "Unknown";
    let typeSeachDate = 0; // Default
    
    if (status && typeof status === 'string') {
      const statusLower = status.toLowerCase();
      
      // Original logic: check status string for keywords
      if (statusLower.includes('nhận phòng') || statusLower.includes('check') || statusLower.includes('arrived')) {
        searchType = "Phòng đến";
        typeSeachDate = 0; // Arriving
      } else if (statusLower.includes('trả phòng') || statusLower.includes('checkout') || statusLower.includes('depart')) {
        searchType = "Phòng đi"; 
        typeSeachDate = 1; // Departing
      } else if (statusLower.includes('lưu') || statusLower.includes('stay') || statusLower.includes('occupied')) {
        searchType = "Phòng lưu";
        typeSeachDate = 3; // Staying
      } else {
        // Fallback: use date-based logic if status doesn't contain keywords
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const checkin = new Date(booking.BeginDate || booking.CheckInDate || booking.FromDate);
        checkin.setHours(0, 0, 0, 0);
        
        const checkout = new Date(booking.EndDate || booking.CheckOutDate || booking.ToDate);
        checkout.setHours(0, 0, 0, 0);

        if (checkin.getTime() === today.getTime()) {
          searchType = "Phòng đến";
          typeSeachDate = 0; // Arriving
        } else if (checkout.getTime() === today.getTime()) {
          searchType = "Phòng đi";
          typeSeachDate = 1; // Departing
        } else if (checkin < today && checkout > today) {
          searchType = "Phòng lưu";
          typeSeachDate = 3; // Staying
        }
      }
    }

    // Format amounts to match reservation format
    const totalAmount = booking.Total || booking.TotalAmount || booking.Amount || 0;
    const paidAmount = booking.Payment || booking.Paid || booking.PaidAmount || 0;
    const balanceAmount = booking.Balance || booking.Outstanding || (totalAmount - paidAmount);

    // Format notes like reservation system (string, not array)
    let notesString = "";
    if (booking.Notes && Array.isArray(booking.Notes) && booking.Notes.length > 0) {
      // Take the first note or combine them
      notesString = booking.Notes.map(note => note.Note || note).join("; ");
    } else if (typeof booking.Notes === 'string') {
      notesString = booking.Notes;
    } else {
      // Default to balance amount like reservation system when notes is empty
      notesString = formatAmountForReservation(balanceAmount);
    }

    return {
      // EXACT SAME FORMAT as login-and-fetch-facility response
      bookingCode: booking.Code || booking.BookingCode || `CAL-${index + 1}`,
      otaReference: booking.OTAReference || booking.OtaReference || "",
      guestName: booking.Name || booking.Customer || booking.GuestName || booking.CustomerName || "",
      property: "Calendar Property", // Will be updated with facility info later
      room: roomName,
      source: booking.ChanelName || booking.Source || "Calendar",
      status: status,
      bookingDate: formatDate(booking.BookingDate || booking.CreatedDate || new Date().toISOString()), // Add current date if missing
      checkinDate: formatDate(booking.BeginDate || booking.CheckInDate || booking.FromDate || booking.StartDate),
      checkinTime: booking.ArrivalTime || booking.CheckInTime || "14:00", // Add checkinTime with default
      checkoutDate: formatDate(booking.EndDate || booking.CheckOutDate || booking.ToDate),
      checkoutTime: booking.DepartureTime || booking.CheckOutTime || "12:00", // Add checkoutTime with default
      totalAmount: formatAmountForReservation(totalAmount), // Format like reservation
      paid: formatAmountForReservation(paidAmount), // Add paid field
      balance: formatAmountForReservation(balanceAmount), // Format like reservation
      notes: notesString, // Format as string like reservation system
      
      // Additional fields to match login-and-fetch-facility
      searchType: searchType, // Using original logic
      typeSeachDate: typeSeachDate, // Using original logic
      
      // Calendar-specific fields (keep these for debugging)
      roomId: roomId,
      bookingId: booking.Id || booking.BookingId,
      nights: booking.Days || booking.Nights || calculateNights(
        booking.BeginDate || booking.CheckInDate || booking.FromDate || booking.StartDate, 
        booking.EndDate || booking.CheckOutDate || booking.ToDate
      ),
      adults: booking.Adults || booking.AdultCount || 1,
      children: booking.Children || booking.ChildCount || 0,
      // Raw booking data for debugging
      rawBooking: booking
    };
  });
}

// Helper function to format amount like reservation system (without VND, just number with dots)
function formatAmountForReservation(amount) {
  if (!amount && amount !== 0) return "0";
  
  // Convert to number if it's a string
  let numAmount = typeof amount === 'string' ? parseFloat(amount.replace(/[^\d.-]/g, '')) : amount;
  if (isNaN(numAmount)) numAmount = 0;
  
  // Format like reservation system: "294.000" (with dots as thousands separator)
  return numAmount.toLocaleString("de-DE"); // German locale uses dots for thousands
}

// Helper function to determine search type from calendar booking
function getSearchTypeFromCalendarBooking(booking) {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Set to start of day for accurate comparison
  
  const checkin = new Date(booking.CheckInDate || booking.FromDate);
  checkin.setHours(0, 0, 0, 0);
  
  const checkout = new Date(booking.CheckOutDate || booking.ToDate);
  checkout.setHours(0, 0, 0, 0);

  // Phòng đi: end date = now (checkout today)
  if (checkout.getTime() === today.getTime()) {
    return "Phòng đi";
  }
  // Phòng đến: start date = now (checkin today)  
  else if (checkin.getTime() === today.getTime()) {
    return "Phòng đến";
  }
  // Phòng lưu: start date < now < end date (currently staying)
  else if (checkin < today && checkout > today) {
    return "Phòng lưu";
  }
  
  return "Unknown";
}

// Helper function to determine TypeSeachDate from calendar booking
function determineTypeSeachDate(booking) {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Set to start of day for accurate comparison
  
  const checkin = new Date(booking.CheckInDate || booking.FromDate);
  checkin.setHours(0, 0, 0, 0);
  
  const checkout = new Date(booking.CheckOutDate || booking.ToDate);
  checkout.setHours(0, 0, 0, 0);

  // Phòng đi: end date = now (checkout today)
  if (checkout.getTime() === today.getTime()) {
    return 1; // Departing
  }
  // Phòng đến: start date = now (checkin today)
  else if (checkin.getTime() === today.getTime()) {
    return 0; // Arriving
  }
  // Phòng lưu: start date < now < end date (currently staying)
  else if (checkin < today && checkout > today) {
    return 3; // Staying
  }
  
  return 0; // Default to arriving
}

// Helper function to check if date is today
function isToday(date) {
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  
  return checkDate.getTime() === today.getTime();
}

// Helper function to categorize rooms from calendar data using ORIGINAL LOGIC
function categorizeRoomsFromCalendar(bookings, listRoom, facilityRoomTypes = []) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Initialize categories using ORIGINAL NAMES from reservation system
  const categories = {
    phongDi: [], // TypeSeachDate = 1 (Phòng đi) 
    phongDen: [], // TypeSeachDate = 0 (Phòng đến)
    phongLuu: [], // TypeSeachDate = 3 (Phòng lưu)
    phongTrong: [] // Phòng trống: các phòng còn lại chưa có booking nào
  };

  // Get all occupied room IDs
  const occupiedRoomIds = new Set();

  // Categorize bookings using ORIGINAL LOGIC (based on typeSeachDate from status parsing)
  bookings.forEach(booking => {
    const roomInfo = {
      roomId: booking.roomId,
      roomName: booking.room,
      guestName: booking.guestName,
      bookingCode: booking.bookingCode,
      checkinDate: booking.checkinDate,
      checkoutDate: booking.checkoutDate,
      nights: booking.nights,
      source: booking.source,
      totalAmount: booking.totalAmount,
      status: booking.status // Include original status for reference
    };

    // Track occupied rooms
    occupiedRoomIds.add(booking.roomId);

    // Categorize using ORIGINAL typeSeachDate logic
    if (booking.typeSeachDate === 1) {
      // Phòng đi (departed)
      categories.phongDi.push(roomInfo);
    } else if (booking.typeSeachDate === 0) {
      // Phòng đến (arriving) 
      categories.phongDen.push(roomInfo);
    } else if (booking.typeSeachDate === 3) {
      // Phòng lưu (staying)
      categories.phongLuu.push(roomInfo);
    }
    // Note: Keeping original logic - other typeSeachDate values are not categorized
  });

  // Find vacant rooms (phòng trống) - Filter by facility room types
  if (listRoom && Array.isArray(listRoom)) {
    listRoom.forEach(room => {
      // Only include rooms that match facility room types and are not occupied
      const roomTypeId = room.RoomTypeId || room.Group || room.TypeRoomId || room.Type;
      const roomMatchesFacility = facilityRoomTypes.length === 0 || facilityRoomTypes.includes(roomTypeId);
      if (roomMatchesFacility && !occupiedRoomIds.has(room.Id)) {
        categories.phongTrong.push({
          roomId: room.Id,
          roomName: room.Name || `Room ${room.Id}`,
          roomType: roomTypeId,
          floor: room.Floor,
          status: "Vacant"
        });
      }
    });
  }

  return {
    phongDi: {
      count: categories.phongDi.length,
      rooms: categories.phongDi
    },
    phongDen: {
      count: categories.phongDen.length,
      rooms: categories.phongDen
    },
    phongLuu: {
      count: categories.phongLuu.length,
      rooms: categories.phongLuu
    },
    phongTrong: {
      count: categories.phongTrong.length,
      rooms: categories.phongTrong
    },
    summary: {
      totalRooms: listRoom?.length || 0,
      filteredRooms: listRoom?.filter(room => {
        const roomTypeId = room.RoomTypeId || room.Group || room.TypeRoomId || room.Type;
        return facilityRoomTypes.length === 0 || facilityRoomTypes.includes(roomTypeId);
      }).length || 0,
      facilityRoomTypes: facilityRoomTypes,
      occupiedRooms: occupiedRoomIds.size,
      vacantRooms: categories.phongTrong.length,
      date: today.toISOString().split('T')[0],
      logic: "original_typeSeachDate_based" // Indicator of logic used
    }
  };
}

// Helper function to format date
function formatDate(dateStr) {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch (e) {
    return dateStr;
  }
}

// Helper function to calculate nights between dates
function calculateNights(checkin, checkout) {
  if (!checkin || !checkout) return 1;
  try {
    const checkinDate = new Date(checkin);
    const checkoutDate = new Date(checkout);
    const diffTime = checkoutDate - checkinDate;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(1, diffDays);
  } catch (e) {
    return 1;
  }
}

function getCurrentDateString() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `${day}/${month}/${year}`;
}

module.exports = app;
