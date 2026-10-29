// Fills the clinic with realistic availability starting tomorrow.
//
// Usage:
//   BASE=http://localhost:3000 KEY=<your API key> node scripts/seed.mjs [days]
//
// days defaults to 90 (about 3 months). This calls /reset, so it deletes every
// existing booking and slot first. Re-run it any time to roll the calendar forward.

const BASE = process.env.BASE ?? "http://localhost:3000";
const KEY = process.env.KEY;
if (!KEY) {
  console.error("Set KEY to your API key, e.g. KEY=abc123 node scripts/seed.mjs");
  process.exit(1);
}

const DAYS = Number(process.argv[2] ?? 90);
// Clinic hours are local time; Africa/Lagos is UTC+1 all year. Slots are sent as UTC.
const UTC_OFFSET_HOURS = Number(process.env.UTC_OFFSET ?? 1);

// days: 0 = Sunday ... 6 = Saturday. windows are [from hour, to hour), 30 minute slots.
const doctors = [
  { id: "ade", name: "Dr Ade", days: [1, 2, 3, 4, 5], windows: [[9, 12], [13, 16]] },
  { id: "bola", name: "Dr Bola", days: [1, 3, 5], windows: [[10, 14]] },
  { id: "eze", name: "Dr Eze", days: [2, 4], windows: [[9, 13]] },
];

const iso = (ms) => new Date(ms).toISOString().replace(".000Z", "Z");
const pad = (n) => String(n).padStart(2, "0");

const now = new Date();
const slots = [];

for (let i = 1; i <= DAYS; i++) {
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i),
  );
  const dow = day.getUTCDay();
  const dateStr = day.toISOString().slice(0, 10);

  for (const doc of doctors) {
    if (!doc.days.includes(dow)) continue;
    for (const [from, to] of doc.windows) {
      for (let mins = from * 60; mins < to * 60; mins += 30) {
        const startMs = day.getTime() + (mins - UTC_OFFSET_HOURS * 60) * 60000;
        slots.push({
          id: `${doc.id}-${dateStr}-${pad(Math.floor(mins / 60))}${pad(mins % 60)}`,
          provider: doc.name,
          start: iso(startMs),
          end: iso(startMs + 30 * 60000),
        });
      }
    }
  }
}

const res = await fetch(`${BASE}/reset`, {
  method: "POST",
  headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ slots }),
});

console.log(`${res.status} ${await res.text()}`);
if (res.ok) {
  console.log(`Seeded ${slots.length} slots over the next ${DAYS} days.`);
} else {
  process.exit(1);
}
