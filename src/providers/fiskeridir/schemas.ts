/**
 * Runtime schemas for the Fiskeridirektoratet vessel and aquaculture registers.
 *
 * Field names and nullability mirror the `Vessel`, `Owner` and `Site` schemas in
 * the two registers' published OpenAPI documents.
 */
import { z } from "zod";

/**
 * An owner entry, with natural-person details removed during validation.
 *
 * The removal happens here rather than in the client on purpose. The HTTP client
 * validates before caching and hands the schema's output to callers as the
 * `{ includeRaw: true }` payload, so stripping at this point keeps the personal
 * fields out of the response, out of the raw payload and out of the SDK cache in
 * one place. Doing it in the client would leave them in the other two.
 *
 * An `entityType` this SDK does not recognize is treated as a person, so a value
 * the register adds later withholds by default instead of publishing by default.
 */
const ownerSchema = z
  .object({
    id: z.string().nullish(),
    entityType: z.string().nullish(),
    name: z.string().nullish(),
    postalCode: z.string().nullish(),
    city: z.string().nullish(),
  })
  .transform((owner) => {
    if (owner.entityType?.toUpperCase() !== "COMPANY") return { entityType: "person" as const };
    // The register uses the organization number as a company owner's id.
    const organizationNumber =
      owner.id !== null && owner.id !== undefined && /^\d{9}$/.test(owner.id)
        ? owner.id
        : undefined;
    return {
      entityType: "company" as const,
      ...(organizationNumber === undefined ? {} : { organizationNumber }),
      ...(owner.name === null || owner.name === undefined ? {} : { name: owner.name }),
      ...(owner.postalCode === null || owner.postalCode === undefined
        ? {}
        : { postalCode: owner.postalCode }),
      ...(owner.city === null || owner.city === undefined ? {} : { city: owner.city }),
    };
  });

export const fishingVesselSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  registrationMark: z.string().nullish(),
  radioCallSign: z.string().nullish(),
  imoNumber: z.string().nullish(),
  municipalityCode: z.string().nullish(),
  tonnageType: z.string().nullish(),
  tonnage: z.number().nullish(),
  width: z.number().nullish(),
  length: z.number().nullish(),
  enginePower: z.number().int().nullish(),
  engineBuildYear: z.number().int().nullish(),
  buildYear: z.number().int().nullish(),
  rebuildYear: z.number().int().nullish(),
  measureDate: z.string().nullish(),
  registrationDate: z.string().nullish(),
  owners: z.array(ownerSchema).nullish(),
});

/** @internal */
export type RawFishingVessel = z.infer<typeof fishingVesselSchema>;

/** The vessel register returns a bare array for a search. */
export const fishingVesselListSchema = z.array(fishingVesselSchema);

const areaPlacementSchema = z.object({
  municipalityCode: z.string().nullish(),
  municipalityName: z.string().nullish(),
  countyCode: z.string().nullish(),
  countyName: z.string().nullish(),
  prodAreaCode: z.string().nullish(),
  prodAreaName: z.string().nullish(),
  prodAreaStatus: z.string().nullish(),
});

const siteConnectionSchema = z.object({
  licenseNr: z.string().nullish(),
  validFrom: z.string().nullish(),
  validTo: z.string().nullish(),
});

export const aquacultureSiteSchema = z.object({
  siteNr: z.number().int(),
  name: z.string().nullish(),
  placementType: z.string().nullish(),
  waterType: z.string().nullish(),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  capacity: z.number().nullish(),
  tempCapacity: z.number().nullish(),
  capacityUnitType: z.string().nullish(),
  firstClearanceTime: z.string().nullish(),
  placement: areaPlacementSchema.nullish(),
  // The register documents `speciesType` and `speciesTypeValue` as retired and
  // always null, so neither is read; `speciesTypes` is the live field.
  speciesTypes: z.array(z.string()).nullish(),
  isSlaughtery: z.boolean().nullish(),
  hasCommercialActivity: z.boolean().nullish(),
  connections: z.array(siteConnectionSchema).nullish(),
});

/** @internal */
export type RawAquacultureSite = z.infer<typeof aquacultureSiteSchema>;

/** The aquaculture register returns a bare array for a search. */
export const aquacultureSiteListSchema = z.array(aquacultureSiteSchema);
