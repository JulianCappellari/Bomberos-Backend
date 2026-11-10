import test from "node:test";
import assert from "node:assert/strict";
import { gpsSuspicionReasons } from "../utils/gps-suspicion";
test("T09: senales de GPS fabricado", () => {
  assert.deepEqual(gpsSuspicionReasons({ latitude: -33.123456, longitude: -64.654321, accuracy: 8 }), []);
  assert.equal(gpsSuspicionReasons({ latitude: -33.1234, longitude: -64.6543, accuracy: 0 }).length, 1);
  assert.equal(gpsSuspicionReasons({ latitude: -33, longitude: -64, accuracy: 5 }).length, 1);
  assert.equal(gpsSuspicionReasons({ latitude: -33.123456, longitude: -64.654321, accuracy: 8 }, { latitude: -33.123456, longitude: -64.654321 }).length, 1);
});
