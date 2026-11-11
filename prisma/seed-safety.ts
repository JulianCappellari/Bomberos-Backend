import { Prisma } from "@prisma/client";
type Filter = Record<string, unknown>;

function ownershipFilter(modelName: string, ancestors: string[] = []): Filter {
    const model = Prisma.dmmf.datamodel.models.find(row => row.name === modelName);
    if (!model) throw Error(`Modelo de demostracion desconocido: ${modelName}`);
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
      { action: "SYSTEM_SHIFT_ABSENCE_RECORDED", entityType: "Shift", entityId: { startsWith: "demo_v2_" }, actorUserId: null, metadata: { path: ["userId"], string_starts_with: "demo_v2_" } },
    );
    if (references.length) allowed.push({ AND: [
      ...references.map((name) => model.fields.find((f) => f.name === name)?.isRequired ? prefix(name) : { OR: [{ [name]: null }, prefix(name)] }),
      { OR: references.map(prefix) },
    ] });
    // Runtime IDs are not seed IDs. A child is still demo-owned when every
    // non-null parent belongs to the demo. Unowned roots remain rejected.
    // Bound recursion and cut cycles; an inconclusive chain fails closed.
    if (references.length && ancestors.length < 6 && !ancestors.includes(model.name)) {
      const relations = model.fields.filter(field => field.relationFromFields?.length);
      if (relations.length) allowed.push({ AND: [
        ...relations.map(relation => {
          const parent = { [relation.name]: { is: ownershipFilter(relation.type, [...ancestors, model.name]) } };
          return relation.isRequired ? parent : { OR: [{ [relation.name]: { is: null } }, parent] };
        }),
        ...(references.some(name => model.fields.find(field => field.name === name)?.isRequired) ? [] : [{ OR: references.map(name => ({ [name]: { not: null } })) }]),
      ] });
    }
    if (!allowed.length) throw new Error(`No se puede verificar propiedad de demostracion: ${model.name}`);
    return { OR: allowed };
}

export async function assertDemoOnly(tx: Prisma.TransactionClient) {
  const delegates = tx as unknown as Record<string, { count(args: { where: Record<string, unknown> }): Promise<number> }>;
  for (const model of Prisma.dmmf.datamodel.models) {
    const where = { NOT: ownershipFilter(model.name) };
    if (await delegates[model.name[0]!.toLowerCase() + model.name.slice(1)]!.count({ where })) throw new Error(`Base no exclusiva de demostracion (${model.name}). Use una base o esquema de demostracion separado; no se modifico ningun registro.`);
  }
}
