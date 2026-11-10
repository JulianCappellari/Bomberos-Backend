import test from "node:test";
import assert from "node:assert/strict";
import {meanSample,measuredMinutes} from "../modules/operations/operational-report";
test("Los tiempos faltantes no se convierten en cero y la cronología invertida queda excluida",()=>{
 const at=new Date("2026-11-09T10:00:00Z"),later=new Date(+at+90000);
 assert.equal(measuredMinutes(at,later),1.5);
 assert.equal(measuredMinutes(later,at),null);
 assert.equal(measuredMinutes(null,later),null);
 assert.deepEqual(meanSample([null,2,4]),{minutes:3,samples:2,missing:1});
 assert.deepEqual(meanSample([null]),{minutes:null,samples:0,missing:1});
});
