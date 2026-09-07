require("dotenv").config();
const express = require("express");
const { parseIncoming } = require("./parser");
const db = require("./db");
const { nameForPhone, allPhones } = require("./contacts");
const { sendMessage, sendToMany } = require("./whatsapp");
const { formatList, formatTime, formatOffsetsSummary, describeItem, timezone } = require("./format");
const { reminderOffsetsMinutes } = require("./config");
const { startScheduler } = require("./scheduler");
const { transcribeAudio } = require("./transcribe");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("WhatsApp household assistant is running."));

app.get("/webhook", (req, res) => {
const mode = req.query["hub.mode"];
const token = req.query["hub.verify_token"];
const challenge = req.query["hub.challenge"];

if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
return res.status(200).send(challenge);
}
return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
res.sendStatus(200);

try {
const entry = req.body?.entry?.[0];
const change = entry?.changes?.[0];
const message = change?.value?.messages?.[0];
if (!message) return;
if (message.type !== "text" && message.type !== "audio") return;

const fromPhone = message.from;
const senderName = nameForPhone(fromPhone);

if (!senderName) {
console.warn(`[webhook] message from unregistered number ${fromPhone}, ignoring`);
return;
}

let text;
if (message.type === "text") {
text = message.text?.body || "";
} else {
try {
text = await transcribeAudio(message.audio.id);
} catch (err) {
console.error("[webhook] transcription error:", err);
await sendMessage(fromPhone, "No pude escuchar bien ese audio. ¿Me lo escribes, porfa? 🙏");
return;
}
if (!text) {
await sendMessage(fromPhone, "No logré entender el audio, parce. ¿Me lo escribes?");
return;
}
await sendMessage(fromPhone, `🎤 Te escuché: "${text}"`);
}

await handleMessage({ text, fromPhone, senderName });
} catch (err) {
console.error("[webhook] error handling message:", err);
}
});

async function handleMessage({ text, fromPhone, senderName }) {
const action = parseIncoming(text, { referenceDate: new Date(), timezone: timezone() });

switch (action.type) {
case "help": {
await sendMessage(
fromPhone,
[
"¡Quiubo! Esto es lo que sé hacer:",
'- Mándame una tarea, ej: "Pau tiene que llamar a la DIAN a las 3pm" o "llamar al plomero mañana a las 4pm".',
"- ¿Sin hora exacta? Queda en la lista y te recuerdo una vez al día hasta que la marques.",
'- Mercado: "compra: leche, huevos, pan" (o "buy: ...") agrega al mercado compartido.',
'- "lista" te muestra todo lo pendiente.',
'- "listo <número>" marca algo como hecho.',
"- También puedes mandarme un audio en vez de escribir.",
].join("\n")
);
return;
}

case "list": {
const tasks = db.listOpen("task");
const tasksWithTime = tasks.filter((t) => t.due_at);
const tasksNoTime = tasks.filter((t) => !t.due_at);
const shopping = db.listOpen("shopping");
await sendMessage(fromPhone, formatList(tasksWithTime, tasksNoTime, shopping));
return;
}

case "done_invalid": {
await sendMessage(fromPhone, 'Escribe "listo <número>", ej: "listo 3". Escribe "lista" para ver los números.');
return;
}

case "done": {
const item = db.getItem(action.id);
const ok = item && !item.done && db.markDone(action.id);
if (!ok) {
await sendMessage(fromPhone, `No encontré una pendiente #${action.id} abierta.`);
return;
}
await sendToMany(allPhones(), `✅ ${senderName} marcó la #${action.id} como lista: "${item.text}"`);
return;
}

case "shopping_add": {
const added = action.items.map((itemText) =>
db.addItem({ kind: "shopping", text: itemText, createdBy: senderName })
);
const lines = added.map((i) => `#${i.id} ${i.text}`).join("\n");
await sendToMany(allPhones(), `🛒 ${senderName} agregó al mercado:\n${lines}`);
return;
}

case "task_add": {
const dueAtIso = action.dueAt ? action.dueAt.toISOString() : null;
const item = db.addItem({
kind: "task",
text: action.text,
assignedTo: action.assignedTo || senderName,
createdBy: senderName,
dueAt: dueAtIso,
});
const forWhom = item.assigned_to ? ` para ${item.assigned_to}` : "";

if (dueAtIso) {
const offsetsSummary = formatOffsetsSummary(reminderOffsetsMinutes());

const windowMinutes = parseInt(process.env.CONFLICT_WINDOW_MINUTES, 10) || 60;
const conflicts = db.nearbyTasks(dueAtIso, windowMinutes, item.id);
const conflictLines = conflicts.length
? "\n⚠️ Ojo, ya tienes algo cerca de esa hora:\n" + conflicts.map((c) => describeItem(c)).join("\n")
: "";

await sendToMany(
allPhones(),
`📌 ${senderName} agregó la #${item.id}${forWhom}: "${item.text}" - a las ${formatTime(dueAtIso)}. Les aviso ${offsetsSummary} antes.${conflictLines}`
);
} else {
await sendToMany(
allPhones(),
`📌 ${senderName} agregó la #${item.id}${forWhom}: "${item.text}" - sin hora fija, así que les recuerdo una vez al día hasta que quede lista.`
);
}
return;
}

default: {
await sendMessage(fromPhone, 'No entendí eso, parce. Escribe "ayuda" para ver qué sí entiendo.');
return;
}
}
}

app.listen(PORT, () => {
console.log(`Server listening on port ${PORT}`);
startScheduler({ sendToMany, allPhones });
});

module.exports = app;
