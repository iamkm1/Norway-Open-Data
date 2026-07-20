import { z } from "zod";

const nullableString = z.string().nullable().optional();
const pointSchema = z
  .object({
    lat: z.number().optional(),
    lon: z.number().optional(),
    nord: z.number().optional(),
    øst: z.number().optional(),
    ost: z.number().optional(),
  })
  .loose();

export const addressResponseSchema = z
  .object({
    metadata: z
      .object({
        totaltAntallTreff: z.number().int().nonnegative(),
      })
      .loose(),
    adresser: z.array(
      z
        .object({
          adressetekst: nullableString,
          adressenavn: nullableString,
          nummer: z.number().nullable().optional(),
          bokstav: nullableString,
          postnummer: nullableString,
          poststed: nullableString,
          kommunenummer: nullableString,
          kommunenavn: nullableString,
          fylkesnummer: nullableString,
          fylkesnavn: nullableString,
          representasjonspunkt: pointSchema.optional(),
        })
        .loose(),
    ),
  })
  .loose();

const areaSchema = z
  .object({
    kommunenummer: z.string().optional(),
    kommunenavn: z.string().optional(),
    fylkesnummer: z.string().optional(),
    fylkesnavn: z.string().optional(),
  })
  .loose();

const spellingSchema = z
  .object({
    skrivemåte: z.string(),
  })
  .loose();

export const placeResponseSchema = z
  .object({
    metadata: z
      .object({
        totaltAntallTreff: z.number().int().nonnegative(),
      })
      .loose(),
    navn: z.array(
      z
        .object({
          skrivemåte: z.string().optional(),
          navneobjekttype: z.string().nullable().optional(),
          kommuner: z.array(areaSchema).optional(),
          fylker: z.array(areaSchema).optional(),
          representasjonspunkt: pointSchema.optional(),
          stedsnavn: z.array(spellingSchema).optional(),
        })
        .loose(),
    ),
  })
  .loose();

export type RawAddressResponse = z.infer<typeof addressResponseSchema>;
export type RawPlaceResponse = z.infer<typeof placeResponseSchema>;
