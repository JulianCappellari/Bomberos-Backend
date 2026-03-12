import { Request, Response } from "express";
import {
  approveApplication,
  createApplication,
  getAllApplications,
  getApplicationById,
  rejectApplication,
} from "./applications.service";
import {
  createApplicationSchema,
  rejectApplicationSchema,
} from "./applications.schemas";

export async function createApplicationController(req: Request, res: Response) {
  try {
    const parsed = createApplicationSchema.parse(req.body);
    const application = await createApplication(parsed);

    return res.status(201).json(application);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to create application",
    });
  }
}

export async function getAllApplicationsController(req: Request, res: Response) {
  try {
    const status =
      typeof req.query.status === "string" ? req.query.status : undefined;

    const applications = await getAllApplications(status);

    return res.status(200).json(applications);
  } catch (error: any) {
    return res.status(500).json({
      message: error.message || "Failed to fetch applications",
    });
  }
}

export async function getApplicationByIdController(req: Request, res: Response) {
  try {
    const applicationId = String(req.params.id);
    const application = await getApplicationById(applicationId);

    return res.status(200).json(application);
  } catch (error: any) {
    return res.status(404).json({
      message: error.message || "Application not found",
    });
  }
}

export async function approveApplicationController(req: Request, res: Response) {
  try {
    const applicationId = String(req.params.id);
    const actorUserId = req.user?.userId;

    if (!actorUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await approveApplication(applicationId, actorUserId);

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to approve application",
    });
  }
}

export async function rejectApplicationController(req: Request, res: Response) {
  try {
    const applicationId = String(req.params.id);
    const actorUserId = req.user?.userId;

    if (!actorUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const parsed = rejectApplicationSchema.parse(req.body);

    const result = await rejectApplication(
      applicationId,
      actorUserId,
      parsed.rejectReason,
    );

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Failed to reject application",
    });
  }
}