const chrono = require("chrono-node");
const { findMentionedName } = require("./contacts");

const SHOPPING_TRIGGERS = ["compra", "comprar", "compras", "super", "mercado", "supermercado", "buy", "shopping"];
const LIST_WORDS = ["list", "lista", "listar", "ver lista"];
const DONE_WORDS = ["done", "listo", "hecho", "completado", "complete"];
const HELP_WORDS = ["help", "ayuda"];

function firstWord(text) {
return text.trim().split(/\s+/)[0]?.toLowerCase() || "";
}

function stripLeadingWord(text) {
return text.trim().split(/\s+/).slice(1).join(" ").trim();
}

/**
* Turns one inbound WhatsApp message into a structured action.
*
* Returns one of:
*  { type: 'help' }
*  { type: 'list' }
*  { type: 'done', id: number }
*  { type: 'done_invalid' }
*  { type: 'shopping_add', items: string[] }
*  { type: 'task_add', text: string, dueAt: Date|null, assignedTo: string|null }
*  { type: 'unrecognized' }
*/
function parseIncoming(rawText, { referenceDate = new Date(), timezone = "America/Bogota" } = {}) {
const text = (rawText || "").trim();
if (!text) return { type: "unrecognized" };

const first = firstWord(text);
const lower = text.toLowerCase();

if (HELP_WORDS.includes(first)) return { type: "help" };
if (LIST_WORDS.includes(first) || lower === "ver lista") return { type: "list" };

if (DONE_WORDS.includes(first)) {
const rest = stripLeadingWord(text);
const match = rest.match(/\d+/);
if (!match) return { type: "done_invalid" };
return { type: "done", id: parseInt(match[0], 10) };
}

if (SHOPPING_TRIGGERS.includes(first)) {
let rest = stripLeadingWord(text);
rest = rest.replace(/^:\s*/, "");
if (!rest) return { type: "unrecognized" };
const items = rest
.split(",")
.map((s) => s.trim())
.filter(Boolean);
return { type: "shopping_add", items };
}

let parsedDate = null;
const esResults = chrono.es.parse(text, referenceDate, { forwardDate: true });
if (esResults.length > 0 && esResults[0].start.isCertain("hour")) {
parsedDate = esResults[0].start.date();
} else {
const enResults = chrono.en.parse(text, referenceDate, { forwardDate: true });
if (enResults.length > 0 && enResults[0].start.isCertain("hour")) {
parsedDate = enResults[0].start.date();
}
}

const assignedTo = findMentionedName(text);

return {
type: "task_add",
text,
dueAt: parsedDate,
assignedTo,
};
}

module.exports = { parseIncoming, SHOPPING_TRIGGERS, LIST_WORDS, DONE_WORDS, HELP_WORDS };
