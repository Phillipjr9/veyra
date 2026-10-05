import { useEffect, useState } from "react";
import { apiGet } from "./api";

type Profile = Record<string, string | undefined>;

/** One-line mailing address from the member's application (business address for business accounts). */
export function formatMailingAddress(profile: Profile | null | undefined, business: boolean): string {
  if (!profile) return "";
  const k = (personal: string, biz: string) => ((business && profile[biz] ? profile[biz] : profile[personal]) || "").trim();
  const line1 = k("addressLine1", "bizAddressLine1");
  if (!line1) return "";
  const city = [k("city", "bizCity"), [k("state", "bizState"), k("postalCode", "bizPostalCode")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [line1, k("addressLine2", "bizAddressLine2"), city].filter(Boolean).join(", ");
}

/** Loads the signed-in member's mailing address once; "" until known (or if none is on file). */
export function useMailingAddress(business: boolean): string {
  const [address, setAddress] = useState("");
  useEffect(() => {
    let live = true;
    apiGet<{ profile: Profile | null }>("/api/me/profile")
      .then(({ profile }) => { if (live) setAddress(formatMailingAddress(profile, business)); })
      .catch(() => { /* leave the field for the member to fill in */ });
    return () => { live = false; };
  }, [business]);
  return address;
}
