import test from "node:test";
import assert from "node:assert/strict";
import {publicWorkResponse} from "../modules/work/work-privacy";
test("Task responses do not expose private ranking keys or recovery reasons",()=>{const date=new Date();const value=publicWorkResponse({items:[{rankingRecoveryKey:"secret",title:"Tarea normal",notes:"Asignación aleatoria de recuperación por puntaje bajo",createdAt:date}]});assert(!JSON.stringify(value).includes("ranking"));assert(!JSON.stringify(value).includes("puntaje"));assert(JSON.stringify(value).includes(date.toISOString()));});
