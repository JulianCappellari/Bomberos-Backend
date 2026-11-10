export function inspectionNotes(general: string | null | undefined, comments: Array<{ compartmentId: string; observations: string }>, compartments: Array<{ id: string; name: string }>) {
  const seen = new Set<string>();
  const blocks = general?.trim() ? [general.trim()] : [];
  for (const comment of comments) {
    const compartment = compartments.find((section) => section.id === comment.compartmentId);
    if (!compartment || seen.has(comment.compartmentId)) throw new Error("Seccion ajena al movil o repetida");
    seen.add(comment.compartmentId);
    if (comment.observations.trim()) blocks.push(`Seccion: ${compartment.name}\n${comment.observations.trim()}`);
  }
  const result = blocks.join("\n\n");
  if (result.length > 10000) throw new Error("Las observaciones generales y de secciones superan los 10000 caracteres");
  return result || null;
}
