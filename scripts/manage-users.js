#!/usr/bin/env node

/**
 * User Management Script
 * Create and manage users for ReportOTA system
 */

const bcrypt = require("bcrypt");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const USERS_FILE = path.join(__dirname, "../config/users.json");
const SALT_ROUNDS = 10;

// Prompt function
function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// Load users
function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
      return { users: [] };
    }
    const data = fs.readFileSync(USERS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error loading users:", error.message);
    return { users: [] };
  }
}

// Save users
function saveUsers(usersData) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersData, null, 2), "utf8");
    console.log("✅ Users saved successfully");
  } catch (error) {
    console.error("❌ Error saving users:", error.message);
  }
}

// Create new user
async function createUser() {
  console.log("\n=== Create New User ===\n");

  const username = await prompt("Username: ");
  const password = await prompt("Password: ");
  const name = await prompt("Full Name: ");
  const email = await prompt("Email: ");
  const role = await prompt("Role (admin/manager/viewer): ");
  const facilitiesInput = await prompt(
    "Facilities (comma-separated IDs, e.g. era_apartment_1,era_apartment_2): "
  );

  const facilities = facilitiesInput
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f);

  // Hash password
  console.log("\n⏳ Hashing password...");
  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  const newUser = {
    id: `user${Date.now()}`,
    username,
    password: hashedPassword,
    name,
    email,
    role: role || "viewer",
    facilities,
    active: true,
    createdAt: new Date().toISOString(),
  };

  // Load existing users
  const usersData = loadUsers();

  // Check if username already exists
  if (usersData.users.some((u) => u.username === username)) {
    console.log("❌ Username already exists!");
    rl.close();
    return;
  }

  // Add new user
  usersData.users.push(newUser);

  // Save
  saveUsers(usersData);

  console.log("\n✅ User created successfully!");
  console.log("User ID:", newUser.id);
  console.log("Username:", newUser.username);
  console.log("Role:", newUser.role);
  console.log("Facilities:", newUser.facilities.join(", "));

  rl.close();
}

// List users
function listUsers() {
  console.log("\n=== User List ===\n");

  const usersData = loadUsers();

  if (usersData.users.length === 0) {
    console.log("No users found.");
    rl.close();
    return;
  }

  usersData.users.forEach((user) => {
    console.log(`ID: ${user.id}`);
    console.log(`Username: ${user.username}`);
    console.log(`Name: ${user.name}`);
    console.log(`Email: ${user.email}`);
    console.log(`Role: ${user.role}`);
    console.log(`Facilities: ${user.facilities.join(", ")}`);
    console.log(`Active: ${user.active}`);
    console.log(`Created: ${user.createdAt}`);
    console.log("---");
  });

  rl.close();
}

// Hash a password
async function hashPassword() {
  const password = await prompt("\nEnter password to hash: ");
  console.log("\n⏳ Hashing...");
  const hashed = await bcrypt.hash(password, SALT_ROUNDS);
  console.log("\nHashed password:");
  console.log(hashed);
  console.log("\nCopy this hash to users.json");
  rl.close();
}

// Main menu
async function main() {
  console.log("\n╔════════════════════════════════════╗");
  console.log("║   ReportOTA User Management Tool  ║");
  console.log("╚════════════════════════════════════╝\n");

  console.log("1. Create new user");
  console.log("2. List all users");
  console.log("3. Hash a password");
  console.log("4. Exit\n");

  const choice = await prompt("Select option (1-4): ");

  switch (choice) {
    case "1":
      await createUser();
      break;
    case "2":
      listUsers();
      break;
    case "3":
      await hashPassword();
      break;
    case "4":
      console.log("Goodbye!");
      rl.close();
      break;
    default:
      console.log("Invalid option");
      rl.close();
  }
}

// Run
main();
