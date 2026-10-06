import { ASSETS } from "./catalog.js";
/** One self-hosted identity per supported asset, shared by every crypto surface. */
export const assetIcon = (code: string): string =>
  ASSETS.some(asset => asset.code === code.toUpperCase())
    ? `/images/crypto/${code.toLowerCase()}.svg`
    : `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="#443173"/><text x="20" y="24" text-anchor="middle" fill="white" font-family="sans-serif" font-size="11">${code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5)}</text></svg>`)}`;
