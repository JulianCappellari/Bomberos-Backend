import express from "express";
import cors from "cors";
import authRoutes from "./modules/auth/auth.routes";
import usersRoutes from "./modules/users/users.routes";
import applicationsRoutes from "./modules/applications/applications.routes";
import attendanceRoutes from "./modules/attendance/attendance.routes";
import alertsRoutes from "./modules/alerts/alerts.routes";
import incidentsRoutes from "./modules/incidents/incidents.routes";
import shiftsRoutes from "./modules/shifts/shifts.routes";
import assetsRoutes from "./modules/assets/assets.routes";
import inspectionsRoutes from "./modules/inspections/inspections.routes";
import equipmentRoutes from "./modules/equipment/equipment.routes";
import dashboardRoutes from "./modules/dashboard/dashboard.routes";
import chatRoutes from "./modules/chat/chat.routes";
import auditRoutes from "./modules/audit/audit.routes";
import complianceRoutes from "./modules/compliance/compliance.routes";
import contactsRoutes from "./modules/contacts/contacts.routes";
import operationsRoutes from "./modules/operations/operations.routes";
import personalEquipmentRoutes from "./modules/personal-equipment/personal-equipment.routes";
import equipmentRequestsRoutes from "./modules/personal-equipment/equipment-requests.routes";
import airRoutes from "./modules/air/air.routes";
import workRoutes from "./modules/work/work.routes";
import fleetRoutes from "./modules/fleet/fleet.routes";
import memberRoutes from "./modules/members/members.routes";
import pushRoutes from "./modules/push/push.routes";
import rankingRoutes from "./modules/ranking/ranking.routes";
import financeRoutes from "./modules/finance/finance.routes";
import stationRoutes from "./modules/station/station.routes";
import { env } from "./config/env";
import { errorHandler } from "./middlewares/errorHandler";
import { requestAudit } from "./middlewares/request-audit.middleware";
import { observePresenceChanges } from "./modules/attendance/presence-events";

export const app = express();

app.disable("x-powered-by");

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self)",
  );
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use("/api", requestAudit);
app.use("/api", observePresenceChanges);

app.get("/", (req, res) => {
  res.json({
    message: "Bomberos API running",
  });
});


app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/applications", applicationsRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/alerts", alertsRoutes);
app.use("/api/incidents", incidentsRoutes);
app.use("/api/shifts", shiftsRoutes); 
app.use("/api/assets", assetsRoutes);
app.use("/api/inspections", inspectionsRoutes);
app.use("/api/equipment", equipmentRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/audit-logs", auditRoutes);
app.use("/api/compliance", complianceRoutes);
app.use("/api/contacts", contactsRoutes);
app.use("/api/operations", operationsRoutes);
app.use("/api/personal-equipment", personalEquipmentRoutes);
app.use("/api/equipment-requests", equipmentRequestsRoutes);
app.use("/api/air", airRoutes);
app.use("/api/work", workRoutes);
app.use("/api/fleet", fleetRoutes);
app.use("/api/members", memberRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/ranking", rankingRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/station", stationRoutes);
app.use("/api", (_req, res) => { res.status(404).json({ message: "Ruta no encontrada" }); });

app.use(errorHandler);
