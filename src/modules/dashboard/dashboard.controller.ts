import { Request, Response } from "express";
import { getDashboardSummary } from "./dashboard.service";
import { getOperationalReadiness } from "./readiness.service";

export async function getDashboardSummaryController(
  req: Request,
  res: Response,
) {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;

    if (!userId || !role) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const summary = await getDashboardSummary(userId, role);

    return res.status(200).json(summary);
  } catch (error: any) {
    return res.status(500).json({
      message: error.message || "No se pudo obtener el resumen operativo",
    });
  }
}

export async function getOperationalReadinessController(
  req: Request,
  res: Response,
) {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const readiness = await getOperationalReadiness();
    return res.status(200).json(readiness);
  } catch (error: any) {
    return res.status(500).json({
      message: error.message || "No se pudo calcular el alistamiento operativo",
    });
  }
}
