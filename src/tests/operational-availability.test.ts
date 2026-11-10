import test from "node:test";
import assert from "node:assert/strict";
import {operationalStatus} from "../modules/members/operational-availability";
test("El despliegue prevalece sobre presencia y una ausencia programada no oculta la presencia QR",()=>{
 assert.equal(operationalStatus(true,true,true,true),"DEPLOYED");
 assert.equal(operationalStatus(false,true,true,false),"PRESENT");
 assert.equal(operationalStatus(false,false,true,true),"UNAVAILABLE");
});
test("No se presenta como disponible a quien nunca confirmó",()=>{
 assert.equal(operationalStatus(false,false,false,false),"UNKNOWN");
 assert.equal(operationalStatus(false,false,false,true),"AVAILABLE");
});
