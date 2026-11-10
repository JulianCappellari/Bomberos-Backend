"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isolatedApiTest = isolatedApiTest;
const node_crypto_1 = require("node:crypto");
const node_child_process_1 = require("node:child_process");
const client_1 = require("@prisma/client");
async function isolatedApiTest(run) {
    if (process.env.NODE_ENV === "production")
        throw new Error("Prueba no autorizada en produccion");
    const original = process.env.DATABASE_URL;
    const schema = `api_verify_${(0, node_crypto_1.randomBytes)(8).toString("hex")}`;
    const url = new URL(original);
    url.searchParams.set("schema", schema);
    const root = new client_1.PrismaClient({ datasourceUrl: original });
    let initialized = false;
    try {
        (0, node_child_process_1.execFileSync)(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" });
        process.env.DATABASE_URL = url.toString();
        initialized = true;
        await run();
    }
    finally {
        if (initialized) {
            const { prisma } = await Promise.resolve().then(() => __importStar(require("../config/prisma")));
            await prisma.$disconnect();
        }
        process.env.DATABASE_URL = original;
        if (!/^api_verify_[a-f0-9]{16}$/.test(schema))
            throw new Error("Nombre temporal invalido");
        await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await root.$disconnect();
    }
}
