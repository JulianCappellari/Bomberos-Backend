import { Prisma } from "@prisma/client";
export async function assertDemoOnly(tx: Prisma.TransactionClient) {
  const delegates = tx as unknown as Record<string, { count(args: { where: Record<string, unknown> }): Promise<number> }>;
  for (const model of Prisma.dmmf.datamodel.models) {
    const references = [...new Set(model.fields.flatMap((field) => field.relationFromFields || []))];
    const prefix = (name: string) => ({ [name]: { startsWith: "demo_v2_", ...(model.fields.find((f) => f.name === name)?.isRequired ? {} : { not: null }) } });
    const allowed: Record<string, unknown>[] = model.fields.some((field) => field.name === "id") ? [prefix("id")] : [];
    if (model.name === "RankingPolicy") allowed.push({ id: "main" });
    if (model.name === "RankingTemplate") allowed.push({ id: { in: ["ranking-salon", "ranking-oficina", "ranking-cartelera"] } });
    if (model.name === "AuditLog") allowed.push({ action: "SYSTEM_DEMO_BUSINESS_REPAIRED", entityType: "System", entityId: "demo_v2", actorUserId: null });
    if (model.name === "AuditLog") allowed.push(
      { action: "HTTP_ACCESS_DENIED", entityType: "HttpRequest", actorUserId: null },
      { action: "DEMO_PASSWORD_RESET", entityType: "User", entityId: { startsWith: "demo_v2_" }, actorUserId: null },
      { action: "SYSTEM_PRESENCE_TIMED_OUT", entityType: "Attendance", entityId: { startsWith: "demo_v2_" }, actorUserId: null },
    );
    if (references.length) allowed.push({ AND: [
      ...references.map((name) => model.fields.find((f) => f.name === name)?.isRequired ? prefix(name) : { OR: [{ [name]: null }, prefix(name)] }),
      { OR: references.map(prefix) },
    ] });
    if (!allowed.length) throw new Error(`No se puede verificar propiedad de demostracion: ${model.name}`);
    const where = { NOT: { OR: allowed } };
    if (await delegates[model.name[0]!.toLowerCase() + model.name.slice(1)]!.count({ where })) throw new Error(`Base no exclusiva de demostracion (${model.name}). Use una base o esquema de demostracion separado; no se modifico ningun registro.`);
  }
}
