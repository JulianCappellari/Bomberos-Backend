import bcrypt from "bcrypt";

async function main() {
  const hash = await bcrypt.hash("admin1234", 10);
  console.log(hash);
}

main();