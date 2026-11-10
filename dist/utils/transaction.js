"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializable = serializable;
const client_1 = require("@prisma/client");
const prisma_1 = require("../config/prisma");
async function serializable(work) {
    for (let attempt = 0;; attempt++) {
        try {
            return await prisma_1.prisma.$transaction(work, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2)
                continue;
            throw error;
        }
    }
}
