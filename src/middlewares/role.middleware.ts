import { NextFunction, Request, Response } from "express";

export function authorize(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
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