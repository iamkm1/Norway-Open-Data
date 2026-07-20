/** GraphQL document used for departure boards. */
export const DEPARTURES_QUERY = /* GraphQL */ `
  query Departures($id: String!, $startTime: DateTime, $limit: Int!) {
    stopPlace(id: $id) {
      id
      name
      estimatedCalls(
        startTime: $startTime
        numberOfDepartures: $limit
        includeCancelledTrips: true
      ) {
        realtime
        cancellation
        aimedDepartureTime
        expectedDepartureTime
        destinationDisplay {
          frontText
        }
        serviceJourney {
          journeyPattern {
            line {
              id
              publicCode
              name
              transportMode
            }
          }
        }
      }
    }
  }
`;

/** GraphQL document used for point-to-point journeys. */
export const JOURNEYS_QUERY = /* GraphQL */ `
  query Journeys(
    $from: Location!
    $to: Location!
    $dateTime: DateTime
    $arriveBy: Boolean
    $limit: Int!
  ) {
    trip(from: $from, to: $to, dateTime: $dateTime, arriveBy: $arriveBy, numTripPatterns: $limit) {
      tripPatterns {
        startTime
        endTime
        duration
        legs {
          mode
          distance
          expectedStartTime
          expectedEndTime
          line {
            id
            publicCode
            name
            transportMode
          }
          fromEstimatedCall {
            quay {
              id
              name
            }
            realtime
            cancellation
            aimedDepartureTime
            expectedDepartureTime
          }
          toEstimatedCall {
            quay {
              id
              name
            }
            realtime
            cancellation
            aimedArrivalTime
            expectedArrivalTime
          }
        }
      }
    }
  }
`;
