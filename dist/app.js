"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const auth_routes_1 = __importDefault(require("./modules/auth/auth.routes"));
const users_routes_1 = __importDefault(require("./modules/users/users.routes"));
const applications_routes_1 = __importDefault(require("./modules/applications/applications.routes"));
const attendance_routes_1 = __importDefault(require("./modules/attendance/attendance.routes"));
const alerts_routes_1 = __importDefault(require("./modules/alerts/alerts.routes"));
const incidents_routes_1 = __importDefault(require("./modules/incidents/incidents.routes"));
const shifts_routes_1 = __importDefault(require("./modules/shifts/shifts.routes"));
const assets_routes_1 = __importDefault(require("./modules/assets/assets.routes"));
const inspections_routes_1 = __importDefault(require("./modules/inspections/inspections.routes"));
const equipment_routes_1 = __importDefault(require("./modules/equipment/equipment.routes"));
const dashboard_routes_1 = __importDefault(require("./modules/dashboard/dashboard.routes"));
const chat_routes_1 = __importDefault(require("./modules/chat/chat.routes"));
const audit_routes_1 = __importDefault(require("./modules/audit/audit.routes"));
const compliance_routes_1 = __importDefault(require("./modules/compliance/compliance.routes"));
const contacts_routes_1 = __importDefault(require("./modules/contacts/contacts.routes"));
const operations_routes_1 = __importDefault(require("./modules/operations/operations.routes"));
const personal_equipment_routes_1 = __importDefault(require("./modules/personal-equipment/personal-equipment.routes"));
const equipment_requests_routes_1 = __importDefault(require("./modules/personal-equipment/equipment-requests.routes"));
const air_routes_1 = __importDefault(require("./modules/air/air.routes"));
const work_routes_1 = __importDefault(require("./modules/work/work.routes"));
const fleet_routes_1 = __importDefault(require("./modules/fleet/fleet.routes"));
const members_routes_1 = __importDefault(require("./modules/members/members.routes"));
const push_routes_1 = __importDefault(require("./modules/push/push.routes"));
const ranking_routes_1 = __importDefault(require("./modules/ranking/ranking.routes"));
const finance_routes_1 = __importDefault(require("./modules/finance/finance.routes"));
const station_routes_1 = __importDefault(require("./modules/station/station.routes"));
const env_1 = require("./config/env");
const errorHandler_1 = require("./middlewares/errorHandler");
const request_audit_middleware_1 = require("./middlewares/request-audit.middleware");
const presence_events_1 = require("./modules/attendance/presence-events");
exports.app = (0, express_1.default)();
exports.app.disable("x-powered-by");
exports.app.use((0, cors_1.default)({
    origin(origin, callback) {
        if (!origin || env_1.env.corsOrigins.includes(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
}));
exports.app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
    next();
});
exports.app.use(express_1.default.json({ limit: "1mb" }));
exports.app.use("/api", request_audit_middleware_1.requestAudit);
exports.app.use("/api", presence_events_1.observePresenceChanges);
exports.app.get("/", (req, res) => {
    res.json({
        message: "Bomberos API running",
    });
});
exports.app.use("/api/auth", auth_routes_1.default);
exports.app.use("/api/users", users_routes_1.default);
exports.app.use("/api/applications", applications_routes_1.default);
exports.app.use("/api/attendance", attendance_routes_1.default);
exports.app.use("/api/alerts", alerts_routes_1.default);
exports.app.use("/api/incidents", incidents_routes_1.default);
exports.app.use("/api/shifts", shifts_routes_1.default);
exports.app.use("/api/assets", assets_routes_1.default);
exports.app.use("/api/inspections", inspections_routes_1.default);
exports.app.use("/api/equipment", equipment_routes_1.default);
exports.app.use("/api/dashboard", dashboard_routes_1.default);
exports.app.use("/api/chat", chat_routes_1.default);
exports.app.use("/api/audit-logs", audit_routes_1.default);
exports.app.use("/api/compliance", compliance_routes_1.default);
exports.app.use("/api/contacts", contacts_routes_1.default);
exports.app.use("/api/operations", operations_routes_1.default);
exports.app.use("/api/personal-equipment", personal_equipment_routes_1.default);
exports.app.use("/api/equipment-requests", equipment_requests_routes_1.default);
exports.app.use("/api/air", air_routes_1.default);
exports.app.use("/api/work", work_routes_1.default);
exports.app.use("/api/fleet", fleet_routes_1.default);
exports.app.use("/api/members", members_routes_1.default);
exports.app.use("/api/push", push_routes_1.default);
exports.app.use("/api/ranking", ranking_routes_1.default);
exports.app.use("/api/finance", finance_routes_1.default);
exports.app.use("/api/station", station_routes_1.default);
exports.app.use("/api", (_req, res) => { res.status(404).json({ message: "Ruta no encontrada" }); });
exports.app.use(errorHandler_1.errorHandler);
