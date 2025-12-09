const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");

// Load users from config
function loadUsers() {
  try {
    const usersPath = path.join(__dirname, "../config/users.json");
    const usersData = fs.readFileSync(usersPath, "utf8");
    return JSON.parse(usersData).users;
  } catch (error) {
    console.error("❌ Error loading users:", error.message);
    return [];
  }
}

// Load facilities from config
function loadFacilities() {
  try {
    const facilitiesPath = path.join(__dirname, "../config/facilities.json");
    const facilitiesData = fs.readFileSync(facilitiesPath, "utf8");
    return JSON.parse(facilitiesData).facilities;
  } catch (error) {
    console.error("❌ Error loading facilities:", error.message);
    return {};
  }
}

// JWT Secret from environment
const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "24h";

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Access token required",
      code: "NO_TOKEN",
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        error: "Invalid or expired token",
        code: "INVALID_TOKEN",
      });
    }

    // Attach user to request
    req.user = user;
    next();
  });
}

// Middleware to check if user has access to facility
function checkFacilityAccess(req, res, next) {
  const { facilityId } = req.body;
  const user = req.user;

  if (!facilityId) {
    return res.status(400).json({
      success: false,
      error: "Facility ID required",
    });
  }

  // Admin has access to all facilities
  if (user.role === "admin") {
    return next();
  }

  // Check if user has access to this facility
  if (!user.facilities || !user.facilities.includes(facilityId)) {
    return res.status(403).json({
      success: false,
      error: "Access denied to this facility",
      code: "FACILITY_ACCESS_DENIED",
    });
  }

  next();
}

// Generate JWT token
function generateToken(user) {
  const payload = {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    facilities: user.facilities,
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

module.exports = {
  authenticateToken,
  checkFacilityAccess,
  generateToken,
  loadUsers,
  loadFacilities,
  JWT_SECRET,
};
