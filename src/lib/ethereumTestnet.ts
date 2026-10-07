import { displayUnits } from "../../shared/cryptoWorkspace.js";
import { validWallet } from "../../shared/walletAddress.js";

/** Minimal EIP-1193 surface used for a user-approved Sepolia native-ETH send. */
export type EvmWalletProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

export type SepoliaSendReview = {
  from: string;
  to: string;
  valueWei: string;
  gasLimit: string;
  gasPriceWei: string;
  estimatedFeeWei: string;
  balanceWei: string;
};

export type SepoliaReceipt = {
  transactionHash: string;
  blockNumber: string;
  status: "success" | "reverted";
};

export class SepoliaPreflightError extends Error { }
export class SepoliaWalletRejectedError extends Error { }
export class SepoliaSendOutcomeUnknownError extends Error { }

const SEPOLIA_CHAIN_ID = 11_155_111n;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/i;
const QUANTITY_PATTERN = /^0x[0-9a-f]+$/i;

function quantity(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !QUANTITY_PATTERN.test(value)) throw new Error(`The wallet returned an invalid ${label}.`);
  return BigInt(value);
}

function rpcQuantity(value: bigint): string {
  if (value < 0n) throw new Error("Invalid transaction quantity.");
  return `0x${value.toString(16)}`;
}

function address(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 120 || !validWallet("Ethereum", value)) {
    throw new Error(`Enter a valid Ethereum ${label} address.`);
  }
  return value;
}

export function parseEthToWei(input: string): bigint {
  const value = input.trim();
  if (!/^\d+(?:\.\d{1,18})?$/.test(value)) throw new Error("Enter an amount with up to 18 decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const wei = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0") || "0");
  if (wei <= 0n) throw new Error("Amount must be greater than zero.");
  return wei;
}

export const formatEthWei = (wei: string | bigint) => displayUnits(String(wei), 18);

async function assertSepolia(provider: EvmWalletProvider): Promise<void> {
  const chainId = quantity(await provider.request({ method: "eth_chainId" }), "network ID");
  if (chainId !== SEPOLIA_CHAIN_ID) throw new Error("Switch your wallet to Ethereum Sepolia testnet. Mainnet transfers are not available here.");
}

async function assertAccount(provider: EvmWalletProvider, expected: string): Promise<void> {
  await assertSepolia(provider);
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || accounts[0].toLowerCase() !== expected.toLowerCase()) {
    throw new Error("The wallet account changed. Reconnect and review the transfer again.");
  }
}

/** Requests public account access only; it never requests a signature. */
export async function connectSepoliaWallet(provider: EvmWalletProvider): Promise<string> {
  await assertSepolia(provider);
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || !accounts.length) throw new Error("No Ethereum account was shared by the wallet.");
  const from = address(accounts[0], "sender");
  await assertAccount(provider, from);
  return from;
}

/** Revalidates chain/account, balance and a fee estimate for an explicit review. */
export async function reviewSepoliaSend(provider: EvmWalletProvider, fromValue: string, toValue: string, amount: string): Promise<SepoliaSendReview> {
  const from = address(fromValue, "sender");
  const to = address(toValue.trim(), "recipient");
  const value = parseEthToWei(amount);
  await assertAccount(provider, from);
  const tx = { from, to, value: rpcQuantity(value) };
  const [balanceRaw, gasRaw, gasPriceRaw] = await Promise.all([
    provider.request({ method: "eth_getBalance", params: [from, "latest"] }),
    provider.request({ method: "eth_estimateGas", params: [tx] }),
    provider.request({ method: "eth_gasPrice" }),
  ]);
  const balance = quantity(balanceRaw, "wallet balance");
  const gasLimit = quantity(gasRaw, "gas estimate");
  const gasPrice = quantity(gasPriceRaw, "gas price");
  if (gasLimit <= 0n || gasPrice <= 0n) throw new Error("The wallet returned an invalid Sepolia fee estimate.");
  const fee = gasLimit * gasPrice;
  if (balance < value + fee) throw new Error("Insufficient Sepolia ETH for the amount and estimated network fee.");
  return { from, to, valueWei: value.toString(), gasLimit: gasLimit.toString(), gasPriceWei: gasPrice.toString(), estimatedFeeWei: fee.toString(), balanceWei: balance.toString() };
}

/** Hands one native-ETH transfer to the wallet for explicit user approval. */
export async function sendSepoliaTransfer(provider: EvmWalletProvider, review: SepoliaSendReview): Promise<string> {
  try { await assertAccount(provider, review.from); }
  catch (cause) { throw new SepoliaPreflightError(cause instanceof Error ? cause.message : "The wallet changed before approval. Review the transfer again."); }
  const transaction = {
    from: review.from,
    to: address(review.to, "recipient"),
    value: rpcQuantity(BigInt(review.valueWei)),
  };
  let result: unknown;
  try { result = await provider.request({ method: "eth_sendTransaction", params: [transaction] }); }
  catch (cause) {
    const error = cause && typeof cause === "object" ? cause as { code?: unknown; message?: unknown } : {};
    if (error.code === 4001 || (typeof error.message === "string" && /user (rejected|denied|cancelled)/i.test(error.message))) {
      throw new SepoliaWalletRejectedError("The wallet request was rejected. No transfer was approved.");
    }
    // An RPC transport error can arrive after the wallet has broadcast. Do not
    // invite a second send unless we have a trustworthy rejection or hash.
    throw new SepoliaSendOutcomeUnknownError("The wallet response was inconclusive. Do not retry until you check the wallet's Sepolia activity.");
  }
  if (typeof result !== "string" || !HASH_PATTERN.test(result)) {
    throw new SepoliaSendOutcomeUnknownError("The wallet did not return a usable transaction hash. Check wallet activity before trying again.");
  }
  return result.toLowerCase();
}

/** Read-only status lookup. A null result means the network has not mined it yet. */
export async function readSepoliaReceipt(provider: EvmWalletProvider, expectedHash: string): Promise<SepoliaReceipt | null> {
  if (!HASH_PATTERN.test(expectedHash)) throw new Error("Invalid transaction hash.");
  await assertSepolia(provider);
  const raw = await provider.request({ method: "eth_getTransactionReceipt", params: [expectedHash] });
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") throw new Error("The wallet returned an invalid transaction receipt.");
  const receipt = raw as { transactionHash?: unknown; blockNumber?: unknown; status?: unknown };
  if (typeof receipt.transactionHash !== "string" || receipt.transactionHash.toLowerCase() !== expectedHash.toLowerCase()) throw new Error("The wallet returned a receipt for a different transaction.");
  const blockNumber = quantity(receipt.blockNumber, "receipt block number");
  const status = quantity(receipt.status, "receipt status");
  if (status !== 0n && status !== 1n) throw new Error("The wallet returned an unsupported transaction status.");
  return { transactionHash: expectedHash.toLowerCase(), blockNumber: blockNumber.toString(), status: status === 1n ? "success" : "reverted" };
}
