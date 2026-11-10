export function publicWorkResponse(value:unknown):unknown{
 if(value instanceof Date||Buffer.isBuffer(value)||value===null)return value;
 if(Array.isArray(value))return value.map(publicWorkResponse);
 if(typeof value!=="object")return value;
 return Object.fromEntries(Object.entries(value).filter(([key])=>key!=="rankingRecoveryKey").map(([key,item])=>[key,key==="notes"&&item==="Asignación aleatoria de recuperación por puntaje bajo"?"Tarea asignada por jefatura":publicWorkResponse(item)]));
}
