const express = require("express");
const Database = require("better-sqlite3");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database(path.join(__dirname, "halo.db"));
db.pragma("journal_mode = WAL");

db.exec(
  "CREATE TABLE IF NOT EXISTS transactions (" +
  "q TEXT PRIMARY KEY," +
  "code TEXT NOT NULL DEFAULT ''," +
  "transaction_id TEXT NOT NULL DEFAULT ''," +
  "user_id TEXT NOT NULL DEFAULT ''," +
  "proxy_host TEXT NOT NULL DEFAULT ''," +
  "user_agent TEXT NOT NULL DEFAULT ''," +
  "samosa TEXT NOT NULL DEFAULT ''," +
  "liveness_id TEXT," +
  "created_at TEXT NOT NULL DEFAULT (datetime('now'))," +
  "updated_at TEXT NOT NULL DEFAULT (datetime('now')))"
);

const getStmt = db.prepare("SELECT * FROM transactions WHERE q = ?");
const upsertStmt = db.prepare(
  "INSERT INTO transactions (q, code, transaction_id, user_id, proxy_host, user_agent, samosa) " +
  "VALUES (@q, @code, @transaction_id, @user_id, @proxy_host, @user_agent, @samosa) " +
  "ON CONFLICT(q) DO UPDATE SET " +
  "code=@code, transaction_id=@transaction_id, user_id=@user_id, " +
  "proxy_host=@proxy_host, user_agent=@user_agent, samosa=@samosa, " +
  "updated_at=datetime('now')"
);
const patchStmt = db.prepare(
  "UPDATE transactions SET liveness_id = ?, updated_at = datetime('now') WHERE q = ?"
);
const listStmt = db.prepare("SELECT * FROM transactions ORDER BY updated_at DESC LIMIT 50");
const deleteStmt = db.prepare("DELETE FROM transactions WHERE q = ?");

// GET /api/v1/transaction/?q=<value>  — the app calls this
app.get("/api/v1/transaction/", function(req, res) {
  var q = req.query.q;
  if (!q) return res.status(400).json({ error: "missing q parameter" });
  var row = getStmt.get(q);
  if (!row) return res.status(404).json({ error: "Transaction not found" });
  res.json({
    code: row.code,
    transaction_id: row.transaction_id,
    user_id: row.user_id,
    proxy_host: row.proxy_host,
    user_agent: row.user_agent,
    samosa: row.samosa,
  });
});

// PATCH /api/v1/transaction/?q=<value>  — the app calls this after liveness
app.patch("/api/v1/transaction/", function(req, res) {
  var q = req.query.q;
  if (!q) return res.status(400).json({ error: "missing q parameter" });
  var row = getStmt.get(q);
  if (!row) return res.status(404).json({ error: "Transaction not found" });
  var livenessId = req.body.liveness_id;
  if (livenessId) {
    patchStmt.run(livenessId, q);
  }
  res.json({ status: "ok", liveness_id: livenessId });
});

// POST /api/v1/transaction  — create or update a transaction
app.post("/api/v1/transaction", function(req, res) {
  var body = req.body;
  var q = body.q;
  if (!q) return res.status(400).json({ error: "q is required" });
  var finalQ = q === "__auto__" ? crypto.randomBytes(4).toString("hex") : q;
  upsertStmt.run({
    q: finalQ,
    code: body.code || "",
    transaction_id: body.transaction_id || crypto.randomUUID(),
    user_id: body.user_id || crypto.randomUUID(),
    proxy_host: body.proxy_host || "",
    user_agent: body.user_agent || "",
    samosa: body.samosa || "",
  });
  res.json({ status: "created", q: finalQ });
});

// DELETE /api/v1/transaction?q=<value>
app.delete("/api/v1/transaction", function(req, res) {
  var q = req.query.q;
  if (!q) return res.status(400).json({ error: "missing q parameter" });
  deleteStmt.run(q);
  res.json({ status: "deleted" });
});

// GET /api/v1/transactions  — list all
app.get("/api/v1/transactions", function(req, res) {
  res.json(listStmt.all());
});

// Dashboard
app.get("/", function(req, res) {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log("Halo backend running on port " + PORT);
});
