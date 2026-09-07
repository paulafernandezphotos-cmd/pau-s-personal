require("dotenv").config();
const express = require("express");
const { parseIncoming, extractTaskDetails } = require("./parser");
const db = require("./db");
const { nameForPhone, allPhones } = require("./contacts");
const { sendMessage, sendToMany } = require("./whatsapp");
const { formatList, formatTime, formatOffsetsSummary, describeItem, timezone } = require("./format");
const { reminderOffsetsMinutes } = require("./config");
const { startScheduler } = require("./scheduler");
const { transcribeAudio } = require("./transcribe");
const { classifyMessage } = require("./ai");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("WhatsApp household assistant is running."));

// --- Webhook verification (Meta calls this once when you set the webhook) ---
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- Incoming messages ---
app.post("/webhook", async (req, res) => {
  // Always ack quickly so Meta doesn't retry/backoff on us.
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];

    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (!message) return; // e.g. delivery/read status callbacks
    if (message.type !== "text" && message.type !== "audio") return; // ignore images, stickers, etc.

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
      // Voice note / audio message - transcribe it first, then handle it
      // exactly like a typed message.
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

const HELP_TEXT = [
  "¡Quiubo! Esto es lo que sé hacer:",
  '- Mándame una tarea, ej: "Pau tiene que llamar a la DIAN a las 3pm" o "llamar al plomero mañana a las 4pm".',
  "- ¿Sin hora exacta? Queda en la lista y te recuerdo una vez al día hasta que la marques.",
  '- Mercado: "compra: leche, huevos, pan" (o "buy: ...") agrega al mercado compartido.',
  '- "lista" te muestra todo lo pendiente.',
  '- "listo <número>" marca algo como hecho.',
  "- Si después quieres que divida algo que agregaste en varias tareas, solo dímelo (ej: \"divide eso en dos\").",
  "- También puedes mandarme un audio en vez de escribir.",
  ].join("\n");

async function sendListMessage(fromPhone) {
  const tasks = db.listOpen("task");
  const tasksWithTime = tasks.filter((t) => t.due_at);
  const tasksNoTime = tasks.filter((t) => !t.due_at);
  const shopping = db.listOpen("shopping");
  await sendMessage(fromPhone, formatList(tasksWithTime, tasksNoTime, shopping));
}

async function addShoppingItemsAndNotify({ items, senderName }) {
  const added = items.map((itemText) => db.addItem({ kind: "shopping", text: itemText, createdBy: senderName }));
  const lines = added.map((i) => `#${i.id} ${i.text}`).join("\n");
  await sendToMany(allPhones(), `🛒 ${senderName} agregó al mercado:\n${lines}`);
  return added;
}

async function addTaskAndNotify({ text, dueAt, assignedTo, senderName }) {
  const dueAtIso = dueAt ? dueAt.toISOString() : null;
  // If no household member's name was mentioned in the message, the
  // task defaults to whoever sent it - so ownership is always visible,
  // and either of you can override it just by naming the other person
  // ("Pau needs to..." / "recuérdale a Pau...").
  const item = db.addItem({
    kind: "task",
    text,
    assignedTo: assignedTo || senderName,
    createdBy: senderName,
    dueAt: dueAtIso,
  });
  const forWhom = item.assigned_to ? ` para ${item.assigned_to}` : "";

  if (dueAtIso) {
    const offsetsSummary = formatOffsetsSummary(reminderOffsetsMinutes());

    // "¿Ya tenías algo más a esa hora?" - warn about a possible clash.
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
  return item;
}

// Replaces `original` with one new item per string in `texts` - used when
// someone asks to split their last message into several separate items
// instead of the one that got added. Timed/assigned tasks re-run the same
// date/name extraction per split piece (so "llamar al plomero" / "comprar
// el repuesto mañana a las 5" can each pick up their own time), falling
// back to the original item's time/assignee when a piece doesn't mention
// its own.
async function splitItemAndNotify({ original, texts, senderName }) {
  db.deleteItem(original.id);

  const created = [];
  for (const rawText of texts) {
    const text = (rawText || "").trim();
    if (!text) continue;

    if (original.kind === "shopping") {
      created.push(db.addItem({ kind: "shopping", text, createdBy: senderName }));
      continue;
    }

    const { dueAt, assignedTo } = extractTaskDetails(text, { referenceDate: new Date() });
    const dueAtIso = dueAt ? dueAt.toISOString() : original.due_at || null;
    created.push(
      db.addItem({
        kind: "task",
        text,
        assignedTo: assignedTo || original.assigned_to || senderName,
        createdBy: senderName,
        dueAt: dueAtIso,
      })
      );
  }

  const lines = created.map((i) => describeItem(i)).join("\n");
  await sendToMany(allPhones(), `✂️ ${senderName} dividió la #${original.id} ("${original.text}") en:\n${lines}`);
  return created;
}

async function handleMessage({ text, fromPhone, senderName }) {
  const action = parseIncoming(text, { referenceDate: new Date(), timezone: timezone() });

  switch (action.type) {
    case "help": {
      await sendMessage(fromPhone, HELP_TEXT);
      return;
    }

    case "list": {
      await sendListMessage(fromPhone);
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
      // Broadcast to both numbers, not just the sender - this is lo que
      // los mantiene sincronizados sin un grupo compartido de verdad:
      // cada tarea agregada o marcada la ven los dos, con quién la hizo.
      await sendToMany(allPhones(), `✅ ${senderName} marcó la #${action.id} como lista: "${item.text}"`);
      return;
    }

    case "shopping_add": {
      await addShoppingItemsAndNotify({ items: action.items, senderName });
      return;
    }

      // parseIncoming's catch-all: anything that isn't one of the fixed
      // commands above lands here as a literal "add this as a task". Before
      // doing that, ask the AI classifier what the sender actually meant -
      // it might be a follow-up about the item they just added ("divide eso
      // en dos"), a shopping item phrased differently, or just a question -
      // rather than a brand-new task made of their literal words. Any
      // failure/timeout there falls back to the original plain behavior.
    case "task_add": {
      const lastItem = db.lastOpenItemBySender(senderName);
      const ai = await classifyMessage(text, { timezone: timezone(), senderName, lastItem });

      if (ai?.action === "split_task" && lastItem && Array.isArray(ai.split_texts) && ai.split_texts.length >= 2) {
        await splitItemAndNotify({ original: lastItem, texts: ai.split_texts, senderName });
        return;
      }

      if (ai?.action === "shopping_add" && Array.isArray(ai.shopping_items) && ai.shopping_items.length) {
        await addShoppingItemsAndNotify({ items: ai.shopping_items, senderName });
        return;
      }

      if (ai?.action === "list") {
        await sendListMessage(fromPhone);
        return;
      }

      if (ai?.action === "help") {
        await sendMessage(fromPhone, HELP_TEXT);
        return;
      }

      if (ai?.action === "chat" && ai.reply) {
        await sendMessage(fromPhone, ai.reply);
        return;
      }

      // AI unavailable/failed, or it agreed this is genuinely just a new
      // task - use the deterministic parse from parseIncoming as before.
      const taskText = ai?.action === "task_add" && ai.task_text ? ai.task_text : action.text;
      await addTaskAndNotify({ text: taskText, dueAt: action.dueAt, assignedTo: action.assignedTo, senderName });
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

