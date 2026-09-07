// Quick manual test script (not a full test framework).
// Run with: npm test
// Requires ALLOWED_NUMBERS to be set (see .env.example) so name-mention
// detection has something to match against.
process.env.ALLOWED_NUMBERS = process.env.ALLOWED_NUMBERS || "Pau:573000000000,Ale:573000000001";

const assert = require("assert");
const { parseIncoming } = require("../src/parser");

const ref = new Date("2026-09-07T14:00:00-05:00");
const opts = { referenceDate: ref, timezone: "America/Bogota" };

function check(label, fn) {
try {
fn();
console.log(`ok - ${label}`);
} catch (err) {
console.error(`FAIL - ${label}`);
console.error(err);
process.exitCode = 1;
}
}

check("timed task in English, from the spec example", () => {
const r = parseIncoming("Pau needs to call DIAN at 3 pm", opts);
assert.strictEqual(r.type, "task_add");
assert.ok(r.dueAt, "expected a due date to be parsed");
assert.strictEqual(r.dueAt.getHours(), 15);
assert.strictEqual(r.assignedTo, "Pau");
});

check("timed task in Spanish", () => {
const r = parseIncoming("Pau necesita llamar a la DIAN a las 3pm", opts);
assert.strictEqual(r.type, "task_add");
assert.ok(r.dueAt, "expected a due date to be parsed");
assert.strictEqual(r.dueAt.getHours(), 15);
assert.strictEqual(r.assignedTo, "Pau");
});

check("task with no time goes to daily-digest bucket", () => {
const r = parseIncoming("llamar al plomero", opts);
assert.strictEqual(r.type, "task_add");
assert.strictEqual(r.dueAt, null);
});

check("shopping list, Spanish", () => {
const r = parseIncoming("compra: leche, huevos, pan", opts);
assert.strictEqual(r.type, "shopping_add");
assert.deepStrictEqual(r.items, ["leche", "huevos", "pan"]);
});

check("shopping list, English", () => {
const r = parseIncoming("buy milk, eggs", opts);
assert.strictEqual(r.type, "shopping_add");
assert.deepStrictEqual(r.items, ["milk", "eggs"]);
});

check('"list" command', () => {
const r = parseIncoming("list", opts);
assert.strictEqual(r.type, "list");
});

check('"lista" command', () => {
const r = parseIncoming("lista", opts);
assert.strictEqual(r.type, "list");
});

check('"done 3" command', () => {
const r = parseIncoming("done 3", opts);
assert.strictEqual(r.type, "done");
assert.strictEqual(r.id, 3);
});

check('"listo 7" command', () => {
const r = parseIncoming("listo 7", opts);
assert.strictEqual(r.type, "done");
assert.strictEqual(r.id, 7);
});

check("help command", () => {
const r = parseIncoming("help", opts);
assert.strictEqual(r.type, "help");
});

console.log("\nDone.");
