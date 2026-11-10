"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signAccessToken = signAccessToken;
exports.signRefreshToken = signRefreshToken;
exports.verifyAccessToken = verifyAccessToken;
exports.verifyRefreshToken = verifyRefreshToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
const node_crypto_1 = require("node:crypto");
const issuer = "bomberos-api";
const audience = "bomberos-app";
function signAccessToken(payload) {
    return jsonwebtoken_1.default.sign({ ...payload, tokenUse: "access" }, env_1.env.jwtAccessSecret, {
        algorithm: "HS256", issuer, audience, jwtid: (0, node_crypto_1.randomUUID)(),
        expiresIn: env_1.env.jwtAccessExpiresIn,
    });
}
function signRefreshToken(payload) {
    return jsonwebtoken_1.default.sign({ ...payload, tokenUse: "refresh" }, env_1.env.jwtRefreshSecret, {
        algorithm: "HS256", issuer, audience, jwtid: (0, node_crypto_1.randomUUID)(),
        expiresIn: env_1.env.jwtRefreshExpiresIn,
    });
}
function verifyAccessToken(token) {
    return verify(token, env_1.env.jwtAccessSecret, "access");
}
function verifyRefreshToken(token) {
    return verify(token, env_1.env.jwtRefreshSecret, "refresh");
}
function verify(token, secret, tokenUse) {
    const payload = jsonwebtoken_1.default.verify(token, secret, { algorithms: ["HS256"], issuer, audience });
    if (typeof payload === "string" || typeof payload.userId !== "string" || typeof payload.sessionId !== "string" ||
        typeof payload.role !== "string" || typeof payload.exp !== "number" || payload.tokenUse !== tokenUse) {
        throw new Error("Invalid session token");
    }
    return payload;
}
