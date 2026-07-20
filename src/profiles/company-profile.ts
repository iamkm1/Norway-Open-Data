import type { NorwegianAddress } from "../providers/kartverket/types.js";

/** @internal */
export type AddressMatch = {
  address: NorwegianAddress;
  matchConfidence: "exact" | "high" | "possible";
};

function normalized(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleUpperCase("nb-NO")
    .replaceAll(/[^A-ZÆØÅ0-9]/g, "");
}

function comparableAddress(address: NorwegianAddress): string {
  if (address.addressText !== undefined) return normalized(address.addressText);
  return normalized(
    `${address.streetName ?? ""} ${address.houseNumber ?? ""}${address.letter ?? ""}`,
  );
}

function same(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && right !== undefined && normalized(left) === normalized(right);
}

/** Deterministically selects the strongest official-address match. */
export function selectAddressMatch(
  businessAddress: NorwegianAddress,
  candidates: NorwegianAddress[],
): AddressMatch | undefined {
  const expectedAddress = comparableAddress(businessAddress);
  const ranked = candidates.map((address, index) => {
    const addressMatches =
      expectedAddress.length > 0 && comparableAddress(address) === expectedAddress;
    const postalMatches = same(businessAddress.postalCode, address.postalCode);
    const municipalityMatches = same(businessAddress.municipalityCode, address.municipalityCode);
    let score = 1;
    let matchConfidence: AddressMatch["matchConfidence"] = "possible";
    if (addressMatches && postalMatches && municipalityMatches) {
      score = 3;
      matchConfidence = "exact";
    } else if (addressMatches && (postalMatches || municipalityMatches)) {
      score = 2;
      matchConfidence = "high";
    }
    return { address, score, matchConfidence, index };
  });
  ranked.sort((left, right) => right.score - left.score || left.index - right.index);
  const best = ranked[0];
  return best === undefined
    ? undefined
    : { address: best.address, matchConfidence: best.matchConfidence };
}
