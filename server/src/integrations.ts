import type { DatabaseSync } from "node:sqlite";
import { getSetting, setSetting } from "./db.js";
import { INTEGRATIONS, integrationById, integrationForFundingKind, type IntegrationDef } from "../../shared/integrations.js";
import { stripeConfig } from "./stripe.js";
import { demoPaymentsEnabled } from "./demoPayments.js";

export type IntegrationCheck = { label: string; done: boolean };
export type IntegrationStatus = {
  id: string; label: string; group: string; description: string;
  on: boolean; ready: boolean; available: boolean; checks: IntegrationCheck[];
};

/**
 * Switches are stored in `settings` as `integration.<id>` = "on" | "off".
 * An integration with no stored value is on. Members can use an integration only
 * when it is switched on and every setup check passes.
 */
export function createIntegrations(db: DatabaseSync) {
  const key = (id: string) => `integration.${id}`;
  const isOn = (id: string) => getSetting(db, key(id)) !== "off";

  const checksFor = (def: IntegrationDef): IntegrationCheck[] => {
    const checks: IntegrationCheck[] = [];
    // Mock payment mode (preview only) stands in for the provider, so every method stays demonstrable there.
    if (demoPaymentsEnabled() && def.provider) return checks;
    if (def.provider === "stripe") checks.push({ label: "Payment provider credentials are configured", done: stripeConfig().enabled });
    if (!def.implemented) checks.push({ label: "Provider integration is built and verified", done: false });
    return checks;
  };

  const status = (def: IntegrationDef): IntegrationStatus => {
    const on = isOn(def.id);
    const checks = checksFor(def);
    const ready = checks.every(check => check.done);
    return { id: def.id, label: def.label, group: def.group, description: def.description, on, ready, available: on && ready, checks };
  };

  /** Whether members may use an integration right now. */
  const available = (id: string): boolean => {
    const def = integrationById(id);
    return def ? status(def).available : false;
  };

  /** Funding kinds with no integration entry (e.g. Zelle) are not gated here. */
  const fundingKindAvailable = (kind: string): boolean => {
    const def = integrationForFundingKind(kind);
    return def ? status(def).available : true;
  };

  const availableFundingKinds = (): string[] => INTEGRATIONS
    .filter(def => def.fundingKind && status(def).available)
    .map(def => def.fundingKind as string);

  const list = () => INTEGRATIONS.map(status);

  const setOn = (id: string, on: boolean, userId: string) => {
    setSetting(db, key(id), on ? "on" : "off", userId);
  };

  return { list, status: (id: string) => { const def = integrationById(id); return def ? status(def) : undefined; }, available, fundingKindAvailable, availableFundingKinds, setOn, isOn };
}

export type Integrations = ReturnType<typeof createIntegrations>;
