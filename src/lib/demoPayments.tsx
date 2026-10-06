import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiGet, apiPost } from './api';
import type { DemoResult, DemoSnapshot } from '../../shared/demoPayments';

type DemoContext = { data: DemoSnapshot | null; error: string; refresh: () => Promise<void>; act: (body: Record<string, unknown>) => Promise<DemoResult> };
const Context = createContext<DemoContext | null>(null);
export const demoError = (e: unknown) => e instanceof Error ? e.message : 'Payment request failed. Retry with the same details to safely retrieve the result.';
export function DemoPaymentsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DemoSnapshot | null>(null), [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { const next = await apiGet<DemoSnapshot>("/api/me/demo-payments"); setData(next); setError(''); }
    catch (e) { setError(demoError(e)); throw e; }
  }, []);
  useEffect(() => { void refresh().catch(() => {}); }, [refresh]);
  const act = useCallback(async (body: Record<string, unknown>) => {
    const result = await apiPost<DemoResult>("/api/me/demo-payments/action", body);
    // A refresh failure must not misreport an already committed operation as failed.
    await refresh().catch(() => {});
    return result;
  }, [refresh]);
  return <Context.Provider value={{ data, error, refresh, act }}>{children}</Context.Provider>;
}
export function useDemoPayments() {
  const value = useContext(Context);
  if (!value) throw new Error('DemoPaymentsProvider is required.');
  return value;
}
