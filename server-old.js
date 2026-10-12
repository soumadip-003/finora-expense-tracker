
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const db = new Database(path.join(__dirname, "expenses.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    category TEXT NOT NULL DEFAULT 'Other',
    date TEXT NOT NULL
  )
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/expenses", (req, res) => {
  const expenses = db
    .prepare("SELECT * FROM expenses ORDER BY date DESC, id DESC")
    .all();

  res.json(expenses);
});

app.post("/api/expenses", (req, res) => {
  const { title, amount, category, date } = req.body;

  if (
    typeof title !== "string" ||
    !title.trim() ||
    !Number.isFinite(Number(amount)) ||
    Number(amount) <= 0 ||
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return res.status(400).json({ error: "Invalid expense details." });
  }

  const result = db.prepare(`
    INSERT INTO expenses (title, amount, category, date)
    VALUES (?, ?, ?, ?)
  `).run(
    title.trim(),
    Number(amount),
    typeof category === "string" && category.trim()
      ? category.trim()
      : "Other",
    date
  );

  const expense = db
    .prepare("SELECT * FROM expenses WHERE id = ?")
    .get(result.lastInsertRowid);

  res.status(201).json(expense);
});

app.delete("/api/expenses/:id", (req, res) => {
  const result = db
    .prepare("DELETE FROM expenses WHERE id = ?")
    .run(Number(req.params.id));

  if (!result.changes) {
    return res.status(404).json({ error: "Expense not found." });
  }

  res.json({ success: true });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Expense Tracker running at http://localhost:${PORT}`);
});

