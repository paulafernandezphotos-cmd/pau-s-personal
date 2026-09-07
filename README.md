# WhatsApp Household Assistant

A small WhatsApp bot for two people to share: text it a task or a shopping
item, and it remembers it for both of you.

- **"Pau needs to call DIAN at 3 pm"** -> adds a task due at 3pm, confirms
right away, and reminds both of you twice: 2 hours before, and again 15
minutes before (both configurable).
- **"buy milk, eggs, bread"** (or **"compra: leche, huevos, pan"**) -> adds
items to a shared shopping list.
- A task with **no exact time** (e.g. "call the plumber") gets nudged once
a day until someone marks it done.
- Adding a timed task **warns you if something else is already due around
the same time** (within 60 minutes by default, configurable).
- **"list"** / **"lista"** -> shows everything open.
- **"done 4"** / **"listo 4"** -> marks item #4 done.
- The bot replies in **Colombian Spanish**. It still understands messages
in English or Spanish either way - only what it says back changed.
- **Send it a voice note instead of typing** - it transcribes it (via Groq's
Whisper API), tells you what it heard, then handles it exactly like a
typed message.

It runs as a small always-on web server (so it can send reminders even when
nobody has the app open), talking to WhatsApp through Meta's official
**WhatsApp Cloud API** (free for personal use at this volume).

### Why messages go to you both individually, not into a WhatsApp group

Meta's official WhatsApp Business API cannot send into a WhatsApp group you
already created - that's a consumer-app feature it deliberately doesn't
support. It *can* create a brand-new group through a separate "Groups API",
but only for accounts with **Official Business Account (OBA)** status -
Meta's blue-badge verification. That requires the business to be a
"well-known or frequently searched" brand with at least 5 mentions in major
news outlets in the past year - it's built for recognizable companies, not
personal projects, and there's no way around that requirement.

So instead, the bot gets you the same practical result without a group:
**every add and every "done" is broadcast to both of your numbers**, not
just replied to whoever sent it - so you both always see who added what,
who it's for, and what got checked off, in real time. The only thing you
lose versus a real group is a single shared thread where you can also reply
to each other's messages inline; you're each in a 1:1 chat with the bot,
and the bot keeps you both synced.

---

## 1. Set up WhatsApp Cloud API (Meta)

Already done for this project - the app "Asistente del Hogar" is created,
with a permanent token and phone number ID already in your `.env`.

## 1b. Set up voice notes (optional)

Already done - your Groq API key is already in `.env`.

## 2. Configure the app

Your `.env` file already has `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_VERIFY_TOKEN`, `ALLOWED_NUMBERS` (Pau and Mar), and `GROQ_API_KEY`
filled in. Adjust `REMINDER_OFFSETS_MINUTES` (default `120,15`) and
`DAILY_REMINDER_TIME` (default `09:00`) if you want something different.

## 3. Deploy (Railway)

Railway is the recommended host: it stays running 24/7 (needed for the
reminder scheduler), supports a persistent disk for the database, and costs
around **$5/month** on the Hobby plan.

1. Add all the variables from your `.env` file in Railway's **Variables**
tab (Railway won't read your local `.env` file automatically).
2. Add a **Volume**, mount it at `/data`, and set the env var
`DB_PATH=/data/app.db` so your list survives redeploys.
3. Once deployed, Railway gives you a public URL like
`https://your-app.up.railway.app`.

## 4. Point Meta's webhook at your deployed app

1. Back in **developers.facebook.com -> your app -> WhatsApp -> Configuration**.
2. Set the **Callback URL** to `https://your-app.up.railway.app/webhook`.
3. Set **Verify token** to the same string you put in `WHATSAPP_VERIFY_TOKEN`.
4. Click **Verify and save** - Meta will call your server to confirm.
5. Subscribe to the **messages** webhook field.

## 5. Try it

Text your test number "ayuda" from one of the allowed numbers. Then try:
"Pau necesita llamar a la DIAN a las 3pm", "compra: leche, huevos", and
"lista".

---

## Notes / things you might want to change later

- **Moving off the test number**: Meta's test numbers work fine for two
people indefinitely, but if you ever want a "real" WhatsApp Business
number instead, you'd register one in the same WhatsApp product settings.
- **More people**: add more `Name:Phone` pairs to `ALLOWED_NUMBERS`.
- **Different reminder timing**: change `REMINDER_OFFSETS_MINUTES` /
`DAILY_REMINDER_TIME` in your env vars - no code changes needed.
