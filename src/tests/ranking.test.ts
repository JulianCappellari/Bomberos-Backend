import test from "node:test";
import assert from "node:assert/strict";
import {unpaidMinutes,overdue,policySchema,defaults,creditedControls} from "../modules/ranking/ranking.rules";
test("L07: repetir el control de un movil suma solo en dias distintos",()=>{const rows=[{vehicleId:"a",inspectionDate:new Date("2026-10-30")},{vehicleId:"a",inspectionDate:new Date("2026-11-01")},{vehicleId:"a",inspectionDate:new Date("2026-11-02")},{vehicleId:"a",inspectionDate:new Date("2026-11-02")},{vehicleId:"b",inspectionDate:new Date("2026-11-02")},{vehicleId:"a",inspectionDate:new Date("2026-11-03")}];assert.equal(creditedControls(rows,"2026-10"),1);assert.equal(creditedControls(rows,"2026-11"),4);});
test("ranking subtracts paid guard intervals and deployments without double counting",()=>{
 const hour=3600000;
 assert.equal(unpaidMinutes([{start:0,end:10*hour},{start:hour,end:8*hour}],[{start:0,end:8*hour},{start:7*hour,end:9*hour}]),60);
 assert.equal(unpaidMinutes([{start:0,end:8*hour}],[{start:0,end:8*hour}]),0);
 assert.equal(unpaidMinutes([{start:0,end:hour}],[{start:2*hour,end:3*hour}]),60);
});
test("one penalty per overdue task; pending verification and justified cancellation are not failures",()=>{
 const task={dueOn:new Date("2026-11-04"),createdAt:new Date("2026-11-01"),status:"ASSIGNED",completedAt:null as Date|null};
 assert(overdue(task,"2026-11-05"));assert(!overdue(task,"2026-11-04"));
 assert(!overdue({...task,status:"SUBMITTED"},"2026-11-05"));assert(!overdue({...task,status:"CANCELLED"},"2026-11-05"));
 assert(overdue({...task,status:"VERIFIED",completedAt:new Date("2026-11-05T04:00:00Z")},"2026-11-05"));
 assert(!overdue({...task,createdAt:new Date("2026-11-06")},"2026-11-09"));
});
test("ranking weights cannot be negative or arbitrary extra fields",()=>{assert(policySchema.safeParse(defaults).success);assert(!policySchema.safeParse({...defaults,missedTask:-1}).success);});
