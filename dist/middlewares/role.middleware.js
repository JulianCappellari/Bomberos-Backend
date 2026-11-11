"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorize = authorize;
function authorize(...roles) {
    return (req, res, next) => {
        const userRole = req.user?.role;
        if (!userRole) {
            return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
        }
        if (!roles.includes(userRole)) {
            return res.status(403).json({ message: "No tenés permiso para esta acción" });
        }
        next();
    };
}
