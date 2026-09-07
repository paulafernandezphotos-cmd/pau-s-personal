// AI-based intent understanding, used as a fallback for messages that
// don't match one of the bot's fixed, deterministic commands (help / list /
// "listo <n>" / "compra: ..."). Everything else used to be dumped straight
// into the shopping/task list as literal text - including things like
// "¿puedes hacer que sean dos tareas diferentes?", which isn't a new task
// at all, it's a follow-up about the thing that was *just* added.
//
// This module asks Groq's chat API (same provider as the voice-note
// transcription) to classify one incoming message, given a little context
// (who's writing, and the last still-open item they added, if any), and
// return a small structured action for server.js to act on.
//
// Failure is always safe: any error, timeout, or malformed response here
// returns null, and the caller falls back to the old "just add it as a
// task" behavior - a Groq outage should never make the bot unusable.

const GROQ_CHAT_MODEL = process.env.GROQ_CHAT_MODEL || "llama-3.3-70b-versatile";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const TIMEOUT_MS = 8000;

const VALID_ACTIONS = new Set(["task_add", "shopping_add", "split_task", "list", "help", "chat"]);

function describeLastItem(lastItem, senderName) {
  if (!lastItem) return `${senderName} has not added anything that's still open recently.`;
  const when = lastItem.due_at ? `due at ${lastItem.due_at}` : "with no set time";
  const who = lastItem.assigned_to ? `, assigned to ${lastItem.assigned_to}` : "";
  return (
    `The last thing ${senderName} added and is still open is item #${lastItem.id} ` +
    `(a ${lastItem.kind === "shopping" ? "shopping list item" : "task"}): "${lastItem.text}", ${when}${who}.`
    );
}

function buildSystemPrompt({ timezone, nowIso, senderName, lastItem }) {
  return `You are the message-understanding brain for a small household WhatsApp bot shared by two people in Colombia. You read ONE incoming WhatsApp message and decide what the bot should do with it. You output ONLY a single JSON object - no prose, no markdown fences, no explanation.

  Context:
  - Current date/time: ${nowIso} (timezone: ${timezone})
  - Message sender: ${senderName}
  - ${describeLastItem(lastItem, senderName)}

  Choose exactly one "action":
  - "task_add": the message describes a new to-do/errand/reminder for the household. Include "task_text": the task itself, cleaned up, in the sender's own words/language.
  - "shopping_add": the message lists one or more items to add to the shared shopping list. Include "shopping_items": an array of item strings.
  - "split_task": the sender is asking to break their LAST item (see context above) into two or more separate items, instead of the one that's there now. Only choose this if a last item exists in the context AND the message clearly refers back to it (e.g. "eso", "esa tarea", "lo que acabo de mandar", "that", "split it"). Include "split_texts": an array of 2+ strings, one per new item, in the sender's language.
  - "list": the sender wants to see everything currently pending.
  - "help": the sender is asking what the bot can do / how to use it.
  - "chat": anything else - a question, comment, correction, or small talk that doesn't map to changing the list. Include "reply": a short, warm reply (1-2 sentences, Colombian Spanish unless the sender clearly wrote in English, no markdown/lists).

  Rules:
  - If the message is unambiguously just a new errand/reminder, use "task_add".
  - If the message is about reorganizing, correcting, or splitting something that was JUST added, do NOT also invent a brand-new unrelated task - use "split_task" or "chat".
  - Never invent action types outside the six listed.
  - Output ONLY the JSON object.`;
}

async function classifyMessage(text, { timezone, senderName, lastItem }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

const systemPrompt = buildSystemPrompt({
  timezone,
  nowIso: new Date().toISOString(),
  senderName,
  lastItem,
});

const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

try {
  const res = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_CHAT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
        ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 500,
    }),
    signal: controller.signal,
  });

  if (!res.ok) {
    console.error("[ai] Groq chat error", res.status, await res.text().catch(() => ""));
    return null;
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("[ai] could not parse Groq JSON output:", raw);
    return null;
  }

  if (!parsed || !VALID_ACTIONS.has(parsed.action)) {
    console.error("[ai] unexpected action from Groq:", parsed);
    return null;
  }
  return parsed;
} catch (err) {
  console.error("[ai] classifyMessage failed:", err.message || err);
  return null;
} finally {
  clearTimeout(timer);
}
}

module.exports = { classifyMessage };
