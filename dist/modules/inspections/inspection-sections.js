"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inspectionNotes = inspectionNotes;
function inspectionNotes(general, comments, compartments) {
    const seen = new Set();
    const blocks = general?.trim() ? [general.trim()] : [];
    for (const comment of comments) {
        const compartment = compartments.find((section) => section.id === comment.compartmentId);
        if (!compartment || seen.has(comment.compartmentId))
            throw new Error("Seccion ajena al movil o repetida");
        seen.add(comment.compartmentId);
        if (comment.observations.trim())
            blocks.push(`Seccion: ${compartment.name}\n${comment.observations.trim()}`);
    }
    const result = blocks.join("\n\n");
    if (result.length > 10000)
        throw new Error("Las observaciones generales y de secciones superan los 10000 caracteres");
    return result || null;
}
