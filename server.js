const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { URLSearchParams } = require("url");
const dayjs = require("dayjs");

// Load environment variables
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Configure CORS - Allow all origins if CORS_ORIGINS is 'all'
const corsOptions = {
  origin: process.env.CORS_ORIGINS === 'all' ? true : 
          (process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : true),
  credentials: true
};

app.use(cors(corsOptions));
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

// New API endpoint to get list of rooms for a facility
app.post("/api/list-rooms", async (req, res) => {
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

    // Login with facility credentials if needed
    if (!sessionCookies) {
      console.log("🔐 No session found, logging in...");
      const loginResult = await performLogin(facility.email, facility.password);
      if (!loginResult.success) {
        return res.status(500).json({
          success: false,
          error: "Login failed",
          details: loginResult.error,
        });
      }
    }

    // Fetch calendar page to get room list
    const calendarUrl = `${baseUrl}/app/calendar`;
    console.log("🌐 Fetching calendar page for room list...");

    const calendarResponse = await axios.get(calendarUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
        Cookie: sessionCookies,
        "Cache-Control": "no-cache",
      },
    });

    if (calendarResponse.status !== 200) {
      throw new Error(
        `Calendar page request failed: ${calendarResponse.status}`
      );
    }

    console.log("✅ Calendar page loaded successfully");

    // Extract room data from calendar
    const calendarData = extractCalendarOptionData(calendarResponse.data);

    if (!calendarData.success) {
      return res.status(500).json({
        success: false,
        error: "Failed to extract calendar data",
      });
    }

    // Filter rooms by facility room types
    const facilityRooms = calendarData.listRoom.filter((room) => {
      const roomTypeId =
        room.RoomTypeId || room.Group || room.TypeRoomId || room.Type;
      return facility.roomTypes.includes(roomTypeId);
    });

    // Transform room data to simple format for report generation
    const roomList = facilityRooms.map((room) => {
      // Extract room number from room name (e.g., "1N1K - 450" -> "450")
      // const roomNumberMatch = room.Name.match(/-\s*(\d+)/);
      // const roomNumber = roomNumberMatch ? roomNumberMatch[1] : room.Name;

      return {
        id: room.Id,
        name: room.Name,
        roomNumber: room.Number,
        roomTypeId:
          room.RoomTypeId || room.Group || room.TypeRoomId || room.Type,
        floor: room.Floor || null,
      };
    });

    console.log(
      `✅ Found ${roomList.length} rooms for facility ${facility.name}`
    );

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

// Helper function to extract CalendarOption data from HTML
function extractCalendarOptionData(html) {
  try {
    // Look for CalendarOption.ListRoom and CalendarOption.BookingGroup in the script
    const listRoomMatch = html.match(
      /CalendarOption\.ListRoom\s*=\s*(\[[\s\S]*?\]);/
    );
    const bookingGroupMatch = html.match(
      /CalendarOption\.BookingGroup\s*=\s*(\[[\s\S]*?\]);/
    );

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
        console.log(
          "✅ Extracted BookingGroup data:",
          bookingGroup.length,
          "bookings"
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

// Start server
app.listen(PORT, HOST, () => {
  console.log("🚀 OTA Report Server started successfully!");
  console.log(`📡 Server running at: http://${HOST}:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log("📋 Available endpoints:");
  console.log("   GET  /api/health                    - Health check");
  console.log("   POST /api/login                     - Login to OTA system");
  console.log("   GET  /api/report                    - Fetch report data");
  console.log(
    "   POST /api/login-and-fetch           - Combined login + fetch"
  );
  console.log(
    "   POST /api/login-and-fetch-facility  - Login + fetch by facility"
  );
  console.log(
    "   GET  /api/facilities                - Get facility information"
  );
  console.log(
    "   POST /api/list-rooms                - Get room list by facility"
  );
  console.log("");
  console.log("💡 Usage examples:");
  console.log("   curl -X POST http://localhost:3001/api/login");
  console.log("   curl http://localhost:3001/api/report");
  console.log("   curl -X POST http://localhost:3001/api/login-and-fetch");
  console.log(
    "   curl -X POST http://localhost:3001/api/login-and-fetch-facility"
  );
  console.log("   curl http://localhost:3001/api/facilities");
  console.log(
    '   curl -X POST -H "Content-Type: application/json" -d \'{"facilityId":"era_apartment_3"}\' http://localhost:3001/api/list-rooms'
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
