/** Parameters for elected representatives. Omitting the period uses Stortinget's current period. */
export type ParliamentRepresentativesParameters = {
  /** Official period identifier, for example `2025-2029`. */
  periodId?: string;
  /** Includes deputy representatives in addition to elected representatives. */
  includeDeputies?: boolean;
};

/** A normalized elected representative from Stortinget. */
export type Representative = {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName: string;
  party?: {
    id?: string;
    name?: string;
  };
  county?: string;
  /** Not currently supplied by the representative/person exports. */
  activeFrom?: string;
  /** Not currently supplied by the representative/person exports. */
  activeTo?: string;
};

/** Parameters for parties represented during a session or parliamentary period. */
export type ParliamentPartiesParameters = {
  /** Official session identifier, for example `2025-2026`. */
  sessionId?: string;
  /** Official period identifier, for example `2025-2029`. */
  periodId?: string;
};

/** A political party returned by Stortinget's open data service. */
export type ParliamentaryParty = {
  id: string;
  name: string;
};

/** Official case statuses exposed by Stortinget. */
export type ParliamentaryCaseStatus =
  | "varslet"
  | "mottatt"
  | "til_behandling"
  | "behandlet"
  | "trukket"
  | "bortfalt"
  | "ikke_spesifisert";

/** Official high-level case types exposed by Stortinget. */
export type ParliamentaryCaseType = "budsjett" | "lovsak" | "alminneligsak" | "ikke_spesifisert";

/** Filters applied locally to the official full-session case export. */
export type ParliamentaryCaseSearchParameters = {
  /** Case-insensitive text filter over title, short title, and reference. */
  query?: string;
  /** Official session identifier. Omitting it requests the current session. */
  sessionId?: string;
  status?: ParliamentaryCaseStatus;
  type?: ParliamentaryCaseType;
  /** Zero-based local result page. Stortinget does not provide server pagination. */
  page?: number;
  /** Local page size, from 1 through 100. */
  size?: number;
};

/** A normalized parliamentary case. */
export type ParliamentaryCase = {
  id: string;
  title: string;
  status?: string;
  type?: string;
  session?: string;
  submittedAt?: string;
  decidedAt?: string;
  committees?: Array<{
    id?: string;
    name?: string;
  }>;
};

/** Pagination produced locally after filtering a full-session case export. */
export type ParliamentaryCaseSearchPagination = {
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
};

/** Locally filtered and paginated parliamentary cases. */
export type ParliamentaryCaseSearchResult = {
  items: ParliamentaryCase[];
  pagination: ParliamentaryCaseSearchPagination;
};

/** A normalized vote associated with a parliamentary case. */
export type ParliamentaryVote = {
  id?: string;
  caseId?: string;
  date?: string;
  result?: string;
  forCount?: number;
  againstCount?: number;
  absentCount?: number;
};

/** Which official question-list export to request. */
export type ParliamentaryQuestionCategory = "question-time" | "interpellation" | "written";

/** Official question statuses accepted by the question-list exports. */
export type ParliamentaryQuestionStatus =
  "ikke_spesifisert" | "besvart" | "bortfalt" | "til_behandling" | "trukket" | "venter_utsatt";

/** Parameters for one of Stortinget's three question-list exports. */
export type ParliamentQuestionsParameters = {
  /** Official session identifier. Omitting it requests the current session. */
  sessionId?: string;
  /** Defaults to written questions to keep one SDK call equal to one provider call. */
  category?: ParliamentaryQuestionCategory;
  /** Defaults to `alle`; the provider otherwise silently returns answered questions only. */
  status?: ParliamentaryQuestionStatus | "alle";
};

/** A compact person reference embedded in a parliamentary question. */
export type ParliamentaryPersonReference = {
  id?: string;
  fullName?: string;
};

/** A normalized question from one of Stortinget's question-list exports. */
export type ParliamentaryQuestion = {
  id: string;
  legacyId?: string;
  number?: number;
  title: string;
  type?: string;
  status?: string;
  session?: string;
  datedAt?: string;
  sentAt?: string;
  answeredAt?: string;
  askedBy?: ParliamentaryPersonReference;
  answeredBy?: ParliamentaryPersonReference;
};

/** Parameters for meetings in an official parliamentary session. */
export type ParliamentMeetingsParameters = {
  /** Official session identifier. Omitting it requests the current session. */
  sessionId?: string;
};

/** A normalized Storting meeting or a provider-declared non-meeting day. */
export type ParliamentaryMeeting = {
  id: string;
  session?: string;
  date?: string;
  chamber?: string;
  sequence?: number;
  agendaNumber?: number;
  transcriptId?: string;
  note?: string;
  isMeeting: boolean;
};
