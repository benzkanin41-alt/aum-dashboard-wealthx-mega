/// <reference types="vite/client" />

const origin = import.meta.env.VITE_DASHBOARD_API_ORIGIN || "";

export function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  return fetch(origin ? new URL(path, origin).href : path, init);
}
