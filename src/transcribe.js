const GRAPH_VERSION = "v21.0";

async function downloadWhatsAppMedia(mediaId) {
const token = process.env.WHATSAPP_TOKEN;

const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
headers: { Authorization: `Bearer ${token}` },
});
if (!metaRes.ok) throw new Error(`No pude obtener el audio de WhatsApp (${metaRes.status})`);
const meta = await metaRes.json();

const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
if (!fileRes.ok) throw new Error(`No pude descargar el audio (${fileRes.status})`);

const arrayBuffer = await fileRes.arrayBuffer();
return { arrayBuffer, mimeType: meta.mime_type || "audio/ogg" };
}

async function transcribeAudio(mediaId) {
if (!process.env.GROQ_API_KEY) {
throw new Error("Falta configurar GROQ_API_KEY.");
}

const { arrayBuffer, mimeType } = await downloadWhatsAppMedia(mediaId);

const form = new FormData();
form.append("file", new Blob([arrayBuffer], { type: mimeType }), "audio.ogg");
form.append("model", process.env.GROQ_WHISPER_MODEL || "whisper-large-v3-turbo");

const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
method: "POST",
headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
body: form,
});

if (!res.ok) {
const errText = await res.text().catch(() => "");
throw new Error(`Groq no pudo transcribir el audio (${res.status}): ${errText}`);
}

const data = await res.json();
return (data.text || "").trim();
}

module.exports = { transcribeAudio };
