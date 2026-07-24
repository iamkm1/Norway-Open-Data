import { z } from "zod";

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function containsNoControlCharacters(value: string): boolean {
  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

/** Strict ISO calendar date accepted by Klass date and range parameters. */
export const klassDateSchema = z
  .string()
  .refine(isIsoCalendarDate, "Expected a valid ISO calendar date (YYYY-MM-DD).");

const klassDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/,
    "Expected an ISO 8601 date-time with a UTC offset.",
  )
  .refine((value) => !Number.isNaN(Date.parse(value)), "Expected a valid ISO 8601 date-time.");

export const klassLanguageSchema = z.enum(["nb", "nn", "en"]);

const klassIdentifierSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nullableTextSchema = z.string().nullable().optional();
const pageInputSchema = z.number().int().nonnegative().max(10_000).optional();
const pageSizeInputSchema = z.number().int().min(1).max(100).optional();
const rawCodeValueSchema = z
  .string()
  .min(1)
  .max(128)
  .refine(containsNoControlCharacters, "Codes must not contain control characters.");
const codeInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine(containsNoControlCharacters, "Codes must not contain control characters.");
const exactCodeInputSchema = codeInputSchema.refine(
  (value) => !value.includes(",") && !value.includes("*"),
  "Exact codes must not contain commas or wildcards.",
);
const codePatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(containsNoControlCharacters, "Code patterns must not contain control characters.")
  .refine((value) => !value.includes(","), "A code pattern must not contain commas.");
const levelInputSchema = z.string().trim().min(1).max(64).optional();

const klassLinkSchema = z
  .object({
    href: z.string().min(1),
    hreflang: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    deprecation: z.string().nullable().optional(),
    profile: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    templated: z.boolean().optional(),
  })
  .strict();

const klassLinksSchema = z.record(z.string(), klassLinkSchema);

const klassRepresentationModelSchema = z
  .object({
    _links: klassLinksSchema.optional(),
  })
  .strict();

const klassEmbeddedRepresentationSchema = z
  .object({
    representationModelList: z.array(klassRepresentationModelSchema).optional(),
  })
  .strict();

const klassPageMetadataSchema = z
  .object({
    size: z.number().int().nonnegative(),
    totalElements: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    number: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.size === 0 && page.totalElements > 0) {
      context.addIssue({ code: "custom", message: "A non-empty Klass page must have a size." });
      return;
    }
    const expectedPages = page.totalElements === 0 ? 0 : Math.ceil(page.totalElements / page.size);
    if (page.totalPages !== expectedPages) {
      context.addIssue({ code: "custom", message: "Inconsistent Klass page totals." });
    }
  });

const klassContactPersonSchema = z
  .object({
    name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
  })
  .strict();

const klassLevelSchema = z
  .object({
    levelNumber: z.number().int().positive(),
    levelName: z.string(),
  })
  .strict();

const klassChangelogSchema = z
  .object({
    // `changeOccured` is the spelling in the official Klass payload.
    changeOccured: klassDateTimeSchema.nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .strict();

const resourceEnvelopeShape = {
  _links: klassLinksSchema.optional(),
  _embedded: klassEmbeddedRepresentationSchema.optional(),
  page: klassPageMetadataSchema.optional(),
};

const klassVersionSummarySchema = z
  .object({
    name: z.string(),
    id: klassIdentifierSchema,
    validFrom: klassDateSchema,
    validTo: klassDateSchema.nullable().optional(),
    lastModified: klassDateTimeSchema,
    published: z.array(klassLanguageSchema),
    ...resourceEnvelopeShape,
  })
  .strict();

const klassClassificationSummarySchema = z
  .object({
    name: z.string(),
    id: klassIdentifierSchema,
    classificationType: z.string().min(1),
    classificationFamilyId: klassIdentifierSchema.nullable().optional(),
    lastModified: klassDateTimeSchema,
    description: nullableTextSchema,
    ...resourceEnvelopeShape,
  })
  .strict();

/** Raw HAL page returned by `GET /classifications`. */
export const klassClassificationPageSchema = z
  .object({
    _embedded: z
      .object({
        classifications: z.array(klassClassificationSummarySchema),
      })
      .strict()
      .optional(),
    _links: klassLinksSchema,
    page: klassPageMetadataSchema,
  })
  .strict()
  .superRefine((response, context) => {
    const items = response._embedded?.classifications ?? [];
    if (items.length > response.page.size || items.length > response.page.totalElements) {
      context.addIssue({ code: "custom", message: "Inconsistent Klass classification count." });
    }
  });

const klassClassificationSearchHitSchema = z
  .object({
    name: z.string(),
    id: klassIdentifierSchema,
    language: klassLanguageSchema,
    snippet: z.string(),
    searchScore: z.number(),
    ...resourceEnvelopeShape,
  })
  .strict();

/** Raw HAL page returned by `GET /classifications/search`. */
export const klassClassificationSearchPageSchema = z
  .object({
    _embedded: z
      .object({
        searchResults: z.array(klassClassificationSearchHitSchema),
      })
      .strict()
      .optional(),
    _links: klassLinksSchema,
    page: klassPageMetadataSchema,
  })
  .strict()
  .superRefine((response, context) => {
    const items = response._embedded?.searchResults ?? [];
    if (items.length > response.page.size || items.length > response.page.totalElements) {
      context.addIssue({ code: "custom", message: "Inconsistent Klass search-result count." });
    }
  });

/** Full raw classification metadata and its embedded version summaries. */
export const klassClassificationSchema = z
  .object({
    name: z.string(),
    id: klassIdentifierSchema,
    classificationType: z.string().min(1),
    lastModified: klassDateTimeSchema,
    description: nullableTextSchema,
    primaryLanguage: klassLanguageSchema.nullable().optional(),
    copyrighted: z.boolean().optional(),
    includeShortName: z.boolean().optional(),
    includeNotes: z.boolean().optional(),
    contactPerson: klassContactPersonSchema.nullable().optional(),
    owningSection: nullableTextSchema,
    statisticalUnits: z.array(z.string()),
    versions: z.array(klassVersionSummarySchema),
    classificationFamilyId: klassIdentifierSchema.nullable().optional(),
    ...resourceEnvelopeShape,
  })
  .strict();

const klassCorrespondenceTableSummarySchema = z
  .object({
    name: z.string(),
    id: klassIdentifierSchema,
    contactPerson: klassContactPersonSchema.nullable().optional(),
    owningSection: nullableTextSchema,
    source: z.string(),
    sourceId: klassIdentifierSchema,
    target: z.string(),
    targetId: klassIdentifierSchema,
    changeTable: z.boolean(),
    lastModified: klassDateTimeSchema,
    published: z.array(klassLanguageSchema),
    sourceLevel: klassLevelSchema.nullable().optional(),
    targetLevel: klassLevelSchema.nullable().optional(),
    ...resourceEnvelopeShape,
  })
  .strict();

const klassVariantSummarySchema = z
  .object({
    name: z.string(),
    id: klassIdentifierSchema,
    contactPerson: klassContactPersonSchema.nullable().optional(),
    owningSection: nullableTextSchema,
    lastModified: klassDateTimeSchema,
    published: z.array(klassLanguageSchema),
    ...resourceEnvelopeShape,
  })
  .strict();

const klassClassificationItemSchema = z
  .object({
    code: rawCodeValueSchema,
    parentCode: z.string().nullable().optional(),
    level: z.string(),
    name: z.string(),
    shortName: nullableTextSchema,
    notes: nullableTextSchema,
    validFrom: klassDateSchema.nullable().optional(),
    validTo: klassDateSchema.nullable().optional(),
  })
  .strict();

/** Full raw version payload, including the provider's unpaged embedded code list. */
export const klassVersionSchema = z
  .object({
    name: z.string(),
    id: klassIdentifierSchema,
    validFrom: klassDateSchema,
    validTo: klassDateSchema.nullable().optional(),
    lastModified: klassDateTimeSchema,
    published: z.array(klassLanguageSchema),
    introduction: nullableTextSchema,
    contactPerson: klassContactPersonSchema.nullable().optional(),
    owningSection: nullableTextSchema,
    legalBase: nullableTextSchema,
    publications: nullableTextSchema,
    derivedFrom: nullableTextSchema,
    correspondenceTables: z.array(klassCorrespondenceTableSummarySchema),
    classificationVariants: z.array(klassVariantSummarySchema),
    changelogs: z.array(klassChangelogSchema),
    levels: z.array(klassLevelSchema),
    classificationItems: z.array(klassClassificationItemSchema),
    ...resourceEnvelopeShape,
  })
  .strict();

const klassCodeSchema = z
  .object({
    code: rawCodeValueSchema,
    parentCode: z.string().nullable().optional(),
    level: z.string(),
    name: z.string(),
    shortName: nullableTextSchema,
    presentationName: nullableTextSchema,
    validFrom: klassDateSchema.nullable().optional(),
    validTo: klassDateSchema.nullable().optional(),
    // These documented live range fields are absent from the current OpenAPI schema.
    validFromInRequestedRange: klassDateSchema.nullable().optional(),
    validToInRequestedRange: klassDateSchema.nullable().optional(),
    notes: nullableTextSchema,
  })
  .strict();

/** Raw code payload returned by `codes` and `codesAt`. */
export const klassCodesSchema = z
  .object({
    codes: z.array(klassCodeSchema),
  })
  .strict();

const klassCodeChangeSchema = z
  .object({
    oldCode: rawCodeValueSchema.nullable().optional(),
    oldName: nullableTextSchema,
    oldShortName: nullableTextSchema,
    newCode: rawCodeValueSchema.nullable().optional(),
    newName: nullableTextSchema,
    newShortName: nullableTextSchema,
    changeOccurred: klassDateSchema,
  })
  .strict()
  .superRefine((change, context) => {
    if (change.oldCode == null && change.newCode == null) {
      context.addIssue({
        code: "custom",
        message: "A Klass code change must contain an old code, a new code, or both.",
      });
    }
  });

/** Raw code-change payload returned by `GET /classifications/{id}/changes`. */
export const klassCodeChangesSchema = z
  .object({
    codeChanges: z.array(klassCodeChangeSchema),
  })
  .strict();

const klassSnapshotCorrespondenceItemSchema = z
  .object({
    sourceCode: rawCodeValueSchema,
    sourceName: z.string(),
    sourceShortName: nullableTextSchema,
    targetCode: rawCodeValueSchema,
    targetName: z.string(),
    targetShortName: nullableTextSchema,
  })
  .strict();

const klassRangeCorrespondenceItemSchema = klassSnapshotCorrespondenceItemSchema
  .extend({
    // Live range JSON contains these fields although the current OpenAPI schema omits them.
    validFrom: klassDateSchema.nullable(),
    validTo: klassDateSchema.nullable(),
  })
  .strict();

/** Raw correspondence snapshot returned by `correspondsAt`. */
export const klassSnapshotCorrespondenceSchema = z
  .object({
    correspondenceItems: z.array(klassSnapshotCorrespondenceItemSchema),
  })
  .strict();

/** Raw dated-range correspondence returned by `corresponds`. */
export const klassRangeCorrespondenceSchema = z
  .object({
    correspondenceItems: z.array(klassRangeCorrespondenceItemSchema),
  })
  .strict();

/** Either official classification-correspondence payload. */
export const klassCorrespondenceSchema = z.union([
  klassRangeCorrespondenceSchema,
  klassSnapshotCorrespondenceSchema,
]);

const klassFixedCorrespondenceMapSchema = z
  .object({
    sourceCode: rawCodeValueSchema,
    sourceName: z.string(),
    targetCode: rawCodeValueSchema,
    targetName: z.string(),
  })
  .strict();

/** Full raw fixed correspondence table, including its unpaged map. */
export const klassCorrespondenceTableSchema = z
  .object({
    name: z.string(),
    id: klassIdentifierSchema,
    contactPerson: klassContactPersonSchema.nullable().optional(),
    owningSection: nullableTextSchema,
    source: z.string(),
    sourceId: klassIdentifierSchema,
    target: z.string(),
    targetId: klassIdentifierSchema,
    changeTable: z.boolean(),
    lastModified: klassDateTimeSchema,
    published: z.array(klassLanguageSchema),
    sourceLevel: klassLevelSchema.nullable().optional(),
    targetLevel: klassLevelSchema.nullable().optional(),
    description: nullableTextSchema,
    changelogs: z.array(klassChangelogSchema),
    correspondenceMaps: z.array(klassFixedCorrespondenceMapSchema),
    ...resourceEnvelopeShape,
  })
  .strict();

const classificationIdInputShape = {
  classificationId: klassIdentifierSchema,
};

const languageInputShape = {
  language: klassLanguageSchema.optional(),
};

const paginationInputShape = {
  page: pageInputSchema,
  pageSize: pageSizeInputSchema,
};

const includeFutureInputShape = {
  includeFuture: z.boolean().optional(),
};

const codeFiltersInputShape = {
  codes: z
    .array(exactCodeInputSchema)
    .min(1)
    .max(100)
    .refine((codes) => new Set(codes).size === codes.length, "Code filters must be unique.")
    .optional(),
  level: levelInputSchema,
};

export const klassListClassificationsInputSchema = z
  .object({
    ...languageInputShape,
    includeCodelists: z.boolean().optional(),
    includeDescription: z.boolean().optional(),
    changedSince: klassDateTimeSchema.optional(),
    ...paginationInputShape,
  })
  .strict();

export const klassSearchClassificationsInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    includeCodelists: z.boolean().optional(),
    ssbSection: z.string().trim().min(1).max(64).optional(),
    ...paginationInputShape,
  })
  .strict();

export const klassGetClassificationInputSchema = z
  .object({
    ...classificationIdInputShape,
    ...languageInputShape,
    ...includeFutureInputShape,
  })
  .strict();

export const klassListVersionsInputSchema = z
  .object({
    ...classificationIdInputShape,
    ...languageInputShape,
    ...includeFutureInputShape,
    ...paginationInputShape,
  })
  .strict();

export const klassGetVersionInputSchema = z
  .object({
    versionId: klassIdentifierSchema,
    ...languageInputShape,
    ...includeFutureInputShape,
  })
  .strict();

const klassListCodesAtDateInputSchema = z
  .object({
    ...classificationIdInputShape,
    date: klassDateSchema,
    ...languageInputShape,
    ...includeFutureInputShape,
    ...codeFiltersInputShape,
    ...paginationInputShape,
  })
  .strict();

const klassListCodesInRangeInputSchema = z
  .object({
    ...classificationIdInputShape,
    from: klassDateSchema,
    to: klassDateSchema.optional(),
    ...languageInputShape,
    ...includeFutureInputShape,
    ...codeFiltersInputShape,
    ...paginationInputShape,
  })
  .strict()
  .superRefine((range, context) => {
    if (range.to !== undefined && range.to <= range.from) {
      context.addIssue({ code: "custom", message: "to must be after from." });
    }
  });

const klassListCodesForVersionInputSchema = z
  .object({
    versionId: klassIdentifierSchema,
    ...languageInputShape,
    ...includeFutureInputShape,
    level: levelInputSchema,
    ...paginationInputShape,
  })
  .strict();

export const klassListCodesInputSchema = z.union([
  klassListCodesAtDateInputSchema,
  klassListCodesInRangeInputSchema,
  klassListCodesForVersionInputSchema,
]);

const klassGetCodeAtDateInputSchema = z
  .object({
    ...classificationIdInputShape,
    code: exactCodeInputSchema,
    date: klassDateSchema,
    ...languageInputShape,
    ...includeFutureInputShape,
  })
  .strict();

const klassGetCodeForVersionInputSchema = z
  .object({
    versionId: klassIdentifierSchema,
    code: exactCodeInputSchema,
    ...languageInputShape,
    ...includeFutureInputShape,
  })
  .strict();

export const klassGetCodeInputSchema = z.union([
  klassGetCodeAtDateInputSchema,
  klassGetCodeForVersionInputSchema,
]);

export const klassSearchCodesInputSchema = z
  .object({
    ...classificationIdInputShape,
    codePattern: codePatternSchema,
    date: klassDateSchema,
    level: levelInputSchema,
    ...languageInputShape,
    ...includeFutureInputShape,
    ...paginationInputShape,
  })
  .strict();

export const klassListCorrespondenceTablesInputSchema = z
  .object({
    versionId: klassIdentifierSchema,
    ...languageInputShape,
    ...includeFutureInputShape,
    ...paginationInputShape,
  })
  .strict();

export const klassGetCorrespondenceTableInputSchema = z
  .object({
    correspondenceTableId: klassIdentifierSchema,
    ...languageInputShape,
    ...paginationInputShape,
  })
  .strict();

const klassGetFixedCorrespondenceInputSchema = z
  .object({
    mode: z.literal("fixed"),
    correspondenceTableId: klassIdentifierSchema,
    ...languageInputShape,
    ...paginationInputShape,
  })
  .strict();

const klassGetDatedCorrespondenceInputSchema = z
  .object({
    mode: z.literal("date"),
    sourceClassificationId: klassIdentifierSchema,
    targetClassificationId: klassIdentifierSchema,
    date: klassDateSchema,
    ...languageInputShape,
    ...includeFutureInputShape,
    inverted: z.boolean().optional(),
    ...paginationInputShape,
  })
  .strict();

const klassGetRangeCorrespondenceInputSchema = z
  .object({
    mode: z.literal("range"),
    sourceClassificationId: klassIdentifierSchema,
    targetClassificationId: klassIdentifierSchema,
    from: klassDateSchema,
    to: klassDateSchema.optional(),
    ...languageInputShape,
    ...includeFutureInputShape,
    ...paginationInputShape,
  })
  .strict();

export const klassGetCorrespondenceInputSchema = z
  .discriminatedUnion("mode", [
    klassGetFixedCorrespondenceInputSchema,
    klassGetDatedCorrespondenceInputSchema,
    klassGetRangeCorrespondenceInputSchema,
  ])
  .superRefine((parameters, context) => {
    if (
      parameters.mode !== "fixed" &&
      parameters.sourceClassificationId === parameters.targetClassificationId
    ) {
      context.addIssue({
        code: "custom",
        message: "sourceClassificationId and targetClassificationId must differ.",
      });
    }
    if (
      parameters.mode === "range" &&
      parameters.to !== undefined &&
      parameters.to <= parameters.from
    ) {
      context.addIssue({ code: "custom", message: "to must be after from." });
    }
  });

export const klassListCodeChangesInputSchema = z
  .object({
    ...classificationIdInputShape,
    from: klassDateSchema,
    to: klassDateSchema.optional(),
    ...languageInputShape,
    ...includeFutureInputShape,
    ...paginationInputShape,
  })
  .strict()
  .superRefine((range, context) => {
    if (range.to !== undefined && range.to <= range.from) {
      context.addIssue({ code: "custom", message: "to must be after from." });
    }
  });

const resolveAdministrativeInputShape = {
  sourceDate: klassDateSchema.optional(),
  targetDate: klassDateSchema,
  ...languageInputShape,
  ...includeFutureInputShape,
};

export const klassResolveAdministrativeCodeInputSchema = z
  .object({
    code: z.string().regex(/^(?:\d{2}|\d{4})$/),
    ...resolveAdministrativeInputShape,
  })
  .strict();

export const klassResolveMunicipalityCodeInputSchema = z
  .object({
    code: z.string().regex(/^\d{4}$/),
    ...resolveAdministrativeInputShape,
  })
  .strict();

export const klassResolveCountyCodeInputSchema = z
  .object({
    code: z.string().regex(/^\d{2}$/),
    ...resolveAdministrativeInputShape,
  })
  .strict();

export type RawKlassClassificationPage = z.infer<typeof klassClassificationPageSchema>;
export type RawKlassClassificationSearchPage = z.infer<typeof klassClassificationSearchPageSchema>;
export type RawKlassClassification = z.infer<typeof klassClassificationSchema>;
export type RawKlassVersion = z.infer<typeof klassVersionSchema>;
export type RawKlassCode = z.infer<typeof klassCodeSchema>;
export type RawKlassCodes = z.infer<typeof klassCodesSchema>;
export type RawKlassCodeChange = z.infer<typeof klassCodeChangeSchema>;
export type RawKlassCodeChanges = z.infer<typeof klassCodeChangesSchema>;
export type RawKlassSnapshotCorrespondence = z.infer<typeof klassSnapshotCorrespondenceSchema>;
export type RawKlassRangeCorrespondence = z.infer<typeof klassRangeCorrespondenceSchema>;
export type RawKlassCorrespondence = z.infer<typeof klassCorrespondenceSchema>;
export type RawKlassCorrespondenceTable = z.infer<typeof klassCorrespondenceTableSchema>;
