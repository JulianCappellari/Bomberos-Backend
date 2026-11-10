export function auditActorRequired(action: string, entityType: string, metadata: unknown) {
  if (action === "SEED_LOADED" || action.startsWith("SYSTEM_")) return false;
  if (action === "HTTP_ACCESS_DENIED" && entityType === "HttpRequest" && metadata && typeof metadata === "object" && "status" in metadata && [401, 403].includes(Number(metadata.status))) return false;
  return true;
}
