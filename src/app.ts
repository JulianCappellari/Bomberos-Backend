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

export const app = express();

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());

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
