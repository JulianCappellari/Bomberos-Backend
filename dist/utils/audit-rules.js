"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditActorRequired = auditActorRequired;
function auditActorRequired(action, entityType, metadata) {
    if (action === "SEED_LOADED" || action.startsWith("SYSTEM_"))
        return false;
    if (action === "HTTP_ACCESS_DENIED" && entityType === "HttpRequest" && metadata && typeof metadata === "object" && "status" in metadata && [401, 403].includes(Number(metadata.status)))
        return false;
    return true;
}
