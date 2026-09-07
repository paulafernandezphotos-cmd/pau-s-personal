const GRAPH_VERSION = "v21.0";

function apiUrl() {
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
return `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
}

async function sendMessage(toPhone, body) {
const token = process.env.WHATSAPP_TOKEN;
if (!token || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
console.warn("[whatsapp] Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID - message not sent:", body);
return { skipped: true };
}

const res = await fetch(apiUrl(), {
method: "POST",
headers: {
Authorization: `Bearer ${token}`,
"Content-Type": "application/json",
},
body: JSON.stringify({
messaging_product: "whatsapp",
to: toPhone,
type: "text",
text: { body },
}),
});

if (!res.ok) {
const errText = await res.text().catch(() => "");
console.error(`[whatsapp] send failed (${res.status}) to ${toPhone}:`, errText);
}
return res;
}

async function sendToMany(phones, body) {
await Promise.all(phones.map((phone) => sendMessage(phone, body)));
}

module.exports = { sendMessage, sendToMany };
