"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorize = authorize;
function authorize(...roles) {
    return (req, res, next) => {
        const userRole = req.user?.role;
        if (!userRole) {
            return res.status(401).json({ message: "Unauthorized" });
        }
        if (!roles.includes(userRole)) {
            return res.status(403).json({ message: "Forbidden" });
        }
        next();
    };
}
