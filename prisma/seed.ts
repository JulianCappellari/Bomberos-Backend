import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const station = await prisma.station.upsert({
    where: {
      id: "station_sampacho_dev",
    },
    update: {
      name: "Cuartel Sampacho",
      latitude: -31.4226,
      longitude: -64.1764,
      radiusMeters: 120,
    },
    create: {
      id: "station_sampacho_dev",
      name: "Cuartel Sampacho",
      latitude: -31.4226,
      longitude: -64.1764,
      radiusMeters: 120,
    },
  });

  console.log("✔ Station creada/actualizada:", station);
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });