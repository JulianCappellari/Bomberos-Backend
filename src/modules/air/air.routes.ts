import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorizeOrPermission, hasPermission } from "../../utils/special-permissions";
import { OperationError } from "../operations/operations.schemas";
import { airCylinderSchema, airCompressorSchema, airHydroSchema, airMoveSchema, airPressureSchema, airStatusSchema, airFilterSchema, airFillSchema, airListSchema, airRevisionSchema } from "./air.schemas";
import { listAir, listAirHistory, createAirCylinder, createAirCompressor, recordHydro, updateAirStatus, moveAirCylinder, recordPressure, changeAirFilter, retireAir, recordAirFill } from "./air.service";
const router = Router();
router.use(authenticate);
router.use(authorizeOrPermission("TECHNICAL", "ADMIN", "OPERATOR", "GUARD"));
router.get("/cylinders", async (req, res) => { res.json(await listAir("cylinders", airListSchema.parse(req.query))); });
router.get("/compressors", async (req, res) => { res.json(await listAir("compressors", airListSchema.parse(req.query))); });
router.get("/fills", async (req, res) => { res.json(await listAirHistory("fills", airListSchema.parse(req.query))); });
router.get("/cylinders/:id/tests", async (req, res) => { res.json(await listAirHistory("tests", { ...airListSchema.parse(req.query), cylinderId: String(req.params.id) })); });
router.get("/compressors/:id/filters", async (req, res) => { res.json(await listAirHistory("filters", { ...airListSchema.parse(req.query), compressorId: String(req.params.id) })); });

router.post("/cylinders", async (req, res) => { res.status(201).json(await createAirCylinder(airCylinderSchema.parse(req.body), req.user!.userId)); });
router.post("/compressors", async (req, res) => { res.status(201).json(await createAirCompressor(airCompressorSchema.parse(req.body), req.user!.userId)); });
router.post("/cylinders/:id/tests", async (req, res) => {
  // Q04: la prueba hidraulica la valida el responsable tecnico designado, con su certificado.
  if (!hasPermission(req.user, "TECHNICAL")) throw new OperationError(403, "Solo el responsable técnico designado valida pruebas hidráulicas y certificaciones");
  res.status(201).json(await recordHydro(String(req.params.id), airHydroSchema.parse(req.body), req.user!.userId)); });
router.post("/cylinders/:id/status", async (req, res) => { res.json(await updateAirStatus("cylinder", String(req.params.id), airStatusSchema.parse(req.body), req.user!.userId)); });
router.post("/compressors/:id/status", async (req, res) => { res.json(await updateAirStatus("compressor", String(req.params.id), airStatusSchema.parse(req.body), req.user!.userId)); });
router.post("/cylinders/:id/location", async (req, res) => { res.json(await moveAirCylinder(String(req.params.id), airMoveSchema.parse(req.body), req.user!.userId)); });
router.post("/cylinders/:id/pressure", async (req, res) => { res.json(await recordPressure(String(req.params.id), airPressureSchema.parse(req.body), req.user!.userId)); });
router.post("/compressors/:id/filters", async (req, res) => { res.status(201).json(await changeAirFilter(String(req.params.id), airFilterSchema.parse(req.body), req.user!.userId)); });
for (const kind of ["cylinders", "compressors"] as const) router.post(`/${kind}/:id/retire`, async (req, res) => {
  const input = airRevisionSchema.parse(req.body); res.json(await retireAir(kind === "cylinders" ? "cylinder" : "compressor", String(req.params.id), input.revision, input.notes, req.user!.userId));
});
router.post("/fills", async (req, res) => { res.status(201).json(await recordAirFill(airFillSchema.parse(req.body), req.user!.userId)); });
export default router;
