import { z } from "zod";

const nullableString = z.string().nullable().optional();
const nonblankString = z.string().refine((value) => value.trim().length > 0);
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
    land: nullableString,
    landkode: nullableString,
    kommune: z.union([municipalitySchema, z.string()]).nullable().optional(),
    kommunenummer: nullableString,
  })
  .loose();

export const companySchema = z
  .object({
    organisasjonsnummer: z.string().regex(/^\d{9}$/),
    navn: nonblankString,
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
        size: z.number().int().positive(),
        totalElements: z.number().int().nonnegative(),
        totalPages: z.number().int().nonnegative(),
        number: z.number().int().nonnegative(),
      })
      .superRefine((page, context) => {
        const expectedPages =
          page.totalElements === 0 ? 0 : Math.ceil(page.totalElements / page.size);
        if (page.totalPages !== expectedPages) {
          context.addIssue({ code: "custom", message: "Inconsistent Brreg page totals." });
        }
      })
      .loose(),
  })
  .superRefine((response, context) => {
    const entities = response._embedded?.enheter ?? response._embedded?.underenheter ?? [];
    if (entities.length > response.page.size || entities.length > response.page.totalElements) {
      context.addIssue({ code: "custom", message: "Inconsistent Brreg returned-item count." });
    }
  })
  .loose();

export type RawCompany = z.infer<typeof companySchema>;
export type RawCompanySearch = z.infer<typeof companySearchSchema>;
