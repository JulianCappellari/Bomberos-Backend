// Solo para pruebas: cuando una accion critica responde 428 (falta confirmar la contrasena), confirma con la
// contrasena de prueba y reintenta con la cabecera X-Step-Up, igual que hace la aplicacion real. La
// confirmacion se reutiliza por sesion (como en la app) y los pedidos simultaneos comparten una sola.
export function enableAutoStepUp(password: () => string) {
  const original = globalThis.fetch;
  const tokens = new Map<string, Promise<string | null>>();
  async function confirm(origin: string, auth: string) {
    const response = await original(`${origin}/api/auth/confirm`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: auth }, body: JSON.stringify({ password: password() }) });
    return response.ok ? ((await response.json()) as { token: string }).token : null;
  }
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const auth = headers.get("Authorization");
    const cached = auth ? await tokens.get(auth) : null;
    if (cached && !headers.has("X-Step-Up")) headers.set("X-Step-Up", cached);
    const response = await original(input, { ...init, headers });
    if (response.status !== 428 || !auth) return response;
    const body = (await response.clone().json().catch(() => null)) as { code?: string } | null;
    if (body?.code !== "STEP_UP_REQUIRED") return response;
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    let pending = tokens.get(auth);
    if (!pending || (await pending) === cached) { pending = confirm(url.origin, auth); tokens.set(auth, pending); }
    const token = await pending;
    if (!token) return response;
    headers.set("X-Step-Up", token);
    return original(input, { ...init, headers });
  };
  return () => { globalThis.fetch = original; };
}
