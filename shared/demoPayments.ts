/** Sandbox-only contracts. No provider credentials. Demo credits now use the ordinary account balance. */
export const DEMO_FUNDING_METHODS = ['ach', 'card', 'zelle', 'bank', 'wire', 'direct_deposit', 'check', 'other'] as const;
export type DemoFundingMethod = typeof DEMO_FUNDING_METHODS[number];
export type DemoEvent = { id: string; method: string; amount_cents: number; status: 'pending' | 'completed' | 'declined'; reference: string; description: string; created_at: number };
export type DemoPreview = { id: string; name: string; identifier: string; amountCents: number; method: string; expiresAt: number; category: string };
export type DemoSnapshot = {
  demoMode: boolean; enabled: boolean; reason: string;
  member: { name: string; email: string; phone: string; phoneUsable: boolean; accountType: string };
  balanceCents: number | null; bankStatus: string; cardLinked: boolean;
  events: DemoEvent[];
  inbox: { id: string; recipient: string; subject: string; body: string; created_at: number }[];
};
export type DemoResult = { message: string; preview?: DemoPreview; result?: { reference: string; date: number; amount: number; balanceBefore: number; balanceAfter: number; reward: number; scout: number } };
