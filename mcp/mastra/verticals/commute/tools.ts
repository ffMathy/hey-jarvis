import { Client, type LatLngLiteral } from '@googlemaps/google-maps-services-js';
import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';

const getGoogleMapsClient = () => {
  const apiKey = process.env.HEY_JARVIS_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Google Maps API key not found.\n' +
        '\n' +
        'Google Maps APIs require an API key (not OAuth2 credentials).\n' +
        'If you already have a Google Cloud project for Calendar/Tasks:\n' +
        '\n' +
        '1. Go to Google Cloud Console (https://console.cloud.google.com)\n' +
        '2. Select your existing project (same one used for Calendar/Tasks)\n' +
        '3. Enable these APIs:\n' +
        '   - Distance Matrix API\n' +
        '   - Directions API\n' +
        '   - Places API\n' +
        '   - Geocoding API\n' +
        '4. Go to "Credentials" → "Create Credentials" → "API Key"\n' +
        '5. Set HEY_JARVIS_GOOGLE_MAPS_API_KEY environment variable\n' +
        '\n' +
        'Store in 1Password: op://Personal/Google Maps/API key',
    );
  }
  return { client: new Client({}), apiKey };
};

export const getTravelTime = createTool({
  id: 'getTravelTime',
  description: 'Get estimated travel time and distance between two locations with optional traffic data',
  inputSchema: z.object({
    origin: z
      .string()
      .describe('Starting point as address or coordinates (e.g., "Copenhagen, Denmark" or "55.6761,12.5683")'),
    destination: z.string().describe('Destination as address or coordinates'),
    mode: z.enum(['driving', 'walking', 'bicycling', 'transit']).default('driving').describe('Travel mode'),
    departureTime: z
      .string()
      .optional()
      .describe(
        'Departure time as ISO 8601 string (e.g., "2024-01-15T09:00:00Z") for traffic estimation. If not provided, uses current time.',
      ),
    includeTraffic: z.boolean().default(true).describe('Whether to include current traffic data in the estimation'),
  }),
  outputSchema: z.object({
    distance: z.object({
      text: z.string(),
      value: z.number().describe('Distance in meters'),
    }),
    duration: z.object({
      text: z.string(),
      value: z.number().describe('Duration in seconds'),
    }),
    durationInTraffic: z
      .object({
        text: z.string(),
        value: z.number().describe('Duration with traffic in seconds'),
      })
      .optional(),
    startAddress: z.string(),
    endAddress: z.string(),
    mode: z.string(),
  }),
  execute: async ({ origin, destination, mode, departureTime, includeTraffic }) => {
    const { client, apiKey } = getGoogleMapsClient();

    const params: {
      origins: [string];
      destinations: [string];
      mode?: 'driving' | 'walking' | 'bicycling' | 'transit';
      departure_time?: Date | number;
      key: string;
    } = {
      origins: [origin],
      destinations: [destination],
      key: apiKey,
    };

    if (mode === 'driving' || mode === 'walking' || mode === 'bicycling' || mode === 'transit') {
      params.mode = mode;
    }

    if (includeTraffic && mode === 'driving') {
      params.departure_time = departureTime ? new Date(departureTime) : new Date();
    }

    const response = await client.distancematrix({ params });

    if (response.data.status !== 'OK') {
      throw new Error(
        `Google Maps API error: ${response.data.status} - ${response.data.error_message || 'Unknown error'}`,
      );
    }

    const element = response.data.rows[0]?.elements[0];
    if (!element || element.status !== 'OK') {
      throw new Error(`Route calculation failed: ${element?.status || 'Unknown error'}`);
    }

    return {
      distance: element.distance,
      duration: element.duration,
      durationInTraffic: element.duration_in_traffic,
      startAddress: response.data.origin_addresses[0],
      endAddress: response.data.destination_addresses[0],
      mode,
    };
  },
});

export const searchPlacesAlongRoute = createTool({
  id: 'searchPlacesAlongRoute',
  description: 'Find places (e.g., EV chargers, gas stations, restaurants) along a route between two locations',
  inputSchema: z.object({
    origin: z.string().describe('Starting point as address or coordinates'),
    destination: z.string().describe('Destination as address or coordinates'),
    searchQuery: z.string().describe('What to search for (e.g., "EV charging station", "coffee shop", "gas station")'),
    maxResults: z.number().default(5).describe('Maximum number of results to return (1-20)'),
  }),
  outputSchema: z.object({
    places: z.array(
      z.object({
        name: z.string(),
        address: z.string(),
        location: z.object({
          lat: z.number(),
          lng: z.number(),
        }),
        rating: z.number().optional(),
        userRatingsTotal: z.number().optional(),
        description: z.string().optional(),
        types: z.array(z.string()).optional(),
      }),
    ),
    routeInfo: z.object({
      origin: z.string(),
      destination: z.string(),
    }),
  }),
  execute: async ({ origin, destination, searchQuery, maxResults }) => {
    const { client, apiKey } = getGoogleMapsClient();

    const directionsResponse = await client.directions({
      params: {
        origin,
        destination,
        key: apiKey,
      },
    });

    if (directionsResponse.data.status !== 'OK') {
      throw new Error(
        `Directions API error: ${directionsResponse.data.status} - ${directionsResponse.data.error_message || 'Unknown error'}`,
      );
    }

    if (!directionsResponse.data.routes || directionsResponse.data.routes.length === 0) {
      throw new Error('No route found between the specified locations');
    }

    const route = directionsResponse.data.routes[0];
    if (!route.legs || route.legs.length === 0) {
      throw new Error('Route has no legs');
    }

    const allLocations: LatLngLiteral[] = [];
    for (const leg of route.legs) {
      if (leg.steps) {
        for (const step of leg.steps) {
          allLocations.push(step.start_location);
        }
      }
    }

    if (allLocations.length === 0) {
      allLocations.push(route.legs[0].start_location);
    }

    const midpointIndex = Math.floor(allLocations.length / 2);
    const searchLocation = allLocations[midpointIndex];

    const placesResponse = await client.textSearch({
      params: {
        query: searchQuery,
        location: searchLocation,
        radius: 50000,
        key: apiKey,
      },
    });

    if (placesResponse.data.status !== 'OK' && placesResponse.data.status !== 'ZERO_RESULTS') {
      throw new Error(
        `Places API error: ${placesResponse.data.status} - ${placesResponse.data.error_message || 'Unknown error'}`,
      );
    }

    const places = (placesResponse.data.results || []).slice(0, maxResults).map((place) => ({
      name: place.name || '',
      address: place.formatted_address || '',
      location: {
        lat: place.geometry?.location.lat || 0,
        lng: place.geometry?.location.lng || 0,
      },
      rating: place.rating,
      userRatingsTotal: place.user_ratings_total,
      description: place.types?.join(', '),
      types: place.types,
    }));

    return {
      places,
      routeInfo: {
        origin: route.legs[0].start_address,
        destination: route.legs[route.legs.length - 1].end_address,
      },
    };
  },
});

export const searchPlacesByDistance = createTool({
  id: 'searchPlacesByDistance',
  description: 'Search for places near a location, ordered by distance (closest first)',
  inputSchema: z.object({
    location: z.string().describe('Center location as address or coordinates'),
    searchQuery: z.string().describe('What to search for (e.g., "restaurant", "EV charger", "hotel")'),
    radius: z.number().default(5000).describe('Search radius in meters (max 50000)'),
    maxResults: z.number().default(10).describe('Maximum number of results to return (1-20)'),
  }),
  outputSchema: z.object({
    places: z.array(
      z.object({
        name: z.string(),
        address: z.string(),
        location: z.object({
          lat: z.number(),
          lng: z.number(),
        }),
        rating: z.number().optional(),
        userRatingsTotal: z.number().optional(),
        description: z.string().optional(),
        types: z.array(z.string()).optional(),
        distanceFromCenter: z.number().optional().describe('Distance in meters from search center'),
      }),
    ),
    searchCenter: z.object({
      address: z.string(),
      location: z.object({
        lat: z.number(),
        lng: z.number(),
      }),
    }),
  }),
  execute: async ({ location, searchQuery, radius, maxResults }) => {
    const { client, apiKey } = getGoogleMapsClient();

    const geocodeResponse = await client.geocode({
      params: {
        address: location,
        key: apiKey,
      },
    });

    if (geocodeResponse.data.status !== 'OK') {
      throw new Error(
        `Geocoding error: ${geocodeResponse.data.status} - ${geocodeResponse.data.error_message || 'Unknown error'}`,
      );
    }

    if (!geocodeResponse.data.results || geocodeResponse.data.results.length === 0) {
      throw new Error(`Could not geocode location: ${location}`);
    }

    const centerLocation = geocodeResponse.data.results[0].geometry.location;
    const centerAddress = geocodeResponse.data.results[0].formatted_address;

    const placesResponse = await client.textSearch({
      params: {
        query: searchQuery,
        location: centerLocation,
        radius: Math.min(radius, 50000),
        key: apiKey,
      },
    });

    if (placesResponse.data.status !== 'OK' && placesResponse.data.status !== 'ZERO_RESULTS') {
      throw new Error(
        `Places API error: ${placesResponse.data.status} - ${placesResponse.data.error_message || 'Unknown error'}`,
      );
    }

    const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371000;
      const φ1 = (lat1 * Math.PI) / 180;
      const φ2 = (lat2 * Math.PI) / 180;
      const Δφ = ((lat2 - lat1) * Math.PI) / 180;
      const Δλ = ((lon2 - lon1) * Math.PI) / 180;

      const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      return R * c;
    };

    const places = (placesResponse.data.results || [])
      .map((place) => ({
        name: place.name || '',
        address: place.formatted_address || '',
        location: {
          lat: place.geometry?.location.lat || 0,
          lng: place.geometry?.location.lng || 0,
        },
        rating: place.rating,
        userRatingsTotal: place.user_ratings_total,
        description: place.types?.join(', '),
        types: place.types,
        distanceFromCenter: calculateDistance(
          centerLocation.lat,
          centerLocation.lng,
          place.geometry?.location.lat || 0,
          place.geometry?.location.lng || 0,
        ),
      }))
      .sort((a, b) => (a.distanceFromCenter || 0) - (b.distanceFromCenter || 0))
      .slice(0, maxResults);

    return {
      places,
      searchCenter: {
        address: centerAddress || '',
        location: centerLocation,
      },
    };
  },
});

export const getPlaceDetails = createTool({
  id: 'getPlaceDetails',
  description: 'Get detailed information about a specific place including reviews, opening hours, and contact info',
  inputSchema: z.object({
    placeId: z.string().optional().describe('Google Place ID for the location'),
    placeName: z.string().optional().describe('Name and address of the place (used if placeId not provided)'),
    location: z.string().optional().describe('Area to search in if using placeName (e.g., "Copenhagen, Denmark")'),
  }),
  outputSchema: z.object({
    name: z.string(),
    address: z.string(),
    location: z.object({
      lat: z.number(),
      lng: z.number(),
    }),
    rating: z.number().optional(),
    userRatingsTotal: z.number().optional(),
    description: z.string().optional(),
    types: z.array(z.string()).optional(),
    phoneNumber: z.string().optional(),
    website: z.string().optional(),
    openingHours: z
      .object({
        openNow: z.boolean().optional(),
        weekdayText: z.array(z.string()).optional(),
      })
      .optional(),
    reviews: z
      .array(
        z.object({
          authorName: z.string(),
          rating: z.number(),
          text: z.string(),
          time: z.number(),
        }),
      )
      .optional(),
  }),
  execute: async ({ placeId, placeName, location }) => {
    const { client, apiKey } = getGoogleMapsClient();

    let actualPlaceId = placeId;

    if (!actualPlaceId && placeName) {
      const searchQuery = location ? `${placeName} ${location}` : placeName;
      const findResponse = await client.findPlaceFromText({
        params: {
          input: searchQuery,
          inputtype: 'textquery',
          fields: ['place_id'],
          key: apiKey,
        },
      });

      if (findResponse.data.status !== 'OK' || !findResponse.data.candidates?.[0]?.place_id) {
        throw new Error(`Could not find place: ${placeName}`);
      }

      actualPlaceId = findResponse.data.candidates[0].place_id;
    }

    if (!actualPlaceId) {
      throw new Error('Either placeId or placeName must be provided');
    }

    const detailsResponse = await client.placeDetails({
      params: {
        place_id: actualPlaceId,
        fields: [
          'name',
          'formatted_address',
          'geometry',
          'rating',
          'user_ratings_total',
          'type',
          'formatted_phone_number',
          'website',
          'opening_hours',
          'review',
        ],
        key: apiKey,
      },
    });

    if (detailsResponse.data.status !== 'OK') {
      throw new Error(
        `Place Details API error: ${detailsResponse.data.status} - ${detailsResponse.data.error_message || 'Unknown error'}`,
      );
    }

    const place = detailsResponse.data.result;

    return {
      name: place.name || '',
      address: place.formatted_address || '',
      location: {
        lat: place.geometry?.location.lat || 0,
        lng: place.geometry?.location.lng || 0,
      },
      rating: place.rating,
      userRatingsTotal: place.user_ratings_total,
      description: place.types?.join(', '),
      types: place.types,
      phoneNumber: place.formatted_phone_number,
      website: place.website,
      openingHours: place.opening_hours
        ? {
            openNow: place.opening_hours.open_now,
            weekdayText: place.opening_hours.weekday_text,
          }
        : undefined,
      reviews: place.reviews?.slice(0, 5).map((review) => ({
        authorName: review.author_name || '',
        rating: review.rating || 0,
        text: review.text || '',
        time: review.time || 0,
      })),
    };
  },
});

export const commuteTools = {
  getTravelTime,
  searchPlacesAlongRoute,
  searchPlacesByDistance,
  getPlaceDetails,
};
