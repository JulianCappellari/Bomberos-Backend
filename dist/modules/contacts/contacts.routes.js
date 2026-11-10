"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const role_middleware_1 = require("../../middlewares/role.middleware");
const contacts_schemas_1 = require("./contacts.schemas");
const contacts_service_1 = require("./contacts.service");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authenticate);
router.get("/", async (req, res) => {
    res.json(await (0, contacts_service_1.listContacts)(contacts_schemas_1.listContactsSchema.parse(req.query)));
});
router.post("/", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => {
    res.status(201).json(await (0, contacts_service_1.createContact)(contacts_schemas_1.createContactSchema.parse(req.body), req.user.userId));
});
router.put("/:id", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => {
    res.json(await (0, contacts_service_1.updateContact)(String(req.params.id), contacts_schemas_1.updateContactSchema.parse(req.body), req.user.userId));
});
router.delete("/:id", (0, role_middleware_1.authorize)("ADMIN", "OPERATOR"), async (req, res) => {
    const { revision } = contacts_schemas_1.deleteContactSchema.parse(req.query);
    res.json(await (0, contacts_service_1.deleteContact)(String(req.params.id), revision, req.user.userId));
});
exports.default = router;
