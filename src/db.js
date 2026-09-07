const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || "./data/app.db";

// Make sure the folder for the db file exists (important for a mounted
// volume path like /data/app.db on first boot).
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS items (
id INTEGER PRIMARY KEY AUTOINCREMENT,
kind TEXT NOT NULL CHECK(kind IN ('task','shopping')),
text TEXT NOT NULL,
assigned_to TEXT,
created_by TEXT,
due_at TEXT,
done INTEGER NOT NULL DEFAULT 0,
reminders_sent TEXT NOT NULL DEFAULT '',
created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function addItem({ kind, text, assignedTo, createdBy, dueAt }) {
const stmt = db.prepare(`
INSERT INTO items (kind, text, assigned_to, created_by, due_at)
VALUES (@kind, @text, @assignedTo, @createdBy, @dueAt)
`);
const info = stmt.run({
kind,
text,
assignedTo: assignedTo || null,
createdBy: createdBy || null,
dueAt: dueAt || null,
});
return getItem(info.lastInsertRowid);
}

function getItem(id) {
return db.prepare(`SELECT * FROM items WHERE id = ?`).get(id);
}

function markDone(id) {
const info = db.prepare(`UPDATE items SET done = 1 WHERE id = ? AND done = 0`).run(id);
return info.changes > 0;
}

function listOpen(kind) {
return db
.prepare(`SELECT * FROM items WHERE kind = ? AND done = 0 ORDER BY due_at IS NULL, due_at ASC, id ASC`)
.all(kind);
}

function openTasksWithDueDate() {
return db
.prepare(`SELECT * FROM items WHERE kind = 'task' AND done = 0 AND due_at IS NOT NULL`)
.all();
}

function sentOffsets(item) {
return new Set((item.reminders_sent || "").split(",").filter(Boolean));
}

function markReminderOffsetSent(id, offsetMinutes) {
const item = getItem(id);
const offsets = sentOffsets(item);
offsets.add(String(offsetMinutes));
db.prepare(`UPDATE items SET reminders_sent = ? WHERE id = ?`).run(Array.from(offsets).join(","), id);
}

function nearbyTasks(dueAtIso, windowMinutes, excludeId) {
return db
.prepare(`
SELECT * FROM items
WHERE kind = 'task' AND done = 0 AND due_at IS NOT NULL AND id != ?
AND ABS((julianday(due_at) - julianday(?)) * 1440) <= ?
ORDER BY due_at ASC
`)
.all(excludeId, dueAtIso, windowMinutes);
}

function openTasksWithoutDueDate() {
return db
.prepare(`SELECT * FROM items WHERE kind = 'task' AND done = 0 AND due_at IS NULL ORDER BY id ASC`)
.all();
}

function deleteItem(id) {
    const info = db.prepare(`DELETE FROM items WHERE id = ?`).run(id);
    return info.changes > 0;
}

// The most recent still-open item a given person added - used to resolve
// follow-up references like "split that into two" ("eso"/"esa tarea").
function lastOpenItemBySender(createdBy) {
    if (!createdBy) return null;
    return db
      .prepare(`SELECT * FROM items WHERE created_by = ? AND done = 0 ORDER BY id DESC LIMIT 1`)
      .get(createdBy);
}

module.exports = {
db,
addItem,
getItem,
markDone,
listOpen,
openTasksWithDueDate,
sentOffsets,
markReminderOffsetSent,
nearbyTasks,
openTasksWithoutDueDate,
  deleteItem,
  lastOpenItemBySender,
};
