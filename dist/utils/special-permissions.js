"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SPECIAL_PERMISSION_LABELS = exports.SPECIAL_PERMISSIONS = void 0;
exports.permissionAllowedForRank = permissionAllowedForRank;
exports.hasPermission = hasPermission;
exports.authorizeOrPermission = authorizeOrPermission;
const firefighter_ranks_1 = require("./firefighter-ranks");
// B10/B11: permisos especiales independientes entre si; no vencen, rigen hasta su revocacion.
exports.SPECIAL_PERMISSIONS = ["FLEET", "PPE", "TECHNICAL", "FINANCE"];
exports.SPECIAL_PERMISSION_LABELS = {
    FLEET: "Responsable de flota", PPE: "Responsable de EPP", TECHNICAL: "Responsable técnico (ERA y certificaciones)", FINANCE: "Permiso financiero",
};
// Cargos que pueden recibir cada permiso. FINANCE: oficiales y comision directiva designada (O01).
const ELIGIBLE = {
    FLEET: ["oficial", "suboficial", "bombero"], PPE: ["oficial", "suboficial", "bombero"], TECHNICAL: ["oficial", "suboficial", "bombero"], FINANCE: ["oficial", "comisiondirectiva"],
};
function permissionAllowedForRank(permission, rank) {
    return ELIGIBLE[permission].includes((0, firefighter_ranks_1.normalizeRank)(rank).replace(/\s/g, ""));
}
function hasPermission(user, permission) {
    return Boolean(user?.permissions?.includes(permission));
}
// Permite el acceso por rol de sesion o por permiso especial designado.
function authorizeOrPermission(permission, ...roles) {
    return (req, res, next) => {
        if (!req.user?.role)
            return res.status(401).json({ message: "Unauthorized" });
        if (!roles.includes(req.user.role) && !hasPermission(req.user, permission))
            return res.status(403).json({ message: "Forbidden" });
        next();
    };
}
