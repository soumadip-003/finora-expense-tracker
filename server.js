
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { promisify } = require("util");

const app = express();
const db = new Database(path.join(__dirname, "expenses.db"));
const scrypt = promisify(crypto.scrypt);

const PORT = Number(process.env.PORT) || 3000;
const COOKIE = "finora_token";
const SESSION_AGE = 7 * 24 * 60 * 60 * 1000;

app.disable("x-powered-by");
app.use(express.json({ limit: "30kb" }));
app.use(express.static(path.join(__dirname, "public")));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

// ---------------- SESSION SECRET ----------------

function getSecret() {
  if (
    process.env.SESSION_SECRET &&
    process.env.SESSION_SECRET.length >= 32
  ) {
    return process.env.SESSION_SECRET;
  }

  const file = path.join(__dirname, ".session-secret");

  if (fs.existsSync(file)) {
    const saved = fs.readFileSync(file, "utf8").trim();
    if (saved.length >= 32) return saved;
  }

  const secret = crypto.randomBytes(48).toString("hex");

  try {
    fs.writeFileSync(file, secret, {
      flag: "wx",
      mode: 0o600
    });

    return secret;
  } catch (error) {
    if (fs.existsSync(file)) {
      return fs.readFileSync(file, "utf8").trim();
    }

    throw error;
  }
}

const SECRET = getSecret();

// ---------------- DATABASE ----------------

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    category TEXT NOT NULL DEFAULT 'Other',
    date TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS income (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    title TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    category TEXT NOT NULL DEFAULT 'Salary',
    date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    month TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount >= 0),
    UNIQUE(user_id, month)
  );
`);

function columns(table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map(column => column.name);
}

if (!columns("expenses").includes("user_id")) {
  db.exec(`
    ALTER TABLE expenses
    ADD COLUMN user_id INTEGER REFERENCES users(id)
  `);
}

if (!columns("income").includes("user_id")) {
  db.exec(`
    ALTER TABLE income
    ADD COLUMN user_id INTEGER REFERENCES users(id)
  `);
}

// ---------------- PASSWORD HELPERS ----------------

// Existing password format: saltHex:hashHex
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);

  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

async function verifyPassword(password, passwordHash) {
  if (
    typeof password !== "string" ||
    typeof passwordHash !== "string" ||
    password.length > 128
  ) {
    return false;
  }

  const parts = passwordHash.split(":");

  if (parts.length !== 2) return false;

  const [saltHex, hashHex] = parts;

  if (
    !/^[0-9a-f]{32}$/i.test(saltHex) ||
    !/^[0-9a-f]{128}$/i.test(hashHex)
  ) {
    return false;
  }

  const expected = Buffer.from(hashHex, "hex");

  const actual = await scrypt(
    password,
    Buffer.from(saltHex, "hex"),
    expected.length
  );

  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}

// ---------------- AUTH TOKEN ----------------

function createToken(user) {
  const payload = Buffer.from(
    JSON.stringify({
      id: user.id,
      exp: Date.now() + SESSION_AGE
    })
  ).toString("base64url");

  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

function verifyToken(token) {
  if (
    !token ||
    typeof token !== "string" ||
    token.length > 2048
  ) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 2) return null;

  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(parts[0])
    .digest();

  const received = Buffer.from(parts[1], "base64url");

  if (
    received.length !== expected.length ||
    !crypto.timingSafeEqual(received, expected)
  ) {
    return null;
  }

  try {
    const data = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8")
    );

    if (
      !Number.isSafeInteger(data.id) ||
      data.id < 1 ||
      !Number.isFinite(data.exp) ||
      data.exp <= Date.now()
    ) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

function getCookie(req, name) {
  const cookies = (req.headers.cookie || "").split(";");

  for (const cookie of cookies) {
    const index = cookie.indexOf("=");

    if (index < 0) continue;

    if (cookie.slice(0, index).trim() === name) {
      return cookie.slice(index + 1).trim();
    }
  }

  return null;
}

function setCookie(res, user) {
  const secure =
    process.env.NODE_ENV === "production"
      ? "; Secure"
      : "";

  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${createToken(user)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`
  );
}

function clearCookie(res) {
  const secure =
    process.env.NODE_ENV === "production"
      ? "; Secure"
      : "";

  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`
  );
}

function auth(req, res, next) {
  const session = verifyToken(getCookie(req, COOKIE));

  if (!session) {
    return res.status(401).json({
      error: "Please log in to continue."
    });
  }

  const user = db.prepare(
    "SELECT id, name, email FROM users WHERE id = ?"
  ).get(session.id);

  if (!user) {
    clearCookie(res);

    return res.status(401).json({
      error: "Session invalid. Please log in again."
    });
  }

  req.user = user;
  next();
}

// ---------------- BASIC SECURITY ----------------

function sameOrigin(req, res, next) {
  const origin = req.get("origin");

  if (!origin) return next();

  try {
    if (new URL(origin).host !== req.get("host")) {
      return res.status(403).json({
        error: "Cross-origin request blocked."
      });
    }
  } catch {
    return res.status(403).json({
      error: "Invalid request origin."
    });
  }

  next();
}

// Login/Register rate limit
const attempts = new Map();

function authLimit(req, res, next) {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || "unknown";

  let record = attempts.get(ip);

  if (!record || now - record.start >= 15 * 60 * 1000) {
    record = { start: now, count: 0 };
  }

  record.count++;
  attempts.set(ip, record);

  if (record.count > 10) {
    res.setHeader("Retry-After", "900");

    return res.status(429).json({
      error: "Too many attempts. Please try again later."
    });
  }

  if (attempts.size > 5000) {
    for (const [key, value] of attempts) {
      if (now - value.start >= 15 * 60 * 1000) {
        attempts.delete(key);
      }
    }
  }

  next();
}

// ---------------- VALIDATION ----------------

function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  const [y, m, d] = date.split("-").map(Number);

  const parsed = new Date(Date.UTC(y, m - 1, d));

  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === m - 1 &&
    parsed.getUTCDate() === d
  );
}

function validTransaction(body) {
  const title =
    typeof body?.title === "string"
      ? body.title.trim()
      : "";

  const amount =
    typeof body?.amount === "number" ||
    typeof body?.amount === "string"
      ? Number(body.amount)
      : NaN;

  const category =
    typeof body?.category === "string"
      ? body.category.trim()
      : "Other";

  const date =
    typeof body?.date === "string"
      ? body.date
      : "";

  if (!title || title.length > 120) {
    return {
      error: "Name is required (maximum 120 characters)."
    };
  }

  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > 1e12
  ) {
    return {
      error: "Enter a valid positive amount."
    };
  }

  if (!validDate(date)) {
    return {
      error: "Enter a valid date in YYYY-MM-DD format."
    };
  }

  return {
    data: {
      title,
      amount,
      category: category.slice(0, 50) || "Other",
      date
    }
  };
}

// ---------------- REGISTER ----------------

app.post(
  "/api/auth/register",
  sameOrigin,
  authLimit,
  async (req, res) => {
    try {
      const name =
        typeof req.body?.name === "string"
          ? req.body.name.trim()
          : "";

      const email =
        typeof req.body?.email === "string"
          ? req.body.email.trim().toLowerCase()
          : "";

      const password =
        typeof req.body?.password === "string"
          ? req.body.password
          : "";

      if (name.length < 2 || name.length > 80) {
        return res.status(400).json({
          error: "Name must contain 2–80 characters."
        });
      }

      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 254
      ) {
        return res.status(400).json({
          error: "Enter a valid email address."
        });
      }

      if (password.length < 8 || password.length > 128) {
        return res.status(400).json({
          error: "Password must be 8–128 characters."
        });
      }

      const passwordHash = await hashPassword(password);

      const createUser = db.transaction(() => {
        const result = db.prepare(`
          INSERT INTO users (name, email, password_hash)
          VALUES (?, ?, ?)
        `).run(name, email, passwordHash);

        const id = Number(result.lastInsertRowid);

        // Assign legacy single-user data to the first account.
        if (id === 1) {
          db.prepare(`
            UPDATE expenses SET user_id = ?
            WHERE user_id IS NULL
          `).run(id);

          db.prepare(`
            UPDATE income SET user_id = ?
            WHERE user_id IS NULL
          `).run(id);
        }

        return { id, name, email };
      });

      const user = createUser();

      setCookie(res, user);

      return res.status(201).json({ user });
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).json({
          error: "This email is already registered."
        });
      }

      console.error("Register error:", error);

      return res.status(500).json({
        error: "Registration failed. Please try again."
      });
    }
  }
);

// ---------------- LOGIN ----------------

app.post(
  "/api/auth/login",
  sameOrigin,
  authLimit,
  async (req, res) => {
    try {
      const email =
        typeof req.body?.email === "string"
          ? req.body.email.trim().toLowerCase()
          : "";

      const password =
        typeof req.body?.password === "string"
          ? req.body.password
          : "";

      const user = db.prepare(`
        SELECT id, name, email, password_hash
        FROM users
        WHERE email = ?
      `).get(email);

      if (
        !user ||
        password.length > 128 ||
        !(await verifyPassword(password, user.password_hash))
      ) {
        return res.status(401).json({
          error: "Incorrect email or password."
        });
      }

      const publicUser = {
        id: user.id,
        name: user.name,
        email: user.email
      };

      setCookie(res, publicUser);

      return res.json({ user: publicUser });
    } catch (error) {
      console.error("Login error:", error);

      return res.status(500).json({
        error: "Login failed. Please try again."
      });
    }
  }
);

// ---------------- CURRENT USER ----------------

app.get("/api/auth/me", auth, (req, res) => {
  res.json({ user: req.user });
});

// ---------------- PROFILE UPDATE ----------------
// Accepts name and/or email.
// Example: PUT /api/auth/profile
// Body: { "name": "New Name" }

app.put(
  "/api/auth/profile",
  sameOrigin,
  auth,
  (req, res) => {
    try {
      const body = req.body || {};

      let name = req.user.name;
      let email = req.user.email;

      const hasName = Object.prototype.hasOwnProperty.call(
        body,
        "name"
      );

      const hasEmail = Object.prototype.hasOwnProperty.call(
        body,
        "email"
      );

      if (!hasName && !hasEmail) {
        return res.status(400).json({
          error: "Provide a name or email to update."
        });
      }

      if (hasName) {
        if (typeof body.name !== "string") {
          return res.status(400).json({
            error: "Name must be a string."
          });
        }

        name = body.name.trim();

        if (name.length < 2 || name.length > 80) {
          return res.status(400).json({
            error: "Name must contain 2–80 characters."
          });
        }
      }

      if (hasEmail) {
        if (typeof body.email !== "string") {
          return res.status(400).json({
            error: "Email must be a string."
          });
        }

        email = body.email.trim().toLowerCase();

        if (
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          email.length > 254
        ) {
          return res.status(400).json({
            error: "Enter a valid email address."
          });
        }
      }

      db.prepare(`
        UPDATE users
        SET name = ?, email = ?
        WHERE id = ?
      `).run(name, email, req.user.id);

      const updatedUser = {
        id: req.user.id,
        name,
        email
      };

      // Renew the current authentication cookie.
      setCookie(res, updatedUser);

      return res.json({
        message: "Profile updated successfully.",
        user: updatedUser
      });
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).json({
          error: "This email is already registered."
        });
      }

      console.error("Profile update error:", error);

      return res.status(500).json({
        error: "Failed to update profile."
      });
    }
  }
);

// ---------------- CHANGE PASSWORD ----------------
// Body: { "currentPassword": "...", "newPassword": "..." }

app.post(
  "/api/auth/change-password",
  sameOrigin,
  auth,
  async (req, res) => {
    try {
      const currentPassword =
        typeof req.body?.currentPassword === "string"
          ? req.body.currentPassword
          : "";

      const newPassword =
        typeof req.body?.newPassword === "string"
          ? req.body.newPassword
          : "";

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          error: "Current and new passwords are required."
        });
      }

      if (
        currentPassword.length > 128 ||
        newPassword.length < 8 ||
        newPassword.length > 128
      ) {
        return res.status(400).json({
          error: "New password must contain 8–128 characters."
        });
      }

      if (currentPassword === newPassword) {
        return res.status(400).json({
          error: "New password must differ from the current password."
        });
      }

      const user = db.prepare(`
        SELECT id, password_hash
        FROM users
        WHERE id = ?
      `).get(req.user.id);

      if (!user) {
        return res.status(404).json({
          error: "User not found."
        });
      }

      const valid = await verifyPassword(
        currentPassword,
        user.password_hash
      );

      if (!valid) {
        return res.status(400).json({
          error: "Current password is incorrect."
        });
      }

      const newPasswordHash = await hashPassword(newPassword);

      db.prepare(`
        UPDATE users
        SET password_hash = ?
        WHERE id = ?
      `).run(newPasswordHash, user.id);

      // Refresh the current login cookie.
      setCookie(res, req.user);

      return res.json({
        message: "Password changed successfully."
      });
    } catch (error) {
      console.error("Password change error:", error);

      return res.status(500).json({
        error: "Failed to change password."
      });
    }
  }
);

// ---------------- LOGOUT ----------------

app.post("/api/auth/logout", sameOrigin, (req, res) => {
  clearCookie(res);
  res.json({ message: "Logged out." });
});

// ---------------- EXPENSES ----------------

app.get("/api/expenses", auth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, title, amount, category, date
    FROM expenses
    WHERE user_id = ?
    ORDER BY date DESC, id DESC
  `).all(req.user.id);

  res.json(rows);
});

app.post(
  "/api/expenses",
  sameOrigin,
  auth,
  (req, res) => {
    const result = validTransaction(req.body);

    if (result.error) {
      return res.status(400).json({
        error: result.error
      });
    }

    const d = result.data;

    const info = db.prepare(`
      INSERT INTO expenses
        (user_id, title, amount, category, date)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      d.title,
      d.amount,
      d.category,
      d.date
    );

    res.status(201).json({
      id: Number(info.lastInsertRowid),
      ...d
    });
  }
);

app.delete(
  "/api/expenses/:id",
  sameOrigin,
  auth,
  (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        error: "Invalid expense ID."
      });
    }

    const result = db.prepare(`
      DELETE FROM expenses
      WHERE id = ? AND user_id = ?
    `).run(id, req.user.id);

    if (!result.changes) {
      return res.status(404).json({
        error: "Expense not found."
      });
    }

    res.json({ message: "Expense deleted." });
  }
);

// ---------------- INCOME ----------------

app.get("/api/income", auth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, title, amount, category, date
    FROM income
    WHERE user_id = ?
    ORDER BY date DESC, id DESC
  `).all(req.user.id);

  res.json(rows);
});

app.post(
  "/api/income",
  sameOrigin,
  auth,
  (req, res) => {
    const result = validTransaction(req.body);

    if (result.error) {
      return res.status(400).json({
        error: result.error
      });
    }

    const d = result.data;

    const info = db.prepare(`
      INSERT INTO income
        (user_id, title, amount, category, date)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      d.title,
      d.amount,
      d.category,
      d.date
    );

    res.status(201).json({
      id: Number(info.lastInsertRowid),
      ...d
    });
  }
);

app.delete(
  "/api/income/:id",
  sameOrigin,
  auth,
  (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        error: "Invalid income ID."
      });
    }

    const result = db.prepare(`
      DELETE FROM income
      WHERE id = ? AND user_id = ?
    `).run(id, req.user.id);

    if (!result.changes) {
      return res.status(404).json({
        error: "Income not found."
      });
    }

    res.json({ message: "Income deleted." });
  }
);

// ---------------- MONTHLY BUDGET ----------------

app.get("/api/budget/:month", auth, (req, res) => {
  const month = req.params.month;

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({
      error: "Month must be YYYY-MM."
    });
  }

  const budget = db.prepare(`
    SELECT amount
    FROM budgets
    WHERE user_id = ? AND month = ?
  `).get(req.user.id, month);

  const spent = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM expenses
    WHERE user_id = ?
      AND substr(date, 1, 7) = ?
  `).get(req.user.id, month).total;

  const amount = budget ? budget.amount : 0;

  res.json({
    month,
    budget: amount,
    spent,
    remaining: amount - spent
  });
});

app.put(
  "/api/budget/:month",
  sameOrigin,
  auth,
  (req, res) => {
    const month = req.params.month;
    const amount = Number(req.body?.amount);

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({
        error: "Month must be YYYY-MM."
      });
    }

    if (
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > 1e12
    ) {
      return res.status(400).json({
        error: "Budget must be a valid non-negative amount."
      });
    }

    db.prepare(`
      INSERT INTO budgets (user_id, month, amount)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, month)
      DO UPDATE SET amount = excluded.amount
    `).run(req.user.id, month, amount);

    res.json({
      month,
      budget: amount
    });
  }
);

// ---------------- CSV EXPORT ----------------

app.get("/api/export.csv", auth, (req, res) => {
  const expenses = db.prepare(`
    SELECT title, category, date, amount
    FROM expenses
    WHERE user_id = ?
  `).all(req.user.id).map(item => ({
    ...item,
    type: "Expense"
  }));

  const incomes = db.prepare(`
    SELECT title, category, date, amount
    FROM income
    WHERE user_id = ?
  `).all(req.user.id).map(item => ({
    ...item,
    type: "Income"
  }));

  const rows = [
    ["Type", "Title", "Category", "Date", "Amount"],
    ...[...incomes, ...expenses]
      .sort((a, b) =>
        String(a.date).localeCompare(String(b.date))
      )
      .map(item => [
        item.type,
        item.title,
        item.category,
        item.date,
        item.amount
      ])
  ];

  const csv = "\uFEFF" + rows.map(row =>
    row.map(value => {
      let text = String(value ?? "");

      // Reduce spreadsheet formula injection risk.
      if (/^[\s]*[=+\-@]/.test(text)) {
        text = "'" + text;
      }

      return '"' + text.replace(/"/g, '""') + '"';
    }).join(",")
  ).join("\r\n");

  res.setHeader(
    "Content-Type",
    "text/csv; charset=utf-8"
  );

  res.setHeader(
    "Content-Disposition",
    'attachment; filename="finora-transactions.csv"'
  );

  res.send(csv);
});

// ---------------- UNKNOWN API ----------------

app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API endpoint not found."
  });
});

// ---------------- HOME ----------------

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

// ---------------- ERROR HANDLER ----------------

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (
    error instanceof SyntaxError &&
    error.status === 400 &&
    "body" in error
  ) {
    return res.status(400).json({
      error: "Invalid JSON request body."
    });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      error: "Request body is too large."
    });
  }

  console.error("Server error:", error);

  res.status(500).json({
    error: "Internal server error."
  });
});

// ---------------- START SERVER ----------------

app.listen(PORT, () => {
  console.log(
    `Expense Tracker running at http://localhost:${PORT}`
  );
});
