// Parses ALLOWED_NUMBERS="Pau:573001112233,Ale:573004445566" into lookup maps.

function parseContacts(raw) {
  const byPhone = new Map();
const byName = new Map();
(raw || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .forEach((pair) => {
  const [name, phone] = pair.split(":").map((s) => s.trim());
if (!name || !phone) return;
byPhone.set(phone, name);
byName.set(name.toLowerCase(), phone);
});
return { byPhone, byName };
}

const { byPhone, byName } = parseContacts(process.env.ALLOWED_NUMBERS);

function nameForPhone(phone) {
  return byPhone.get(phone) || null;
}

function allPhones() {
  return Array.from(byPhone.keys());
}

function allNames() {
  return Array.from(byName.keys());
}

// Finds any known household member's name mentioned in a piece of text,
// e.g. "Pau needs to call DIAN at 3pm" -> "Pau". Used to figure out who
// a task is *for*, which may differ from who sent the message.
function findMentionedName(text) {
  const lower = text.toLowerCase();
for (const name of byName.keys()) {
const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
if (re.test(lower)) {
for (const p of byPhone.keys()) {
if (byPhone.get(p).toLowerCase() === name) return byPhone.get(p);
}
}
}
return null;
}

module.exports = { nameForPhone, allPhones, allNames, findMentionedName };
