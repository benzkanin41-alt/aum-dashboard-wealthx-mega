const API_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...API_HEADERS, ...extraHeaders } });
}

export function apiError(message: string, status = 500, details?: unknown) {
  return json({ ok: false, error: message, details: details || null }, status);
}

export function optionsResponse() {
  return new Response(null, { status: 204, headers: API_HEADERS });
}
