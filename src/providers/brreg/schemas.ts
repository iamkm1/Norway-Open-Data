import { z } from "zod";

const nullableString = z.string().nullable().optional();
const codeSchema = z
  .object({
    kode: z.string(),
    beskrivelse: nullableString,
  })
  .loose();

const municipalitySchema = z
  .object({
    kommunenummer: nullableString,
    kommunenavn: nullableString,
  })
  .loose();

const addressSchema = z
  .object({
    adresse: z
      .union([z.array(z.string()), z.string()])
      .nullable()
      .optional(),
    postnummer: nullableString,
    poststed: nullableString,
    kommune: z.union([municipalitySchema, z.string()]).nullable().optional(),
    kommunenummer: nullableString,
  })
  .loose();

export const companySchema = z
  .object({
    organisasjonsnummer: z.string(),
    navn: z.string(),
    organisasjonsform: codeSchema.nullable().optional(),
    naeringskode1: codeSchema.nullable().optional(),
    naeringskode2: codeSchema.nullable().optional(),
    naeringskode3: codeSchema.nullable().optional(),
    forretningsadresse: addressSchema.nullable().optional(),
    beliggenhetsadresse: addressSchema.nullable().optional(),
    postadresse: addressSchema.nullable().optional(),
    registreringsdatoEnhetsregisteret: nullableString,
    stiftelsesdato: nullableString,
    registrertIMvaregisteret: z.boolean().nullable().optional(),
    registrertIArbeidsgiverregisteret: z.boolean().nullable().optional(),
    konkurs: z.boolean().nullable().optional(),
    underAvvikling: z.boolean().nullable().optional(),
    antallAnsatte: z.number().int().nonnegative().nullable().optional(),
    hjemmeside: nullableString,
  })
  .loose();

export const companySearchSchema = z
  .object({
    _embedded: z
      .object({
        enheter: z.array(companySchema).optional(),
        underenheter: z.array(companySchema).optional(),
      })
      .loose()
      .optional(),
    page: z
      .object({
        size: z.number().int().nonnegative(),
        totalElements: z.number().int().nonnegative(),
        totalPages: z.number().int().nonnegative(),
        number: z.number().int().nonnegative(),
      })
      .loose(),
  })
  .loose();

export type RawCompany = z.infer<typeof companySchema>;
export type RawCompanySearch = z.infer<typeof companySearchSchema>;
