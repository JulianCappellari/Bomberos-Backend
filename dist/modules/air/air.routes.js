"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const special_permissions_1 = require("../../utils/special-permissions");
const operations_schemas_1 = require("../operations/operations.schemas");
const air_schemas_1 = require("./air.schemas");
const air_service_1 = require("./air.service");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
router.use((0, special_permissions_1.authorizeOrPermission)("TECHNICAL", "ADMIN", "OPERATOR", "GUARD"));
router.get("/cylinders", async (req, res) => { res.json(await (0, air_service_1.listAir)("cylinders", air_schemas_1.airListSchema.parse(req.query))); });
router.get("/compressors", async (req, res) => { res.json(await (0, air_service_1.listAir)("compressors", air_schemas_1.airListSchema.parse(req.query))); });
router.get("/fills", async (req, res) => { res.json(await (0, air_service_1.listAirHistory)("fills", air_schemas_1.airListSchema.parse(req.query))); });
router.get("/cylinders/:id/tests", async (req, res) => { res.json(await (0, air_service_1.listAirHistory)("tests", { ...air_schemas_1.airListSchema.parse(req.query), cylinderId: String(req.params.id) })); });
router.get("/compressors/:id/filters", async (req, res) => { res.json(await (0, air_service_1.listAirHistory)("filters", { ...air_schemas_1.airListSchema.parse(req.query), compressorId: String(req.params.id) })); });
router.post("/cylinders", async (req, res) => { res.status(201).json(await (0, air_service_1.createAirCylinder)(air_schemas_1.airCylinderSchema.parse(req.body), req.user.userId)); });
router.post("/compressors", async (req, res) => { res.status(201).json(await (0, air_service_1.createAirCompressor)(air_schemas_1.airCompressorSchema.parse(req.body), req.user.userId)); });
router.post("/cylinders/:id/tests", async (req, res) => {
    // Q04: la prueba hidraulica la valida el responsable tecnico designado, con su certificado.
    if (!(0, special_permissions_1.hasPermission)(req.user, "TECHNICAL"))
        throw new operations_schemas_1.OperationError(403, "Solo el responsable técnico designado valida pruebas hidráulicas y certificaciones");
    res.status(201).json(await (0, air_service_1.recordHydro)(String(req.params.id), air_schemas_1.airHydroSchema.parse(req.body), req.user.userId));
});
router.post("/cylinders/:id/status", async (req, res) => { res.json(await (0, air_service_1.updateAirStatus)("cylinder", String(req.params.id), air_schemas_1.airStatusSchema.parse(req.body), req.user.userId)); });
router.post("/compressors/:id/status", async (req, res) => { res.json(await (0, air_service_1.updateAirStatus)("compressor", String(req.params.id), air_schemas_1.airStatusSchema.parse(req.body), req.user.userId)); });
router.post("/cylinders/:id/location", async (req, res) => { res.json(await (0, air_service_1.moveAirCylinder)(String(req.params.id), air_schemas_1.airMoveSchema.parse(req.body), req.user.userId)); });
router.post("/cylinders/:id/pressure", async (req, res) => { res.json(await (0, air_service_1.recordPressure)(String(req.params.id), air_schemas_1.airPressureSchema.parse(req.body), req.user.userId)); });
router.post("/compressors/:id/filters", async (req, res) => { res.status(201).json(await (0, air_service_1.changeAirFilter)(String(req.params.id), air_schemas_1.airFilterSchema.parse(req.body), req.user.userId)); });
for (const kind of ["cylinders", "compressors"])
    router.post(`/${kind}/:id/retire`, async (req, res) => {
        const input = air_schemas_1.airRevisionSchema.parse(req.body);
        res.json(await (0, air_service_1.retireAir)(kind === "cylinders" ? "cylinder" : "compressor", String(req.params.id), input.revision, input.notes, req.user.userId));
    });
router.post("/fills", async (req, res) => { res.status(201).json(await (0, air_service_1.recordAirFill)(air_schemas_1.airFillSchema.parse(req.body), req.user.userId)); });
exports.default = router;
