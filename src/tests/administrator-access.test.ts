import { test } from "node:test";
import assert from "node:assert/strict";
import { Request, Response } from "express";
import { authorize } from "../middlewares/role.middleware";
import { canReadAllPersonnelStats } from "../modules/operations/reports.service";
test("Solo ADMIN puede pasar el control administrativo de auditoria", () => {
  for (const role of ["ADMIN", "OPERATOR", "FIREFIGHTER"]) {
    let passed = false, status = 0;
    const res = { status(code: number) { status = code; return this; }, json() {} } as unknown as Response;
    authorize("ADMIN")({ user: { userId: "test", role } } as Request, res, () => { passed = true; });
    assert.equal(passed, role === "ADMIN");
    if (role !== "ADMIN") assert.equal(status, 403);
  }
});
test("El reporte anual global sigue reservado a ADMIN; la consulta individual de jefatura tiene su permiso separado", () => {
  assert.equal(canReadAllPersonnelStats("ADMIN"), true);
  for (const role of ["OPERATOR", "FIREFIGHTER", "", "oficial"]) assert.equal(canReadAllPersonnelStats(role), false);
});
