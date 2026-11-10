import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { stationDate } from "../utils/station-time";
import { shiftPhase } from "../modules/dashboard/readiness.service";

test("El dia operativo usa Argentina aunque el servidor tenga otra zona horaria", () => {
  assert.equal(stationDate(new Date("2026-11-05T02:59:59Z")), "2026-11-04");
  assert.equal(stationDate(new Date("2026-11-05T03:00:00Z")), "2026-11-05");
});
test("El estado de guardia respeta el relevo argentino a las 08 y 20", () => {
  const date = new Date("2026-11-04T00:00:00Z");
  assert.equal(shiftPhase(date, "DAY", new Date("2026-11-04T10:59:59Z"), "08:00", "20:00"), "UPCOMING");
  assert.equal(shiftPhase(date, "DAY", new Date("2026-11-04T11:00:00Z"), "08:00", "20:00"), "ACTIVE");
  assert.equal(shiftPhase(date, "DAY", new Date("2026-11-04T23:00:00Z"), "08:00", "20:00"), "FINISHED");
  assert.equal(shiftPhase(date, "NIGHT", new Date("2026-11-05T10:59:59Z"), "20:00", "08:00"), "ACTIVE");
  assert.equal(shiftPhase(date, "NIGHT", new Date("2026-11-05T11:00:00Z"), "20:00", "08:00"), "FINISHED");
});
