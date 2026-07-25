/**
 * Composition rules for the cross-provider vessel profile.
 *
 * Kept out of `client.ts` so the decisions that need explaining -- how a vessel is
 * matched between two registers that share no identifier, and which position
 * counts as the latest -- can be read and tested on their own.
 */
import type { AisTrack, AisTrackPoint } from "../providers/barentswatch-ais/types.js";

/**
 * Picks the most recent point from a track.
 *
 * The provider returns points in its own order, so the newest is found by message
 * time rather than by taking the last element. A tie keeps the earlier element,
 * which makes the result deterministic for a vessel that reported twice within the
 * same timestamp.
 *
 * The point is returned as the provider's own track shape rather than converted
 * into an AIS position report: the historic endpoint merges position and identity
 * fields and carries no AIS message type, so presenting it as a position report
 * would mean inventing one.
 */
export function latestTrackPoint(track: AisTrack): AisTrackPoint | undefined {
  let newest: AisTrackPoint | undefined;
  for (const point of track.points) {
    if (newest === undefined || point.messageTime > newest.messageTime) newest = point;
  }
  return newest;
}

/**
 * The vessel name AIS reported for a track, when it reported one.
 *
 * Each point carries the name from the vessel's static broadcast, so the first
 * non-empty one is enough: they all describe the same vessel.
 */
export function trackName(track: AisTrack): string | undefined {
  for (const point of track.points) {
    const name = point.name?.trim();
    if (name !== undefined && name.length > 0) return name;
  }
  return undefined;
}

/**
 * Chooses the radio call sign to match against the fishing-vessel register.
 *
 * The two sources share no primary identifier: AIS is keyed by MMSI, which the
 * register does not hold, and the register is keyed by its own id and registration
 * mark, which AIS does not transmit. The radio call sign is the one field both
 * publish, and it is a real join key -- assigned per vessel by the national
 * authority -- rather than a name-similarity guess.
 *
 * When AIS supplies no call sign the register lookup is skipped rather than
 * attempted by name, which is not unique and would produce confident wrong matches.
 */
export function joinCallSign(
  candidates: readonly (string | null | undefined)[],
): string | undefined {
  for (const candidate of candidates) {
    const callSign = candidate?.trim().toUpperCase();
    if (callSign !== undefined && callSign.length > 0) return callSign;
  }
  return undefined;
}
