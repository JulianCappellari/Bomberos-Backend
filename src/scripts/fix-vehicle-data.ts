import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Corrigiendo resumen de inspecciones...");

  const inspections = await prisma.inspection.findMany({
    include: {
      items: true
    }
  });

  for (const inspection of inspections) {
    const summaryOk = inspection.items.filter(item => item.result === "OK").length;
    const summaryMissing = inspection.items.filter(item => item.result === "MISSING").length;
    const summaryDamaged = inspection.items.filter(item => item.result === "DAMAGED").length;
    const summaryUnchecked = inspection.items.filter(item => item.result === "UNCHECKED").length;

    if (
      inspection.summaryOk !== summaryOk ||
      inspection.summaryMissing !== summaryMissing ||
      inspection.summaryDamaged !== summaryDamaged ||
      inspection.summaryUnchecked !== summaryUnchecked
    ) {
      console.log(`Corrigiendo inspeccion ${inspection.id}`);
      await prisma.inspection.update({
        where: { id: inspection.id },
        data: {
          summaryOk,
          summaryMissing,
          summaryDamaged,
          summaryUnchecked
        }
      });
    }
  }

  console.log("Fix de resumen completado.");
}

main()
  .catch((error) => {
    console.error("Error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
