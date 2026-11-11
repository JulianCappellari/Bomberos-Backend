import { Prisma } from "@prisma/client";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function configuredSchema() {
  try {
    const schema = new URL(process.env.DATABASE_URL || "").searchParams.get("schema") || "public";
    if (!IDENTIFIER.test(schema)) throw new Error("El esquema configurado contiene caracteres no permitidos");
    return schema;
  } catch (error) {
    if (error instanceof Error && error.message.includes("caracteres no permitidos")) throw error;
    return "public";
  }
}

export const databaseSchema = configuredSchema();

export function qualifiedTable(table: string) {
  if (!IDENTIFIER.test(table)) throw new Error("Nombre de tabla no permitido");
  return Prisma.raw(`"${databaseSchema}"."${table}"`);
}

type RawQueryClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function lockRow(client: RawQueryClient, table: string, id: string) {
  await client.$queryRaw(Prisma.sql`SELECT "id" FROM ${qualifiedTable(table)} WHERE "id" = ${id} FOR UPDATE`);
}
