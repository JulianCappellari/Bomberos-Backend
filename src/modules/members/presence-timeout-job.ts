import { prisma } from "../../config/prisma";
import { expirePresence, remindDuePresence } from "./presence.service";
import { signalPresenceChanged } from "../attendance/presence-events";

export function startPresenceTimeoutJob() {
  let running = false;
  async function sweep() {
    if (running) return;
    running = true;
    try {
      const now = new Date(), cutoff = new Date(+now - 30 * 60000);
      let after = "";
      for (;;) {
        const rows = await prisma.attendance.findMany({where:{status:"OPEN",promptShownAt:{lte:cutoff},id:{gt:after}},select:{id:true},orderBy:{id:"asc"},take:100});
        for (const {id} of rows) if (await expirePresence(id,now)) signalPresenceChanged();
        if (rows.length < 100) break;
        after = rows[rows.length - 1]!.id;
      }
      // Aviso al celular para confirmar presencia (la notificacion se envia por Web Push).
      await remindDuePresence(now);
    } catch { console.error("No se pudo completar el control de permanencias; se reintentará"); }
    finally { running = false; }
  }
  void sweep();
  const timer = setInterval(() => void sweep(),60000); timer.unref();
  return () => clearInterval(timer);
}
