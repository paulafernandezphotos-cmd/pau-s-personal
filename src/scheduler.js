const cron = require("node-cron");
const db = require("./db");
const { formatTime, formatOffsetMinutes, timezone, describeItem } = require("./format");
const { reminderOffsetsMinutes, dailyReminderCronExpr } = require("./config");

function startScheduler({ sendToMany, allPhones }) {
const phones = allPhones();
if (phones.length === 0) {
console.warn("[scheduler] No ALLOWED_NUMBERS configured - reminders have nowhere to send.");
}

const offsets = reminderOffsetsMinutes();

cron.schedule(
"* * * * *",
async () => {
const now = Date.now();
const tasks = db.openTasksWithDueDate();

for (const item of tasks) {
const dueTime = new Date(item.due_at).getTime();
const alreadySent = db.sentOffsets(item);

for (const offset of offsets) {
if (alreadySent.has(String(offset))) continue;
const triggerAt = dueTime - offset * 60 * 1000;
if (now < triggerAt) continue;

const body = `⏰ ¡Ojo! "${item.text}"${item.assigned_to ? ` (${item.assigned_to})` : ""} es a las ${formatTime(item.due_at)} (faltan ${formatOffsetMinutes(offset)}).`;
await sendToMany(phones, body);
db.markReminderOffsetSent(item.id, offset);
alreadySent.add(String(offset));
}
}
},
{ timezone: timezone() }
);

cron.schedule(
dailyReminderCronExpr(),
async () => {
const open = db.openTasksWithoutDueDate();
if (open.length === 0) return;
const lines = open.map((item) => describeItem(item));
const body = ["📋 Recordatorio del día - esto sigue pendiente (sin hora fija):", ...lines].join("\n");
await sendToMany(phones, body);
},
{ timezone: timezone() }
);

console.log(
`[scheduler] started - reminders at ${offsets.map(formatOffsetMinutes).join(" / ")} before due, daily digest at ${process.env.DAILY_REMINDER_TIME || "09:00"} (${timezone()})`
);
}

module.exports = { startScheduler };
