import { z } from "zod";

const microsoftDateSchema = z.string().regex(/^\/Date\(-?\d+(?:[+-]\d{4})?\)\/$/);
const nullableMicrosoftDate = microsoftDateSchema.nullable().optional();
const nullableString = z.string().nullable().optional();
const nullableInteger = z.number().int().nullable().optional();

const partySchema = z.object({
  id: nullableString,
  navn: nullableString,
});

const countySchema = z.object({
  id: nullableString,
  navn: nullableString,
});

export const representativeSchema = z.object({
  id: nullableString,
  fornavn: nullableString,
  etternavn: nullableString,
  parti: partySchema.nullable().optional(),
  fylke: countySchema.nullable().optional(),
});

export const representativesResponseSchema = z.object({
  representanter_liste: z.array(representativeSchema),
  stortingsperiode_id: nullableString,
});

export const currentRepresentativesResponseSchema = z.object({
  dagensrepresentanter_liste: z.array(representativeSchema),
});

export const representativeListResponseSchema = z
  .object({
    representanter_liste: z.array(representativeSchema).optional(),
    dagensrepresentanter_liste: z.array(representativeSchema).optional(),
    stortingsperiode_id: nullableString,
  })
  .refine(
    (value) =>
      value.representanter_liste !== undefined || value.dagensrepresentanter_liste !== undefined,
    { message: "A representative list is required." },
  );

export const partiesResponseSchema = z.object({
  partier_liste: z.array(
    z.object({
      id: z.string().min(1),
      navn: z.string().min(1),
    }),
  ),
  sesjon_id: nullableString,
  stortingsperiode_id: nullableString,
});

const committeeSchema = z.object({
  id: nullableString,
  navn: nullableString,
});

export const parliamentaryCaseSchema = z.object({
  id: z.number().int().positive(),
  tittel: z.string().min(1),
  korttittel: nullableString,
  henvisning: nullableString,
  status: z.number().int(),
  type: z.number().int(),
  sak_sesjon: nullableString,
  dato: nullableMicrosoftDate,
  sist_oppdatert_dato: nullableMicrosoftDate,
  komite: committeeSchema.nullable().optional(),
  ferdigbehandlet: z.boolean().optional(),
});

export const casesResponseSchema = z.object({
  saker_liste: z.array(parliamentaryCaseSchema),
  sesjon_id: z.string().min(1),
});

export const votesResponseSchema = z.object({
  sak_id: z.number().int().positive(),
  sak_votering_liste: z.array(
    z.object({
      votering_id: z.number().int().positive(),
      sak_id: z.number().int().positive(),
      votering_tid: nullableMicrosoftDate,
      vedtatt: z.boolean(),
      votering_resultat_type: z.number().int(),
      votering_resultat_type_tekst: nullableString,
      antall_for: nullableInteger,
      antall_mot: nullableInteger,
      antall_ikke_tilstede: nullableInteger,
    }),
  ),
});

const questionPersonSchema = z.object({
  id: nullableString,
  fornavn: nullableString,
  etternavn: nullableString,
});

export const questionsResponseSchema = z.object({
  sesjon_id: z.string().min(1),
  sporsmal_liste: z.array(
    z.object({
      id: z.number().int().positive(),
      legacy_id: nullableInteger,
      sporsmal_nummer: nullableInteger,
      tittel: z.string().min(1),
      type: z.number().int(),
      status: z.number().int(),
      sesjon_id: z.string().min(1),
      datert_dato: nullableMicrosoftDate,
      sendt_dato: nullableMicrosoftDate,
      besvart_dato: nullableMicrosoftDate,
      sporsmal_fra: questionPersonSchema.nullable().optional(),
      besvart_av: questionPersonSchema.nullable().optional(),
    }),
  ),
});

export const meetingsResponseSchema = z.object({
  sesjon_id: z.string().min(1),
  moter_liste: z.array(
    z.object({
      id: z.number().int(),
      mote_dato_tid: nullableMicrosoftDate,
      mote_ting: z.number().int(),
      mote_rekkefolge: nullableInteger,
      dagsorden_nummer: nullableInteger,
      referat_id: nullableString,
      merknad: nullableString,
      ikke_motedag_tekst: nullableString,
    }),
  ),
});

export type RawRepresentative = z.infer<typeof representativeSchema>;
export type RawParliamentaryCase = z.infer<typeof parliamentaryCaseSchema>;
export type RawVotesResponse = z.infer<typeof votesResponseSchema>;
export type RawQuestionsResponse = z.infer<typeof questionsResponseSchema>;
export type RawMeetingsResponse = z.infer<typeof meetingsResponseSchema>;
