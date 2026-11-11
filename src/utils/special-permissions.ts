import { NextFunction, Request, Response } from "express";
import { normalizeRank } from "./firefighter-ranks";

// B10/B11: permisos especiales independientes entre si; no vencen, rigen hasta su revocacion.
export const SPECIAL_PERMISSIONS = ["FLEET", "PPE", "TECHNICAL", "FINANCE"] as const;
export type SpecialPermission = (typeof SPECIAL_PERMISSIONS)[number];
export const SPECIAL_PERMISSION_LABELS: Record<SpecialPermission, string> = {
  FLEET: "Responsable de flota", PPE: "Encargado de vestimenta y materiales (EPP, stock y pedidos)", TECHNICAL: "Responsable técnico (ERA y certificaciones)", FINANCE: "Permiso financiero",
};
// Cargos que pueden recibir cada permiso. FINANCE: oficiales y comision directiva designada (O01).
const ELIGIBLE: Record<SpecialPermission, string[]> = {
  FLEET: ["oficial", "suboficial", "bombero"], PPE: ["oficial", "suboficial", "bombero"], TECHNICAL: ["oficial", "suboficial", "bombero"], FINANCE: ["oficial", "comisiondirectiva"],
};
export function permissionAllowedForRank(permission: SpecialPermission, rank?: string | null) {
  return ELIGIBLE[permission].includes(normalizeRank(rank).replace(/\s/g, ""));
}
export function hasPermission(user: { permissions?: string[] } | undefined, permission: SpecialPermission) {
  return Boolean(user?.permissions?.includes(permission));
}
// Permite el acceso por rol de sesion o por permiso especial designado.
export function authorizeOrPermission(permission: SpecialPermission, ...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.role) return res.status(401).json({ message: "Sesión no válida. Volvé a ingresar." });
    if (!roles.includes(req.user.role) && !hasPermission(req.user, permission)) return res.status(403).json({ message: "No tenés permiso para esta acción" });
    next();
  };
}
