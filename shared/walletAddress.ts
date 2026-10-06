import { base58, bech32, bech32m } from "@scure/base";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";

export function validWallet(network: string, address: string): boolean {
  try {
    if (["Ethereum", "BNB Smart Chain", "Avalanche C-Chain"].includes(network)) {
      if (!/^0x[\da-fA-F]{40}$/.test(address) || /^0x0{40}$/.test(address)) return false;
      const body = address.slice(2);
      if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
      const hash = Array.from(keccak_256(new TextEncoder().encode(body.toLowerCase())), byte => byte.toString(16).padStart(2, "0")).join("");
      return [...body].every((c, i) => !/[a-fA-F]/.test(c) || (parseInt(hash[i], 16) >= 8 ? c === c.toUpperCase() : c === c.toLowerCase()));
    }
    if (network === "Solana") return base58.decode(address).length === 32 && address !== "11111111111111111111111111111111";
    if (network === "Bitcoin") {
      if (/^bc1/i.test(address)) {
        for (const codec of [bech32, bech32m]) {
          try {
            const decoded = codec.decode(address as `${string}1${string}`);
            const version = decoded.words[0], program = codec.fromWords(decoded.words.slice(1));
            if (decoded.prefix !== "bc" || version > 16) continue;
            if (version === 0 && codec === bech32 && [20, 32].includes(program.length)) return true;
            if (version > 0 && codec === bech32m && program.length >= 2 && program.length <= 40) return true;
          } catch { /* Try the other checksum variant. */ }
        }
        return false;
      }
      const bytes = base58.decode(address);
      if (bytes.length !== 25 || ![0, 5].includes(bytes[0])) return false;
      const checksum = sha256(sha256(bytes.subarray(0, 21))).subarray(0, 4);
      return checksum.every((byte, i) => byte === bytes[21 + i]);
    }
  } catch { return false; }
  return false;
}
