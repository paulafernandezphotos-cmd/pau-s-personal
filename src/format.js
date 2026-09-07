function timezone() {
return process.env.TIMEZONE || "America/Bogota";
}

function formatTime(isoString) {
if (!isoString) return null;
const date = new Date(isoString);
return new Intl.DateTimeFormat("es-CO", {
timeZone: timezone(),
weekday: "short",
hour: "numeric",
minute: "2-digit",
hour12: true,
}).format(date);
}

function describeItem(item) {
const who = item.assigned_to ? ` (${item.assigned_to})` : "";
if (item.kind === "task" && item.due_at) {
return `#${item.id} ${item.text}${who} - ${formatTime(item.due_at)}`;
}
return `#${item.id} ${item.text}${who}`;
}

function formatList(tasksWithTime, tasksNoTime, shoppingItems) {
const lines = [];
if (tasksWithTime.length || tasksNoTime.length) {
lines.push("*Tareas*");
for (const t of tasksWithTime) lines.push(describeItem(t));
for (const t of tasksNoTime) lines.push(describeItem(t));
}
if (shoppingItems.length) {
if (lines.length) lines.push("");
lines.push("*Mercado* 🛒");
for (const s of shoppingItems) lines.push(describeItem(s));
}
if (!lines.length) return "No hay nada pendiente. ¡De una! 🎉";
lines.push("");
lines.push('Para marcar algo como hecho: "listo <número>".');
return lines.join("\n");
}

function formatOffsetMinutes(mins) {
if (mins >= 60 && mins % 60 === 0) {
const h = mins / 60;
return `${h} hora${h === 1 ? "" : "s"}`;
}
if (mins >= 60) {
const h = Math.floor(mins / 60);
const m = mins % 60;
return `${h}h ${m}min`;
}
return `${mins} minuto${mins === 1 ? "" : "s"}`;
}

function formatOffsetsSummary(offsetsMinutesDesc) {
const parts = offsetsMinutesDesc.map(formatOffsetMinutes);
if (parts.length === 1) return parts[0];
return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

module.exports = { formatTime, describeItem, formatList, timezone, formatOffsetMinutes, formatOffsetsSummary };
