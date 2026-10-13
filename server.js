const express = require("express");
const Database = require("better-sqlite3");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database(path.join(__dirname, "halo.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    q           TEXT PRIMARY KEY,
    code        TEXT NOT NULL DEFAULT '',
    transaction_id TEXT NOT NULL DEFAULT '',
    user_id     TEXT NOT NULL DEFAULT '',
    proxy_host  TEXT NOT NULL DEFAULT '',
    user_agent  TEXT NOT NULL DEFAULT '',
    samosa      TEXT NOT NULL DEFAULT '',
    liveness_id TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const getStmt = db.prepare("SELECT * FROM transactions WHERE q = ?");
const upsertStmt = db.prepare(`
  INSERT INTO transactions (q, code, transaction_id, user_id, proxy_host, user_agent, samosa)
  VALUES (@q, @code, @transaction_id, @user_id, @proxy_host, @user_agent, @samosa)
  ON CONFLICT(q) DO UPDATE SET
    code=@code, transaction_id=@transaction_id, user_id=@user_id,
    proxy_host=@proxy_host, user_agent=@user_agent, samosa=@samosa,
    updated_at=datetime('now')
`);
const patchStmt = db.prepare(`
  UPDATE transactions SET liveness_id = ?, updated_at = datetime('now') WHERE q = ?
`);
const listStmt = db.prepare("SELECT * FROM transactions ORDER BY updated_at DESC LIMIT 50");

// GET /api/v1/transaction/?q=<value>  — the app calls this
app.get("/api/v1/transaction/", (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: "missing q parameter" });

  const row = getStmt.get(q);
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
app.patch("/api/v1/transaction/", (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: "missing q parameter" });

  const row = getStmt.get(q);
  if (!row) return res.status(404).json({ error: "Transaction not found" });

  const livenessId = req.body.liveness_id;
  if (livenessId) {
    patchStmt.run(livenessId, q);
  }

  res.json({ status: "ok", liveness_id: livenessId });
});

// --- Management endpoints (for you, not the app) ---

// POST /api/v1/transaction  — create or update a transaction
app.post("/api/v1/transaction", (req, res) => {
  const { q, code, transaction_id, user_id, proxy_host, user_agent, samosa } = req.body;
  if (!q) return res.status(400).json({ error: "q is required" });

  upsertStmt.run({
    q,
    code: code || "",
    transaction_id: transaction_id || crypto.randomUUID(),
    user_id: user_id || crypto.randomUUID(),
    proxy_host: proxy_host || "",
    user_agent: user_agent || "",
    samosa: samosa || "",
  });

  res.json({ status: "created", q });
});

// GET /api/v1/transactions  — list all
app.get("/api/v1/transactions", (req, res) => {
  res.json(listStmt.all());
});

// Dashboard
app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html><head><title>Halo Backend</title>
<style>
  body{font-family:system-ui;max-width:900px;margin:40px auto;padding:0 20px;background:#111;color:#eee}
  h1{color:#7af}
  table{width:100%;border-collapse:collapse;margin-top:20px}
  th,td{padding:8px 12px;border:1px solid #333;text-align:left;font-size:13px}
  th{background:#222}
  form{background:#1a1a1a;padding:20px;border-radius:8px;margin-top:20px}
  input,button{padding:8px 12px;border:1px solid #444;border-radius:4px;background:#222;color:#eee;margin:4px}
  button{background:#25a;cursor:pointer}
  button:hover{background:#36b}
  label{display:inline-block;width:120px;font-size:14px}
  .row{margin:6px 0}
</style></head><body>
<h1>Halo Backend</h1>
<h3>Create / Update Transaction</h3>
<form id="f">
  <div class="row"><label>q (key)*</label><input name="q" required></div>
  <div class="row"><label>code</label><input name="code"></div>
  <div class="row"><label>transaction_id</label><input name="transaction_id" placeholder="auto-generated"></div>
  <div class="row"><label>user_id</label><input name="user_id" placeholder="auto-generated"></div>
  <div class="row"><label>proxy_host*</label><input name="proxy_host" required></div>
  <div class="row"><label>user_agent*</label><input name="user_agent" required></div>
  <div class="row"><label>samosa (api key)</label><input name="samosa"></div>
  <button type="submit">Save</button>
</form>
<h3>Transactions</h3>
<div id="tbl">Loading...</div>
<script>
async function load(){
  const r=await fetch('/api/v1/transactions');
  const rows=await r.json();
  if(!rows.length){document.getElementById('tbl').innerHTML='<p>No transactions yet.</p>';return}
  let h='<table><tr><th>q</th><th>code</th><th>txn_id</th><th>user_id</th><th>proxy</th><th>user_agent</th><th>liveness_id</th><th>updated</th></tr>';
  rows.forEach(r=>{h+='<tr><td>'+r.q+'</td><td>'+r.code+'</td><td>'+(r.transaction_id||'').slice(0,8)+'</td><td>'+(r.user_id||'').slice(0,8)+'</td><td>'+r.proxy_host+'</td><td>'+(r.user_agent||'').slice(0,40)+'</td><td>'+(r.liveness_id||'-')+'</td><td>'+r.updated_at+'</td></tr>'});
  h+='</table>';document.getElementById('tbl').innerHTML=h;
}
document.getElementById('f').onsubmit=async(e)=>{
  e.preventDefault();
  const fd=new FormData(e.target);
  const body=Object.fromEntries(fd);
  await fetch('/api/v1/transaction',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  e.target.reset();load();
};
load();
</script></body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Halo backend running on port ${PORT}`));
