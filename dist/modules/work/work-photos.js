"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeTaskPhotos = sanitizeTaskPhotos;
const sharp_1 = __importDefault(require("sharp"));
const node_crypto_1 = require("node:crypto");
const operations_schemas_1 = require("../operations/operations.schemas");
async function sanitizeTaskPhotos(encoded) {
    const result = [];
    for (const raw of encoded) {
        const input = Buffer.from(raw, "base64");
        const jpeg = input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
        const png = input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const webp = input.subarray(0, 4).toString() === "RIFF" && input.subarray(8, 12).toString() === "WEBP";
        if ((!jpeg && !png && !webp) || input.length > 187500)
            throw new operations_schemas_1.OperationError(400, "Foto invalida; use JPEG, PNG o WebP dentro del limite");
        try {
            const image = (0, sharp_1.default)(input, { limitInputPixels: 12000000, failOn: "warning" });
            const meta = await image.metadata();
            if (meta.pages && meta.pages > 1)
                throw new Error("Imagen animada");
            const bytes = await image.rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
            if (bytes.length > 250000)
                throw new Error("Foto demasiado grande");
            result.push({ bytes: new Uint8Array(bytes), sha256: (0, node_crypto_1.createHash)("sha256").update(bytes).digest("hex") });
        }
        catch {
            throw new operations_schemas_1.OperationError(400, "No se pudo validar la foto; el archivo esta danado o excede los limites");
        }
    }
    return result;
}
