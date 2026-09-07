declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void>;
    };
  }
}

export function registerDashboardTools(runRefresh: () => Promise<unknown>) {
  const context = document.modelContext;
  if (!context?.registerTool) return () => undefined;
  const lifecycle = new AbortController();
  void Promise.resolve(context.registerTool({
    name: "refresh_ltmh_wealthx_dashboard",
    title: "Update LTMH WealthX dashboard",
    description: "Check current mutual-fund AUM and official LTMH WealthX AUA sources, then refresh the model and dashboard.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: async () => runRefresh()
  }, { signal: lifecycle.signal })).catch(() => undefined);
  return () => lifecycle.abort();
}
