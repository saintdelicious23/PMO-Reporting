import assert from "node:assert/strict";
import test from "node:test";
import { calculateUrgency, suggestPriority } from "../packages/contracts/src/index.ts";

test("dinamička hitnost prati rok i isključuje završene projekte", () => {
  const today = new Date("2026-07-01T12:00:00Z");
  assert.equal(calculateUrgency("2026-06-30", "active", today), 5);
  assert.equal(calculateUrgency("2026-07-31", "active", today), 4);
  assert.equal(calculateUrgency("2026-08-30", "active", today), 3);
  assert.equal(calculateUrgency("2026-09-29", "active", today), 2);
  assert.equal(calculateUrgency("2026-12-28", "active", today), 1);
  assert.equal(calculateUrgency("2027-01-01", "active", today), 0);
  assert.equal(calculateUrgency("2026-06-30", "completed", today), 0);
});

test("kritična posledica podiže predlog prioriteta kada je hitnost relevantna", () => {
  assert.equal(suggestPriority(2, 2, 4), "high");
  assert.equal(suggestPriority(2, 1, 4), "low");
  assert.equal(suggestPriority(4, 5, 4), "critical");
});
