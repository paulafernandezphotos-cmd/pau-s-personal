// Centralizes reading the reminder-timing env vars so server.js and
// scheduler.js always agree on what's configured.

function reminderOffsetsMinutes() {
  const raw = process.env.REMINDER_OFFSETS_MINUTES || "120,15";
const offsets = raw
.split(",")
.map((s) => parseInt(s.trim(), 10))
.filter((n) => Number.isFinite(n) && n > 0);
const unique = Array.from(new Set(offsets));
return (unique.length ? unique : [120, 15]).sort((a, b) => b - a);
}

function dailyReminderCronExpr() {
  const raw = process.env.DAILY_REMINDER_TIME || "09:00";
const [hh, mm] = raw.split(":").map((s) => parseInt(s, 10));
const hour = Number.isFinite(hh) ? hh : 9;
const minute = Number.isFinite(mm) ? mm : 0;
return `${minute} ${hour} * * *`;
}

module.exports = { reminderOffsetsMinutes, dailyReminderCronExpr };
