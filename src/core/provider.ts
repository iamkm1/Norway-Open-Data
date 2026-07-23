/**
 * Provider descriptors.
 *
 * A descriptor is the single declaration of everything the SDK core needs to
 * know about one public-data provider: its legal metadata, how a caller
 * identifies itself, how often it may be called, and how long its responses
 * stay fresh. Core reads descriptors; it never special-cases a provider.
 */

/** Configuration values a provider can require in order to identify the caller. */
export type ProviderAuthField = "applicationName" | "contactEmail" | "apiKey";

/**
 * Auth values passed to a descriptor's `headers` builder.
 *
 * Only the fields named in `requires` are present, and the core guarantees they
 * are non-empty strings before calling the builder.
 */
export type ProviderAuthValues<Field extends ProviderAuthField> = Readonly<
  Record<Field | "sdkVersion", string>
>;

/** How a provider identifies the caller on every request that needs it. */
export type ProviderAuth<Field extends ProviderAuthField = ProviderAuthField> = {
  /** Configuration values that must be present before a request can be sent. */
  readonly requires: readonly Field[];
  /** Builds the identifying request headers from the resolved values. */
  readonly headers: (values: ProviderAuthValues<Field>) => Record<string, string>;
  /** Tells the caller exactly what to configure when a required value is missing. */
  readonly missing: string;
};

/**
 * Request budget the SDK applies to a provider.
 *
 * `provider-documented` limits come from the provider's own published terms.
 * `sdk-courtesy` limits are the SDK's conservative choice for a provider that
 * publishes no explicit number, and exist so a busy caller cannot be mistaken
 * for abuse.
 */
export type RateLimitPolicy = {
  /** Requests permitted per interval. */
  readonly requests: number;
  /** Length of the sliding window in milliseconds. */
  readonly intervalMs: number;
  /** Where the number comes from. */
  readonly basis: "provider-documented" | "sdk-courtesy";
  /** Human-readable justification, quoted in documentation. */
  readonly note: string;
};

/**
 * A provider's request budgets, keyed by operation class.
 *
 * `default` applies to every request that does not name another budget. Some
 * providers publish very different limits for different services -- Data.norge
 * allows 10 search requests per minute but 5 resource lookups per second -- and
 * collapsing those into one budget would either exceed the tighter limit or
 * needlessly throttle the looser one.
 */
export type ProviderRateLimits = {
  readonly default: RateLimitPolicy;
  readonly [operationClass: string]: RateLimitPolicy;
};

/**
 * Named cache lifetimes for one provider's operation classes.
 *
 * Clients reference these by name rather than repeating raw millisecond
 * literals, so a provider's freshness policy is reviewable in one place.
 */
export type ProviderCacheTtls = Readonly<Record<string, number>>;

/** Access model a provider offers to anonymous callers. */
export type ProviderAccess = "open" | "identification-required" | "registration-required";

/** Everything the SDK core knows about one public-data provider. */
export type ProviderDescriptor<
  Field extends ProviderAuthField = ProviderAuthField,
  Ttls extends ProviderCacheTtls = ProviderCacheTtls,
> = {
  /** Stable provider identifier used in errors, cache keys and response sources. */
  readonly id: string;
  readonly name: string;
  readonly homepage: string;
  readonly documentation: string;
  readonly access: ProviderAccess;
  /** Prose description of the provider's authentication requirements. */
  readonly authentication: string;
  readonly license?: string;
  readonly attribution?: string;
  /**
   * Caller identification, when the provider requires it.
   *
   * Absent for providers that serve anonymous requests. Present but only
   * consulted by the operations that need it when a provider requires
   * credentials for a subset of its endpoints.
   */
  readonly auth?: ProviderAuth<Field>;
  /** Request budgets applied to this provider, when one is warranted. */
  readonly rateLimit?: ProviderRateLimits;
  /** Named cache lifetimes for this provider's operation classes. */
  readonly cacheTtlMs: Ttls;
};

/**
 * Legal and operational metadata for a public-data provider.
 *
 * This is the descriptor's publicly documented subset. It excludes the
 * behavioural fields (`auth` header builders, cache lifetimes) that only the
 * SDK core consumes.
 */
export type ProviderMetadata = {
  id: string;
  name: string;
  homepage: string;
  documentation: string;
  access: ProviderAccess;
  authentication: string;
  license?: string;
  attribution?: string;
  rateLimit?: ProviderRateLimits;
};

/** Source metadata attached to every successful SDK response. */
export type OpenDataSource = Pick<
  ProviderMetadata,
  "id" | "name" | "homepage" | "documentation" | "license" | "attribution"
>;

/** Creates the response-envelope source representation. */
export function responseSource(provider: ProviderMetadata): OpenDataSource {
  return {
    id: provider.id,
    name: provider.name,
    homepage: provider.homepage,
    documentation: provider.documentation,
    ...(provider.license === undefined ? {} : { license: provider.license }),
    ...(provider.attribution === undefined ? {} : { attribution: provider.attribution }),
  };
}

/** Auth values the SDK can supply, before any requirement has been checked. */
export type AvailableAuthValues = Partial<Record<ProviderAuthField, string>>;

/**
 * Returns the auth fields a provider requires but the caller has not supplied.
 *
 * Shared by the HTTP client, which refuses to send an unidentifiable request,
 * and by cross-provider profiles, which skip a component the caller cannot
 * authenticate rather than failing the whole composition.
 */
export function missingAuthFields(
  provider: ProviderDescriptor,
  available: AvailableAuthValues,
): readonly ProviderAuthField[] {
  if (provider.auth === undefined) return [];
  return provider.auth.requires.filter((field) => {
    const value = available[field];
    return value === undefined || value.trim().length === 0;
  });
}

/** Narrows a descriptor to the metadata the SDK documents publicly. */
export function providerMetadata(descriptor: ProviderDescriptor): ProviderMetadata {
  return {
    id: descriptor.id,
    name: descriptor.name,
    homepage: descriptor.homepage,
    documentation: descriptor.documentation,
    access: descriptor.access,
    authentication: descriptor.authentication,
    ...(descriptor.license === undefined ? {} : { license: descriptor.license }),
    ...(descriptor.attribution === undefined ? {} : { attribution: descriptor.attribution }),
    ...(descriptor.rateLimit === undefined ? {} : { rateLimit: descriptor.rateLimit }),
  };
}

/**
 * Declares how a provider identifies the caller.
 *
 * `requires` is the sole inference site for the field set, so `headers` is
 * checked against exactly the values the provider asked for. Reading a value
 * that was never required is a compile error rather than a header containing
 * the string "undefined".
 */
export function defineAuth<const Field extends ProviderAuthField>(auth: {
  readonly requires: readonly Field[];
  readonly headers: (values: ProviderAuthValues<Field>) => Record<string, string>;
  readonly missing: string;
}): ProviderAuth<Field> {
  return auth;
}
