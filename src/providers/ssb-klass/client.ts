import { z } from "zod";

import { createResponse, HttpClient } from "../../core/client.js";
import { InputValidationError, NotFoundError, ResponseValidationError } from "../../core/errors.js";
import { responseSource } from "../../core/provider.js";
import type { HttpResult, OpenDataResponse, RequestOptions } from "../../core/types.js";
import { ssbKlassProvider } from "./provider.js";
import {
  klassClassificationPageSchema,
  klassClassificationSchema,
  klassClassificationSearchPageSchema,
  klassCodeChangesSchema,
  klassCodesSchema,
  klassCorrespondenceSchema,
  klassCorrespondenceTableSchema,
  klassGetClassificationInputSchema as getClassificationInputSchema,
  klassGetCodeInputSchema as getCodeInputSchema,
  klassGetCorrespondenceInputSchema as getCorrespondenceInputSchema,
  klassGetCorrespondenceTableInputSchema as getCorrespondenceTableInputSchema,
  klassGetVersionInputSchema as getVersionInputSchema,
  klassListClassificationsInputSchema as listClassificationsInputSchema,
  klassListCodeChangesInputSchema as listCodeChangesInputSchema,
  klassListCodesInputSchema as listCodesInputSchema,
  klassListCorrespondenceTablesInputSchema as listCorrespondenceTablesInputSchema,
  klassListVersionsInputSchema as listVersionsInputSchema,
  klassResolveCountyCodeInputSchema as countyResolutionInputSchema,
  klassResolveMunicipalityCodeInputSchema as municipalityResolutionInputSchema,
  klassSearchClassificationsInputSchema as searchClassificationsInputSchema,
  klassSearchCodesInputSchema as searchCodesInputSchema,
  klassVersionSchema,
} from "./schemas.js";
import {
  klassClassificationIds,
  type KlassChangelogEntry,
  type KlassClassification,
  type KlassClassificationSearchHit,
  type KlassClassificationSummary,
  type KlassCode,
  type KlassCodeChange,
  type KlassCodeResolution,
  type KlassCodeResolutionMatch,
  type KlassCorrespondenceItem,
  type KlassCorrespondenceTable,
  type KlassCorrespondenceTableMetadata,
  type KlassCorrespondenceTableSummary,
  type KlassGetClassificationParameters,
  type KlassGetCodeParameters,
  type KlassGetCorrespondenceParameters,
  type KlassGetCorrespondenceResult,
  type KlassGetCorrespondenceTableParameters,
  type KlassGetVersionParameters,
  type KlassLanguage,
  type KlassLevel,
  type KlassListClassificationsParameters,
  type KlassListClassificationsResult,
  type KlassListCodeChangesParameters,
  type KlassListCodeChangesResult,
  type KlassListCodesParameters,
  type KlassListCodesResult,
  type KlassListCorrespondenceTablesParameters,
  type KlassListCorrespondenceTablesResult,
  type KlassListVersionsParameters,
  type KlassListVersionsResult,
  type KlassPagination,
  type KlassResolveAdministrativeCodeParameters,
  type KlassSearchClassificationsParameters,
  type KlassSearchClassificationsResult,
  type KlassSearchCodesParameters,
  type KlassSearchCodesResult,
  type KlassVariantSummary,
  type KlassVersion,
  type KlassVersionStatus,
  type KlassVersionSummary,
} from "./types.js";

const BASE_URL = "https://data.ssb.no/api/klass/v1";
const DEFAULT_PAGE_SIZE = 20;
const ADMINISTRATIVE_COMPARABILITY_WARNING =
  "Administrative code correspondence does not establish that statistics are comparable across dates or boundaries.";
const MISSING_CORRESPONDENCE_WARNING =
  "No official match was found. Missing Klass correspondence is not proof that areas are equivalent or unrelated.";

type RawClassificationPage = z.infer<typeof klassClassificationPageSchema>;
type RawClassification = z.infer<typeof klassClassificationSchema>;
type RawVersion = z.infer<typeof klassVersionSchema>;
type RawCode = z.infer<typeof klassCodesSchema>["codes"][number];
type RawCodeChange = z.infer<typeof klassCodeChangesSchema>["codeChanges"][number];
type RawCorrespondenceItem = z.infer<
  typeof klassCorrespondenceSchema
>["correspondenceItems"][number];
type RawCorrespondenceTable = z.infer<typeof klassCorrespondenceTableSchema>;

function parseInput<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new InputValidationError(message, {
      provider: ssbKlassProvider.id,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function optionalText(value: string | null | undefined): string | undefined {
  return value == null || value.length === 0 ? undefined : value;
}

function contactPerson(
  raw:
    | {
        name?: string | null;
        email?: string | null;
        phone?: string | null;
      }
    | null
    | undefined,
): KlassClassification["contactPerson"] {
  if (raw == null) return undefined;
  const contact = {
    ...(optionalText(raw.name) === undefined ? {} : { name: optionalText(raw.name) }),
    ...(optionalText(raw.email) === undefined ? {} : { email: optionalText(raw.email) }),
    ...(optionalText(raw.phone) === undefined ? {} : { phone: optionalText(raw.phone) }),
  };
  return Object.keys(contact).length === 0 ? undefined : contact;
}

function classificationType(value: string): KlassClassificationSummary["type"] {
  if (/codelist|code list|kodeliste/iu.test(value)) return "codelist";
  if (/classification|klassifikasjon/iu.test(value)) return "classification";
  return "unknown";
}

function currentOsloDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function versionStatus(
  validFrom: string,
  validTo: string | null | undefined,
  referenceDate = currentOsloDate(),
): KlassVersionStatus {
  if (referenceDate < validFrom) return "future";
  if (validTo != null && referenceDate >= validTo) return "historical";
  return "current";
}

function normalizeVersionSummary(raw: RawClassification["versions"][number]): KlassVersionSummary {
  const validTo = optionalText(raw.validTo);
  return {
    id: raw.id,
    name: raw.name,
    validFrom: raw.validFrom,
    ...(validTo === undefined ? {} : { validTo }),
    lastModified: raw.lastModified,
    publishedLanguages: raw.published,
    status: versionStatus(raw.validFrom, validTo),
  };
}

function normalizeClassificationSummary(
  raw: NonNullable<RawClassificationPage["_embedded"]>["classifications"][number],
): KlassClassificationSummary {
  return {
    id: raw.id,
    name: raw.name,
    type: classificationType(raw.classificationType),
    ...(raw.classificationFamilyId == null ? {} : { familyId: raw.classificationFamilyId }),
    lastModified: raw.lastModified,
    ...(optionalText(raw.description) === undefined
      ? {}
      : { description: optionalText(raw.description) }),
  };
}

function normalizeClassification(raw: RawClassification): KlassClassification {
  const normalizedContact = contactPerson(raw.contactPerson);
  return {
    id: raw.id,
    name: raw.name,
    type: classificationType(raw.classificationType),
    ...(raw.classificationFamilyId == null ? {} : { familyId: raw.classificationFamilyId }),
    lastModified: raw.lastModified,
    ...(optionalText(raw.description) === undefined
      ? {}
      : { description: optionalText(raw.description) }),
    ...(raw.primaryLanguage == null ? {} : { primaryLanguage: raw.primaryLanguage }),
    ...(raw.copyrighted == null ? {} : { copyrighted: raw.copyrighted }),
    ...(raw.includeShortName == null ? {} : { includesShortName: raw.includeShortName }),
    ...(raw.includeNotes == null ? {} : { includesNotes: raw.includeNotes }),
    ...(normalizedContact === undefined ? {} : { contactPerson: normalizedContact }),
    ...(optionalText(raw.owningSection) === undefined
      ? {}
      : { owningSection: optionalText(raw.owningSection) }),
    statisticalUnits: raw.statisticalUnits ?? [],
    versions: raw.versions.map(normalizeVersionSummary),
  };
}

function normalizeLevel(raw: { levelNumber: number; levelName: string }): KlassLevel {
  return { number: raw.levelNumber, name: raw.levelName };
}

function normalizeChangelog(raw: {
  changeOccured?: string | null;
  description?: string | null;
}): KlassChangelogEntry {
  return {
    ...(optionalText(raw.changeOccured) === undefined
      ? {}
      : { changedAt: optionalText(raw.changeOccured) }),
    ...(optionalText(raw.description) === undefined
      ? {}
      : { description: optionalText(raw.description) }),
  };
}

function normalizeCorrespondenceTableSummary(
  raw: RawVersion["correspondenceTables"][number] | RawCorrespondenceTable,
): KlassCorrespondenceTableSummary {
  const sourceLevel = raw.sourceLevel == null ? undefined : normalizeLevel(raw.sourceLevel);
  const targetLevel = raw.targetLevel == null ? undefined : normalizeLevel(raw.targetLevel);
  return {
    id: raw.id,
    name: raw.name,
    sourceVersionId: raw.sourceId,
    sourceVersionName: raw.source,
    targetVersionId: raw.targetId,
    targetVersionName: raw.target,
    changeTable: raw.changeTable,
    lastModified: raw.lastModified,
    publishedLanguages: raw.published,
    ...(sourceLevel === undefined ? {} : { sourceLevel }),
    ...(targetLevel === undefined ? {} : { targetLevel }),
  };
}

function normalizeCorrespondenceTableMetadata(
  raw: RawCorrespondenceTable,
): KlassCorrespondenceTableMetadata {
  const normalizedContact = contactPerson(raw.contactPerson);
  return {
    ...normalizeCorrespondenceTableSummary(raw),
    ...(normalizedContact === undefined ? {} : { contactPerson: normalizedContact }),
    ...(optionalText(raw.owningSection) === undefined
      ? {}
      : { owningSection: optionalText(raw.owningSection) }),
    ...(optionalText(raw.description) === undefined
      ? {}
      : { description: optionalText(raw.description) }),
    changelog: raw.changelogs.map(normalizeChangelog),
  };
}

function normalizeVariant(raw: RawVersion["classificationVariants"][number]): KlassVariantSummary {
  const normalizedContact = contactPerson(raw.contactPerson);
  return {
    id: raw.id,
    name: raw.name,
    lastModified: raw.lastModified,
    publishedLanguages: raw.published,
    ...(normalizedContact === undefined ? {} : { contactPerson: normalizedContact }),
    ...(optionalText(raw.owningSection) === undefined
      ? {}
      : { owningSection: optionalText(raw.owningSection) }),
  };
}

function normalizeVersion(raw: RawVersion): KlassVersion {
  const validTo = optionalText(raw.validTo);
  const normalizedContact = contactPerson(raw.contactPerson);
  return {
    id: raw.id,
    name: raw.name,
    validFrom: raw.validFrom,
    ...(validTo === undefined ? {} : { validTo }),
    lastModified: raw.lastModified,
    publishedLanguages: raw.published,
    status: versionStatus(raw.validFrom, validTo),
    ...(optionalText(raw.introduction) === undefined
      ? {}
      : { introduction: optionalText(raw.introduction) }),
    ...(normalizedContact === undefined ? {} : { contactPerson: normalizedContact }),
    ...(optionalText(raw.owningSection) === undefined
      ? {}
      : { owningSection: optionalText(raw.owningSection) }),
    ...(optionalText(raw.legalBase) === undefined
      ? {}
      : { legalBase: optionalText(raw.legalBase) }),
    ...(optionalText(raw.publications) === undefined
      ? {}
      : { publications: optionalText(raw.publications) }),
    ...(optionalText(raw.derivedFrom) === undefined
      ? {}
      : { derivedFrom: optionalText(raw.derivedFrom) }),
    levels: raw.levels.map(normalizeLevel),
    correspondenceTables: raw.correspondenceTables.map(normalizeCorrespondenceTableSummary),
    variants: raw.classificationVariants.map(normalizeVariant),
    changelog: raw.changelogs.map(normalizeChangelog),
    codeCount: raw.classificationItems.length,
  };
}

function normalizeCode(raw: RawCode | RawVersion["classificationItems"][number]): KlassCode {
  return {
    code: raw.code,
    ...(optionalText(raw.parentCode) === undefined
      ? {}
      : { parentCode: optionalText(raw.parentCode) }),
    level: raw.level,
    name: raw.name,
    ...(optionalText(raw.shortName) === undefined
      ? {}
      : { shortName: optionalText(raw.shortName) }),
    ...("presentationName" in raw && optionalText(raw.presentationName) !== undefined
      ? { presentationName: optionalText(raw.presentationName) }
      : {}),
    ...("validFrom" in raw && optionalText(raw.validFrom) !== undefined
      ? { validFrom: optionalText(raw.validFrom) }
      : {}),
    ...("validTo" in raw && optionalText(raw.validTo) !== undefined
      ? { validTo: optionalText(raw.validTo) }
      : {}),
    ...("validFromInRequestedRange" in raw &&
    optionalText(raw.validFromInRequestedRange) !== undefined
      ? { validFromInRequestedRange: optionalText(raw.validFromInRequestedRange) }
      : {}),
    ...("validToInRequestedRange" in raw && optionalText(raw.validToInRequestedRange) !== undefined
      ? { validToInRequestedRange: optionalText(raw.validToInRequestedRange) }
      : {}),
    ...(optionalText(raw.notes) === undefined ? {} : { notes: optionalText(raw.notes) }),
  };
}

function normalizeCodeChange(raw: RawCodeChange): KlassCodeChange {
  return {
    ...(optionalText(raw.oldCode) === undefined ? {} : { oldCode: optionalText(raw.oldCode) }),
    ...(optionalText(raw.oldName) === undefined ? {} : { oldName: optionalText(raw.oldName) }),
    ...(optionalText(raw.oldShortName) === undefined
      ? {}
      : { oldShortName: optionalText(raw.oldShortName) }),
    ...(optionalText(raw.newCode) === undefined ? {} : { newCode: optionalText(raw.newCode) }),
    ...(optionalText(raw.newName) === undefined ? {} : { newName: optionalText(raw.newName) }),
    ...(optionalText(raw.newShortName) === undefined
      ? {}
      : { newShortName: optionalText(raw.newShortName) }),
    occurredAt: raw.changeOccurred,
  };
}

function normalizeCorrespondenceItem(
  raw: RawCorrespondenceItem | RawCorrespondenceTable["correspondenceMaps"][number],
): KlassCorrespondenceItem {
  return {
    sourceCode: raw.sourceCode,
    sourceName: raw.sourceName,
    ...("sourceShortName" in raw && optionalText(raw.sourceShortName) !== undefined
      ? { sourceShortName: optionalText(raw.sourceShortName) }
      : {}),
    targetCode: raw.targetCode,
    targetName: raw.targetName,
    ...("targetShortName" in raw && optionalText(raw.targetShortName) !== undefined
      ? { targetShortName: optionalText(raw.targetShortName) }
      : {}),
    ...("validFrom" in raw && optionalText(raw.validFrom) !== undefined
      ? { validFrom: optionalText(raw.validFrom) }
      : {}),
    ...("validTo" in raw && optionalText(raw.validTo) !== undefined
      ? { validTo: optionalText(raw.validTo) }
      : {}),
  };
}

function localPage<T>(
  items: readonly T[],
  page = 0,
  pageSize = DEFAULT_PAGE_SIZE,
): { items: T[]; pagination: KlassPagination } {
  const start = page * pageSize;
  const totalItems = items.length;
  return {
    items: items.slice(start, start + pageSize),
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
      upstreamPaged: false,
    },
  };
}

function upstreamPage(raw: RawClassificationPage["page"]): KlassPagination {
  return {
    page: raw.number,
    pageSize: raw.size,
    totalItems: raw.totalElements,
    totalPages: raw.totalPages,
    upstreamPaged: true,
  };
}

function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function responseOptions(options: RequestOptions | undefined): RequestOptions {
  return {
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
    ...(options?.bypassCache === undefined ? {} : { bypassCache: options.bypassCache }),
    includeRaw: options?.includeRaw === true,
  };
}

function resolutionMatch(code: KlassCode): KlassCodeResolutionMatch {
  return {
    code: code.code,
    name: code.name,
    ...(code.validFrom === undefined ? {} : { validFrom: code.validFrom }),
    ...(code.validTo === undefined ? {} : { validTo: code.validTo }),
  };
}

function uniqueMatches(matches: readonly KlassCodeResolutionMatch[]): KlassCodeResolutionMatch[] {
  const byCode = new Map<string, KlassCodeResolutionMatch>();
  for (const match of matches) {
    const current = byCode.get(match.code);
    if (current === undefined || current.name.length === 0) byCode.set(match.code, match);
  }
  return [...byCode.values()].sort((left, right) => left.code.localeCompare(right.code));
}

type ResolutionTraversal = {
  candidates: KlassCodeResolutionMatch[];
  predecessors: KlassCodeResolutionMatch[];
  successors: KlassCodeResolutionMatch[];
  sawMerge: boolean;
  sawSplit: boolean;
  traversedEdges: KlassCodeChange[];
};

function edgeMatch(
  code: string | undefined,
  name: string | undefined,
): KlassCodeResolutionMatch | undefined {
  return code === undefined ? undefined : { code, name: name ?? "" };
}

function connectedEdges(
  eventEdges: readonly KlassCodeChange[],
  seeds: ReadonlySet<string>,
): KlassCodeChange[] {
  const connectedCodes = new Set(seeds);
  const selected = new Set<KlassCodeChange>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of eventEdges) {
      if (selected.has(edge)) continue;
      if (
        (edge.oldCode !== undefined && connectedCodes.has(edge.oldCode)) ||
        (edge.newCode !== undefined && connectedCodes.has(edge.newCode))
      ) {
        selected.add(edge);
        if (edge.oldCode !== undefined && !connectedCodes.has(edge.oldCode)) {
          connectedCodes.add(edge.oldCode);
          changed = true;
        }
        if (edge.newCode !== undefined && !connectedCodes.has(edge.newCode)) {
          connectedCodes.add(edge.newCode);
          changed = true;
        }
      }
    }
  }
  return [...selected];
}

function relationshipFlags(edges: readonly KlassCodeChange[]): {
  sawMerge: boolean;
  sawSplit: boolean;
} {
  const successorsByPredecessor = new Map<string, Set<string>>();
  const predecessorsBySuccessor = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.oldCode !== undefined && edge.newCode !== undefined) {
      const successors = successorsByPredecessor.get(edge.oldCode) ?? new Set<string>();
      successors.add(edge.newCode);
      successorsByPredecessor.set(edge.oldCode, successors);
      const predecessors = predecessorsBySuccessor.get(edge.newCode) ?? new Set<string>();
      predecessors.add(edge.oldCode);
      predecessorsBySuccessor.set(edge.newCode, predecessors);
    }
  }
  return {
    sawMerge: [...predecessorsBySuccessor.values()].some((codes) => codes.size > 1),
    sawSplit: [...successorsByPredecessor.values()].some((codes) => codes.size > 1),
  };
}

function traverseChanges(
  source: KlassCodeResolutionMatch,
  changes: readonly KlassCodeChange[],
  direction: "forward" | "backward",
): ResolutionTraversal {
  const grouped = new Map<string, KlassCodeChange[]>();
  for (const change of changes) {
    const existing = grouped.get(change.occurredAt) ?? [];
    existing.push(change);
    grouped.set(change.occurredAt, existing);
  }
  const dates = [...grouped.keys()].sort((left, right) =>
    direction === "forward" ? left.localeCompare(right) : right.localeCompare(left),
  );
  let current = [source];
  const predecessors: KlassCodeResolutionMatch[] = [];
  const successors: KlassCodeResolutionMatch[] = [];
  const traversedEdges: KlassCodeChange[] = [];
  let sawMerge = false;
  let sawSplit = false;

  for (const date of dates) {
    const eventEdges = grouped.get(date) ?? [];
    const currentCodes = new Set(current.map(({ code }) => code));
    const pathEdges = eventEdges.filter((edge) =>
      direction === "forward"
        ? edge.oldCode !== undefined && currentCodes.has(edge.oldCode)
        : edge.newCode !== undefined && currentCodes.has(edge.newCode),
    );
    if (pathEdges.length === 0) continue;

    const component = connectedEdges(eventEdges, currentCodes);
    const flags = relationshipFlags(component);
    sawMerge ||= flags.sawMerge;
    sawSplit ||= flags.sawSplit;
    traversedEdges.push(...component);
    predecessors.push(
      ...component.flatMap((edge) => {
        const match = edgeMatch(edge.oldCode, edge.oldName);
        return match === undefined ? [] : [match];
      }),
    );
    successors.push(
      ...component.flatMap((edge) => {
        const match = edgeMatch(edge.newCode, edge.newName);
        return match === undefined ? [] : [match];
      }),
    );

    const transitionedCodes = new Set(
      pathEdges.flatMap((edge) => {
        const code = direction === "forward" ? edge.oldCode : edge.newCode;
        return code === undefined ? [] : [code];
      }),
    );
    const retained = current.filter(({ code }) => !transitionedCodes.has(code));
    const transitioned = pathEdges.flatMap((edge) => {
      const match =
        direction === "forward"
          ? edgeMatch(edge.newCode, edge.newName)
          : edgeMatch(edge.oldCode, edge.oldName);
      return match === undefined ? [] : [match];
    });
    current = uniqueMatches([...retained, ...transitioned]);
  }

  return {
    candidates: uniqueMatches(current),
    predecessors: uniqueMatches(predecessors),
    successors: uniqueMatches(successors),
    sawMerge,
    sawSplit,
    traversedEdges,
  };
}

function resolutionStatus(
  source: KlassCodeResolutionMatch,
  matches: readonly KlassCodeResolutionMatch[],
  traversal: ResolutionTraversal,
): KlassCodeResolution["status"] {
  if (matches.length === 0) return "not_found";
  if (traversal.sawMerge && traversal.sawSplit) return "ambiguous";
  if (traversal.sawSplit) return "split";
  if (traversal.sawMerge) return "merged";
  if (matches.length > 1) return "ambiguous";
  const match = matches[0];
  if (match === undefined) return "not_found";
  if (match.code !== source.code) return "replaced";
  if (
    source.name.length > 0 &&
    match.name.length > 0 &&
    source.name.localeCompare(match.name, undefined, { sensitivity: "base" }) !== 0
  ) {
    return "renamed";
  }
  return "unchanged";
}

/**
 * Curated client for official classifications, versions, codes and mappings
 * published by Statistics Norway's Klass service.
 */
export class KlassClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Lists official classifications with real zero-based Klass pagination. */
  async listClassifications(
    parameters: KlassListClassificationsParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<KlassListClassificationsResult>> {
    const parsed = parseInput(
      listClassificationsInputSchema,
      parameters,
      "Invalid Klass classification-list parameters.",
    );
    const result = await this.#http.request({
      provider: ssbKlassProvider,
      url: `${BASE_URL}/classifications`,
      query: {
        language: parsed.language,
        includeCodelists: parsed.includeCodelists,
        includeDescription: parsed.includeDescription,
        changedSince: parsed.changedSince,
        page: parsed.page ?? 0,
        size: parsed.pageSize ?? DEFAULT_PAGE_SIZE,
      },
      schema: klassClassificationPageSchema,
      options,
      cacheTtlMs: ssbKlassProvider.cacheTtlMs.classifications,
    });
    return createResponse(
      {
        items: (result.data._embedded?.classifications ?? []).map(normalizeClassificationSummary),
        pagination: upstreamPage(result.data.page),
      },
      responseSource(ssbKlassProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Searches classification metadata.
   *
   * Search hits are language-specific and Klass may return the same
   * classification more than once when several published languages match.
   */
  async searchClassifications(
    parameters: KlassSearchClassificationsParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<KlassSearchClassificationsResult>> {
    const parsed = parseInput(
      searchClassificationsInputSchema,
      parameters,
      "Invalid Klass classification-search parameters.",
    );
    const result = await this.#http.request({
      provider: ssbKlassProvider,
      url: `${BASE_URL}/classifications/search`,
      query: {
        query: parsed.query,
        includeCodelists: parsed.includeCodelists,
        ssbSection: parsed.ssbSection,
        page: parsed.page ?? 0,
        size: parsed.pageSize ?? DEFAULT_PAGE_SIZE,
      },
      schema: klassClassificationSearchPageSchema,
      options,
      cacheTtlMs: ssbKlassProvider.cacheTtlMs.classifications,
    });
    const items: KlassClassificationSearchHit[] = (result.data._embedded?.searchResults ?? []).map(
      (raw) => ({
        id: raw.id,
        name: raw.name,
        language: raw.language,
        snippet: raw.snippet,
        score: raw.searchScore,
      }),
    );
    return createResponse(
      { items, pagination: upstreamPage(result.data.page) },
      responseSource(ssbKlassProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /** Gets one classification and its dated version summaries. */
  async getClassification(
    parameters: KlassGetClassificationParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<KlassClassification>> {
    const parsed = parseInput(
      getClassificationInputSchema,
      parameters,
      "Invalid Klass classification parameters.",
    );
    const result = await this.#requestClassification(parsed, options);
    return createResponse(
      normalizeClassification(result.data),
      responseSource(ssbKlassProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Lists version summaries embedded in one classification response.
   *
   * Klass does not page versions upstream; `pagination.upstreamPaged` is false.
   */
  async listVersions(
    parameters: KlassListVersionsParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<KlassListVersionsResult>> {
    const parsed = parseInput(
      listVersionsInputSchema,
      parameters,
      "Invalid Klass version-list parameters.",
    );
    const result = await this.#requestClassification(parsed, options);
    const page = localPage(
      result.data.versions.map(normalizeVersionSummary),
      parsed.page,
      parsed.pageSize,
    );
    return createResponse(
      page,
      responseSource(ssbKlassProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Gets one version's metadata.
   *
   * Klass embeds its full code list in this upstream response. The SDK
   * validates that payload but returns only metadata and `codeCount` here.
   */
  async getVersion(
    parameters: KlassGetVersionParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<KlassVersion>> {
    const parsed = parseInput(
      getVersionInputSchema,
      parameters,
      "Invalid Klass version parameters.",
    );
    const result = await this.#requestVersion(parsed, options);
    return createResponse(
      normalizeVersion(result.data),
      responseSource(ssbKlassProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Returns a bounded SDK page of codes for a version, date or date range.
   *
   * Klass does not page code payloads upstream; callers can inspect
   * `pagination.upstreamPaged` to distinguish that from provider paging.
   */
  async listCodes(
    parameters: KlassListCodesParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<KlassListCodesResult>> {
    const parsed = parseInput(
      listCodesInputSchema,
      parameters,
      "Invalid Klass code-list parameters.",
    );
    if ("versionId" in parsed) {
      const result = await this.#requestVersion(parsed, options);
      const items = result.data.classificationItems
        .map(normalizeCode)
        .filter((code) => parsed.level === undefined || code.level === parsed.level);
      return createResponse(
        localPage(items, parsed.page, parsed.pageSize),
        responseSource(ssbKlassProvider),
        result.data,
        result.cached,
        options,
      );
    }

    const result =
      "date" in parsed
        ? await this.#requestCodesAt(
            {
              classificationId: parsed.classificationId,
              date: parsed.date,
              language: parsed.language,
              includeFuture: parsed.includeFuture,
              codes: parsed.codes,
              level: parsed.level,
            },
            options,
          )
        : await this.#requestCodesInRange(
            {
              classificationId: parsed.classificationId,
              from: parsed.from,
              to: parsed.to,
              language: parsed.language,
              includeFuture: parsed.includeFuture,
              codes: parsed.codes,
              level: parsed.level,
            },
            options,
          );
    const requestedCodes = parsed.codes === undefined ? undefined : new Set(parsed.codes);
    const items = result.data.codes
      .map(normalizeCode)
      .filter(
        (code) =>
          (requestedCodes === undefined || requestedCodes.has(code.code)) &&
          (parsed.level === undefined || parsed.level === code.level),
      );
    return createResponse(
      localPage(items, parsed.page, parsed.pageSize),
      responseSource(ssbKlassProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Gets one exact code at a date or inside an explicit version.
   *
   * Dated lookup uses the provider's efficient `selectCodes` filter. Klass has
   * no version-code item endpoint, so version lookup validates that version's
   * complete embedded list before selecting the exact code.
   */
  async getCode(
    parameters: KlassGetCodeParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<KlassCode>> {
    const parsed = parseInput(
      getCodeInputSchema,
      parameters,
      "Invalid Klass exact-code parameters.",
    );
    if ("versionId" in parsed) {
      const result = await this.#requestVersion(parsed, options);
      const exact = result.data.classificationItems.find((item) => item.code === parsed.code);
      if (exact === undefined) {
        throw new NotFoundError(
          `ssb-klass code ${parsed.code} was not found in classification version ${parsed.versionId}.`,
          { provider: ssbKlassProvider.id },
        );
      }
      return createResponse(
        normalizeCode(exact),
        responseSource(ssbKlassProvider),
        result.data,
        result.cached,
        options,
      );
    }

    const result = await this.#requestCodesAt(
      {
        classificationId: parsed.classificationId,
        codePattern: parsed.code,
        date: parsed.date,
        language: parsed.language,
        includeFuture: parsed.includeFuture,
      },
      options,
    );
    const exact = result.data.codes.find((item) => item.code === parsed.code);
    if (exact === undefined) {
      throw new NotFoundError(
        `ssb-klass code ${parsed.code} was not found in classification ${parsed.classificationId} on ${parsed.date}.`,
        { provider: ssbKlassProvider.id },
      );
    }
    return createResponse(
      normalizeCode(exact),
      responseSource(ssbKlassProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Searches codes with Klass' official `selectCodes` syntax.
   *
   * This is code-pattern matching (exact, wildcard or range), not name search;
   * the official API does not provide a code-name search endpoint.
   */
  async searchCodes(
    parameters: KlassSearchCodesParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<KlassSearchCodesResult>> {
    const parsed = parseInput(
      searchCodesInputSchema,
      parameters,
      "Invalid Klass code-search parameters.",
    );
    const result = await this.#requestCodesAt(parsed, options);
    const items = result.data.codes
      .map(normalizeCode)
      .filter((code) => parsed.level === undefined || code.level === parsed.level);
    return createResponse(
      localPage(items, parsed.page, parsed.pageSize),
      responseSource(ssbKlassProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Lists correspondence-table summaries attached to a version.
   *
   * Klass embeds this list in the unpaged version response; the SDK page is
   * bounded locally and marked `upstreamPaged: false`.
   */
  async listCorrespondenceTables(
    parameters: KlassListCorrespondenceTablesParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<KlassListCorrespondenceTablesResult>> {
    const parsed = parseInput(
      listCorrespondenceTablesInputSchema,
      parameters,
      "Invalid Klass correspondence-table-list parameters.",
    );
    const result = await this.#requestVersion(parsed, options);
    const page = localPage(
      result.data.correspondenceTables.map(normalizeCorrespondenceTableSummary),
      parsed.page,
      parsed.pageSize,
    );
    return createResponse(
      page,
      responseSource(ssbKlassProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Gets a fixed correspondence table and a bounded page of its official map.
   *
   * Klass sends the complete map upstream because it offers no item endpoint or
   * paging. The returned page is therefore explicitly SDK-local.
   */
  async getCorrespondenceTable(
    parameters: KlassGetCorrespondenceTableParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<KlassCorrespondenceTable>> {
    const parsed = parseInput(
      getCorrespondenceTableInputSchema,
      parameters,
      "Invalid Klass correspondence-table parameters.",
    );
    const result = await this.#requestCorrespondenceTable(parsed, options);
    const page = localPage(
      result.data.correspondenceMaps.map(normalizeCorrespondenceItem),
      parsed.page,
      parsed.pageSize,
    );
    return createResponse(
      { ...normalizeCorrespondenceTableMetadata(result.data), ...page },
      responseSource(ssbKlassProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /** Gets a bounded fixed, dated or ranged official correspondence. */
  async getCorrespondence(
    parameters: KlassGetCorrespondenceParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<KlassGetCorrespondenceResult>> {
    const parsed = parseInput(
      getCorrespondenceInputSchema,
      parameters,
      "Invalid Klass correspondence parameters.",
    );
    if (parsed.mode === "fixed") {
      const result = await this.#requestCorrespondenceTable(parsed, options);
      const page = localPage(
        result.data.correspondenceMaps.map(normalizeCorrespondenceItem),
        parsed.page,
        parsed.pageSize,
      );
      return createResponse(
        {
          mode: "fixed",
          table: normalizeCorrespondenceTableMetadata(result.data),
          ...page,
        },
        responseSource(ssbKlassProvider),
        result.data,
        result.cached,
        options,
      );
    }

    const result = await this.#http.request({
      provider: ssbKlassProvider,
      url: `${BASE_URL}/classifications/${parsed.sourceClassificationId}/${
        parsed.mode === "date" ? "correspondsAt" : "corresponds"
      }`,
      query:
        parsed.mode === "date"
          ? {
              targetClassificationId: parsed.targetClassificationId,
              date: parsed.date,
              language: parsed.language,
              includeFuture: parsed.includeFuture,
              inverted: parsed.inverted,
            }
          : {
              targetClassificationId: parsed.targetClassificationId,
              from: parsed.from,
              to: parsed.to,
              language: parsed.language,
              includeFuture: parsed.includeFuture,
            },
      schema: klassCorrespondenceSchema,
      options,
      cacheTtlMs: ssbKlassProvider.cacheTtlMs.correspondence,
      resourceDescription: `correspondence from classification ${parsed.sourceClassificationId} to ${parsed.targetClassificationId}`,
    });
    const page = localPage(
      result.data.correspondenceItems.map(normalizeCorrespondenceItem),
      parsed.page,
      parsed.pageSize,
    );
    const data: KlassGetCorrespondenceResult =
      parsed.mode === "date"
        ? {
            mode: "date",
            sourceClassificationId: parsed.sourceClassificationId,
            targetClassificationId: parsed.targetClassificationId,
            date: parsed.date,
            inverted: parsed.inverted ?? false,
            ...page,
          }
        : {
            mode: "range",
            sourceClassificationId: parsed.sourceClassificationId,
            targetClassificationId: parsed.targetClassificationId,
            from: parsed.from,
            ...(parsed.to === undefined ? {} : { to: parsed.to }),
            ...page,
          };
    return createResponse(
      data,
      responseSource(ssbKlassProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Lists official code-change graph edges strictly between two boundaries.
   *
   * Missing old codes mean creation and missing new codes mean cessation; both
   * sides therefore remain optional in the normalized type.
   */
  async listCodeChanges(
    parameters: KlassListCodeChangesParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<KlassListCodeChangesResult>> {
    const parsed = parseInput(
      listCodeChangesInputSchema,
      parameters,
      "Invalid Klass code-change parameters.",
    );
    const result = await this.#requestCodeChanges(parsed, options);
    return createResponse(
      localPage(result.data.codeChanges.map(normalizeCodeChange), parsed.page, parsed.pageSize),
      responseSource(ssbKlassProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Resolves a municipality code across official classification changes.
   *
   * Every official branch is retained. A missing source date is accepted only
   * when the input code itself is valid on the target date.
   */
  async resolveMunicipalityCode(
    parameters: KlassResolveAdministrativeCodeParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<KlassCodeResolution>> {
    const parsed = parseInput(
      municipalityResolutionInputSchema,
      parameters,
      "Invalid municipality-code resolution parameters.",
    );
    return this.#resolveAdministrativeCode(
      "municipality",
      klassClassificationIds.municipalities,
      parsed,
      options,
    );
  }

  /**
   * Resolves a county code across official classification changes.
   *
   * Merge, split and mixed multi-step relationships are returned explicitly
   * and never reduced to a single candidate.
   */
  async resolveCountyCode(
    parameters: KlassResolveAdministrativeCodeParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<KlassCodeResolution>> {
    const parsed = parseInput(
      countyResolutionInputSchema,
      parameters,
      "Invalid county-code resolution parameters.",
    );
    return this.#resolveAdministrativeCode(
      "county",
      klassClassificationIds.counties,
      parsed,
      options,
    );
  }

  async #requestClassification(
    parameters: {
      classificationId: number;
      language?: KlassLanguage;
      includeFuture?: boolean;
    },
    options?: RequestOptions,
  ): Promise<HttpResult<RawClassification>> {
    return this.#http.request({
      provider: ssbKlassProvider,
      url: `${BASE_URL}/classifications/${parameters.classificationId}`,
      query: {
        language: parameters.language,
        includeFuture: parameters.includeFuture,
      },
      schema: klassClassificationSchema,
      options,
      cacheTtlMs: ssbKlassProvider.cacheTtlMs.classification,
      resourceDescription: `classification ${parameters.classificationId}`,
      transform: (data) => {
        if (data.id !== parameters.classificationId) {
          throw new ResponseValidationError(
            "SSB Klass returned a different classification than requested.",
            { provider: ssbKlassProvider.id },
          );
        }
        return data;
      },
    });
  }

  async #requestVersion(
    parameters: {
      versionId: number;
      language?: KlassLanguage;
      includeFuture?: boolean;
    },
    options?: RequestOptions,
  ): Promise<HttpResult<RawVersion>> {
    return this.#http.request({
      provider: ssbKlassProvider,
      url: `${BASE_URL}/versions/${parameters.versionId}`,
      query: {
        language: parameters.language,
        includeFuture: parameters.includeFuture,
      },
      schema: klassVersionSchema,
      options,
      cacheTtlMs: ssbKlassProvider.cacheTtlMs.version,
      resourceDescription: `classification version ${parameters.versionId}`,
      transform: (data) => {
        if (data.id !== parameters.versionId) {
          throw new ResponseValidationError(
            "SSB Klass returned a different classification version than requested.",
            { provider: ssbKlassProvider.id },
          );
        }
        return data;
      },
    });
  }

  async #requestCodesAt(
    parameters: {
      classificationId: number;
      date: string;
      language?: KlassLanguage;
      includeFuture?: boolean;
      codes?: string[];
      codePattern?: string;
      level?: string;
    },
    options?: RequestOptions,
  ): Promise<HttpResult<z.infer<typeof klassCodesSchema>>> {
    return this.#http.request({
      provider: ssbKlassProvider,
      url: `${BASE_URL}/classifications/${parameters.classificationId}/codesAt`,
      query: {
        date: parameters.date,
        language: parameters.language,
        includeFuture: parameters.includeFuture,
        selectCodes: parameters.codePattern ?? parameters.codes?.join(","),
        selectLevel: parameters.level,
      },
      schema: klassCodesSchema,
      options,
      cacheTtlMs: ssbKlassProvider.cacheTtlMs.codes,
      resourceDescription: `codes for classification ${parameters.classificationId} on ${parameters.date}`,
    });
  }

  async #requestCodesInRange(
    parameters: {
      classificationId: number;
      from: string;
      to?: string;
      language?: KlassLanguage;
      includeFuture?: boolean;
      codes?: string[];
      level?: string;
    },
    options?: RequestOptions,
  ): Promise<HttpResult<z.infer<typeof klassCodesSchema>>> {
    return this.#http.request({
      provider: ssbKlassProvider,
      url: `${BASE_URL}/classifications/${parameters.classificationId}/codes`,
      query: {
        from: parameters.from,
        to: parameters.to,
        language: parameters.language,
        includeFuture: parameters.includeFuture,
        selectCodes: parameters.codes?.join(","),
        selectLevel: parameters.level,
      },
      schema: klassCodesSchema,
      options,
      cacheTtlMs: ssbKlassProvider.cacheTtlMs.codes,
      resourceDescription: `codes for classification ${parameters.classificationId}`,
    });
  }

  async #requestCorrespondenceTable(
    parameters: {
      correspondenceTableId: number;
      language?: KlassLanguage;
    },
    options?: RequestOptions,
  ): Promise<HttpResult<RawCorrespondenceTable>> {
    return this.#http.request({
      provider: ssbKlassProvider,
      url: `${BASE_URL}/correspondencetables/${parameters.correspondenceTableId}`,
      query: { language: parameters.language },
      schema: klassCorrespondenceTableSchema,
      options,
      cacheTtlMs: ssbKlassProvider.cacheTtlMs.correspondenceTables,
      resourceDescription: `correspondence table ${parameters.correspondenceTableId}`,
      transform: (data) => {
        if (data.id !== parameters.correspondenceTableId) {
          throw new ResponseValidationError(
            "SSB Klass returned a different correspondence table than requested.",
            { provider: ssbKlassProvider.id },
          );
        }
        return data;
      },
    });
  }

  async #requestCodeChanges(
    parameters: {
      classificationId: number;
      from: string;
      to?: string;
      language?: KlassLanguage;
      includeFuture?: boolean;
    },
    options?: RequestOptions,
  ): Promise<HttpResult<z.infer<typeof klassCodeChangesSchema>>> {
    return this.#http.request({
      provider: ssbKlassProvider,
      url: `${BASE_URL}/classifications/${parameters.classificationId}/changes`,
      query: {
        from: parameters.from,
        to: parameters.to,
        language: parameters.language,
        includeFuture: parameters.includeFuture,
      },
      schema: klassCodeChangesSchema,
      options,
      cacheTtlMs: ssbKlassProvider.cacheTtlMs.changes,
      resourceDescription: `code changes for classification ${parameters.classificationId}`,
    });
  }

  async #resolveAdministrativeCode(
    kind: "municipality" | "county",
    classificationId: number,
    parameters: {
      code: string;
      sourceDate?: string;
      targetDate: string;
      language?: KlassLanguage;
      includeFuture?: boolean;
    },
    options?: RequestOptions,
  ): Promise<OpenDataResponse<KlassCodeResolution>> {
    const forwarded = responseOptions(options);
    if (parameters.sourceDate === undefined) {
      const target = await this.#requestCodesAt(
        {
          classificationId,
          codePattern: parameters.code,
          date: parameters.targetDate,
          language: parameters.language,
          includeFuture: parameters.includeFuture,
        },
        forwarded,
      );
      const exact = target.data.codes.find(({ code }) => code === parameters.code);
      const match = exact === undefined ? undefined : resolutionMatch(normalizeCode(exact));
      const data: KlassCodeResolution =
        match === undefined
          ? {
              kind,
              input: { code: parameters.code, targetDate: parameters.targetDate },
              status: "context_required",
              matches: [],
              predecessors: [],
              successors: [],
              changes: [],
              warnings: [
                "The code is not valid on the target date. sourceDate is required to identify its historical version.",
                MISSING_CORRESPONDENCE_WARNING,
              ],
            }
          : {
              kind,
              input: { code: parameters.code, targetDate: parameters.targetDate },
              status: "unchanged",
              sourceCode: match,
              matches: [match],
              predecessors: [],
              successors: [],
              changes: [],
              warnings: [],
            };
      return createResponse(
        data,
        responseSource(ssbKlassProvider),
        { targetCodes: target.data },
        target.cached,
        options,
      );
    }

    const source = await this.#requestCodesAt(
      {
        classificationId,
        codePattern: parameters.code,
        date: parameters.sourceDate,
        language: parameters.language,
        includeFuture: parameters.includeFuture,
      },
      forwarded,
    );
    const exactSource = source.data.codes.find(({ code }) => code === parameters.code);
    if (exactSource === undefined) {
      const data: KlassCodeResolution = {
        kind,
        input: {
          code: parameters.code,
          sourceDate: parameters.sourceDate,
          targetDate: parameters.targetDate,
        },
        status: "not_found",
        matches: [],
        predecessors: [],
        successors: [],
        changes: [],
        warnings: [
          `The code is not present in the official ${kind} classification on the supplied source date.`,
          MISSING_CORRESPONDENCE_WARNING,
        ],
      };
      return createResponse(
        data,
        responseSource(ssbKlassProvider),
        { sourceCodes: source.data },
        source.cached,
        options,
      );
    }

    const sourceMatch = resolutionMatch(normalizeCode(exactSource));
    if (parameters.sourceDate === parameters.targetDate) {
      const data: KlassCodeResolution = {
        kind,
        input: {
          code: parameters.code,
          sourceDate: parameters.sourceDate,
          targetDate: parameters.targetDate,
        },
        status: "unchanged",
        sourceCode: sourceMatch,
        matches: [sourceMatch],
        predecessors: [],
        successors: [],
        changes: [],
        warnings: [],
      };
      return createResponse(
        data,
        responseSource(ssbKlassProvider),
        { sourceCodes: source.data },
        source.cached,
        options,
      );
    }

    const direction = parameters.sourceDate < parameters.targetDate ? "forward" : "backward";
    const from = direction === "forward" ? parameters.sourceDate : parameters.targetDate;
    const through = direction === "forward" ? parameters.targetDate : parameters.sourceDate;
    const changes = await this.#requestCodeChanges(
      {
        classificationId,
        from,
        to: nextDate(through),
        language: parameters.language,
        includeFuture: parameters.includeFuture,
      },
      forwarded,
    );
    const normalizedChanges = changes.data.codeChanges.map(normalizeCodeChange);
    const traversal = traverseChanges(sourceMatch, normalizedChanges, direction);
    const candidateCodes = traversal.candidates.map(({ code }) => code);
    if (candidateCodes.length === 0) {
      const data: KlassCodeResolution = {
        kind,
        input: {
          code: parameters.code,
          sourceDate: parameters.sourceDate,
          targetDate: parameters.targetDate,
        },
        status: "not_found",
        sourceCode: sourceMatch,
        matches: [],
        predecessors: traversal.predecessors,
        successors: traversal.successors,
        changes: traversal.traversedEdges,
        warnings: [
          ...(traversal.traversedEdges.length === 0 ? [] : [ADMINISTRATIVE_COMPARABILITY_WARNING]),
          MISSING_CORRESPONDENCE_WARNING,
        ],
      };
      return createResponse(
        data,
        responseSource(ssbKlassProvider),
        {
          sourceCodes: source.data,
          codeChanges: changes.data,
        },
        source.cached && changes.cached,
        options,
      );
    }
    const target = await this.#requestCodesAt(
      {
        classificationId,
        codes: candidateCodes,
        date: parameters.targetDate,
        language: parameters.language,
        includeFuture: parameters.includeFuture,
      },
      forwarded,
    );
    const targetCodesByCode = new Map(
      target.data.codes.map((code) => [code.code, resolutionMatch(normalizeCode(code))]),
    );
    const matches = traversal.candidates.flatMap((candidate) => {
      const official = targetCodesByCode.get(candidate.code);
      return official === undefined ? [] : [official];
    });
    const warnings: string[] = [];
    if (traversal.traversedEdges.length > 0) warnings.push(ADMINISTRATIVE_COMPARABILITY_WARNING);
    if (matches.length < traversal.candidates.length) {
      warnings.push(
        "At least one graph candidate was not present in the official classification on the target date.",
      );
    }
    if (matches.length === 0) warnings.push(MISSING_CORRESPONDENCE_WARNING);
    if (traversal.sawMerge && traversal.sawSplit) {
      warnings.push(
        "The requested interval crosses both merge and split relationships; all surviving official candidates are returned.",
      );
    }

    const data: KlassCodeResolution = {
      kind,
      input: {
        code: parameters.code,
        sourceDate: parameters.sourceDate,
        targetDate: parameters.targetDate,
      },
      status: resolutionStatus(sourceMatch, matches, traversal),
      sourceCode: sourceMatch,
      matches,
      predecessors: traversal.predecessors,
      successors: traversal.successors,
      changes: traversal.traversedEdges,
      warnings,
    };
    return createResponse(
      data,
      responseSource(ssbKlassProvider),
      {
        sourceCodes: source.data,
        codeChanges: changes.data,
        targetCodes: target.data,
      },
      source.cached && changes.cached && target.cached,
      options,
    );
  }
}
