import test from "node:test";
import assert from "node:assert/strict";
import { guardPresenceUntil } from "../modules/members/presence-policy";
const hour = 3600000;
test("La excepcion de guardia dura hasta el fin del turno asignado y cada turno es independiente", () => {
  const checkIn = new Date("2026-11-06T08:00:00-03:00"), t = checkIn.getTime();
  assert.equal(guardPresenceUntil(checkIn, [{start:t,end:t+4*hour}])!.getTime(), t+4*hour);
  assert.equal(guardPresenceUntil(checkIn, [{start:t,end:t+12*hour},{start:t+12*hour,end:t+24*hour}])!.getTime(), t+12*hour);
  assert.equal(guardPresenceUntil(new Date(t+12*hour), [{start:t,end:t+12*hour},{start:t+12*hour,end:t+24*hour}])!.getTime(), t+24*hour);
});
test("Guardias futuras o terminadas no eximen de revalidar", () => {
  const checkIn = new Date("2026-11-06T11:00:00Z"), t = checkIn.getTime();
  assert.equal(guardPresenceUntil(checkIn, [{start:t+hour,end:t+12*hour}]), null);
  assert.equal(guardPresenceUntil(checkIn, [{start:t-hour,end:t}]),null);
});
