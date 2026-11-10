"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const operations_schemas_1 = require("../modules/operations/operations.schemas");
function errorHandler(err, req, res, next) {
    if (res.headersSent)
        return next(err);
    if (err instanceof zod_1.ZodError) {
        const formatIssues = err.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
        }));
        return res.status(400).json({
            message: "Errores de validación",
            errors: formatIssues,
        });
    }
    if (err instanceof client_1.Prisma.PrismaClientKnownRequestError) {
        const responses = {
            P2002: { status: 409, message: "El registro ya existe o fue creado por otro usuario." },
            P2003: { status: 409, message: "El registro tiene referencias vinculadas. Actualice la pagina antes de continuar." },
            P2025: { status: 409, message: "El registro fue modificado o eliminado. Recargue antes de continuar." },
            P2034: { status: 409, message: "Otro usuario actualizo estos datos al mismo tiempo. Vuelva a intentarlo." },
        };
        const response = responses[err.code];
        if (response)
            return res.status(response.status).json({ message: response.message });
    }
    // Si es un error con status
    const status = Number(err.status || err.statusCode);
    if (err instanceof operations_schemas_1.OperationError && status === 503)
        return res.status(503).json({ message: err.message });
    if (Number.isInteger(status) && status >= 400 && status < 500) {
        return res.status(status).json({
            message: err.message || "Ha ocurrido un error",
        });
    }
    // Error generico
    console.error("Unhandled request error", { name: err?.name, code: err?.code });
    return res.status(500).json({ message: "Error interno del servidor. Intente nuevamente." });
}
