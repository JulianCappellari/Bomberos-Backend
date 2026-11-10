import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { authorize } from "../../middlewares/role.middleware";
import { createContactSchema, updateContactSchema, deleteContactSchema, listContactsSchema } from "./contacts.schemas";
import { createContact, updateContact, deleteContact, listContacts } from "./contacts.service";

const router = Router();
router.use(authenticate);
router.get("/", async (req, res) => {
  res.json(await listContacts(listContactsSchema.parse(req.query)));
});
router.post("/", authorize("ADMIN", "OPERATOR"), async (req, res) => {
  res.status(201).json(await createContact(createContactSchema.parse(req.body), req.user!.userId));
});
router.put("/:id", authorize("ADMIN", "OPERATOR"), async (req, res) => {
  res.json(await updateContact(String(req.params.id), updateContactSchema.parse(req.body), req.user!.userId));
});
router.delete("/:id", authorize("ADMIN", "OPERATOR"), async (req, res) => {
  const { revision } = deleteContactSchema.parse(req.query);
  res.json(await deleteContact(String(req.params.id), revision, req.user!.userId));
});
export default router;
