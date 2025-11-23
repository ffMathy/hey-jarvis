import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';

const getApiKey = () => {
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
  return apiKey;
};

const GOOGLE_MAPS_API_BASE = 'https://maps.googleapis.com/maps/api';

interface PlaceResult {
  name: string;
  address: string;
  location: {
    lat: number;
    lng: number;
  };
  rating?: number;
  userRatingsTotal?: number;
  description?: string;
  types?: string[];
}

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
    const apiKey = getApiKey();

    const params = new URLSearchParams({
      origin,
      destination,
      mode,
      key: apiKey,
    });

    if (includeTraffic && mode === 'driving') {
      params.append(
        'departure_time',
        departureTime ? Math.floor(new Date(departureTime).getTime() / 1000).toString() : 'now',
      );
    }

    const url = `${GOOGLE_MAPS_API_BASE}/distancematrix/json?${params.toString()}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK') {
      throw new Error(`Google Maps API error: ${data.status} - ${data.error_message || 'Unknown error'}`);
    }

    const element = data.rows[0]?.elements[0];
    if (!element || element.status !== 'OK') {
      throw new Error(`Route calculation failed: ${element?.status || 'Unknown error'}`);
    }

    return {
      distance: element.distance,
      duration: element.duration,
      durationInTraffic: element.duration_in_traffic,
      startAddress: data.origin_addresses[0],
      endAddress: data.destination_addresses[0],
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
    const apiKey = getApiKey();

    const directionsParams = new URLSearchParams({
      origin,
      destination,
      key: apiKey,
    });

    const directionsUrl = `${GOOGLE_MAPS_API_BASE}/directions/json?${directionsParams.toString()}`;
    const directionsResponse = await fetch(directionsUrl);
    const directionsData = await directionsResponse.json();

    if (directionsData.status !== 'OK') {
      throw new Error(
        `Directions API error: ${directionsData.status} - ${directionsData.error_message || 'Unknown error'}`,
      );
    }

    if (!directionsData.routes || directionsData.routes.length === 0) {
      throw new Error('No route found between the specified locations');
    }

    const route = directionsData.routes[0];
    if (!route.legs || route.legs.length === 0) {
      throw new Error('Route has no legs');
    }
    const polyline = route.overview_polyline.points;

    const points: { lat: number; lng: number }[] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < polyline.length) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = polyline.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += deltaLat;

      result = 0;
      shift = 0;
      do {
        byte = polyline.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += deltaLng;

      points.push({
        lat: lat / 1e5,
        lng: lng / 1e5,
      });
    }

    const midpointIndex = Math.floor(points.length / 2);
    const searchLocation = points[midpointIndex];

    const placesParams = new URLSearchParams({
      query: searchQuery,
      location: `${searchLocation.lat},${searchLocation.lng}`,
      radius: '50000',
      key: apiKey,
    });

    const placesUrl = `${GOOGLE_MAPS_API_BASE}/place/textsearch/json?${placesParams.toString()}`;
    const placesResponse = await fetch(placesUrl);
    const placesData = await placesResponse.json();

    if (placesData.status !== 'OK' && placesData.status !== 'ZERO_RESULTS') {
      throw new Error(`Places API error: ${placesData.status} - ${placesData.error_message || 'Unknown error'}`);
    }

    const places: PlaceResult[] = (placesData.results || []).slice(0, maxResults).map((place: unknown) => {
      const p = place as {
        name: string;
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
        rating?: number;
        user_ratings_total?: number;
        types?: string[];
      };
      return {
        name: p.name,
        address: p.formatted_address,
        location: {
          lat: p.geometry.location.lat,
          lng: p.geometry.location.lng,
        },
        rating: p.rating,
        userRatingsTotal: p.user_ratings_total,
        description: p.types?.join(', '),
        types: p.types,
      };
    });

    return {
      places,
      routeInfo: {
        origin: route.legs[0].start_address,
        destination: route.legs[0].end_address,
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
    const apiKey = getApiKey();

    const geocodeParams = new URLSearchParams({
      address: location,
      key: apiKey,
    });

    const geocodeUrl = `${GOOGLE_MAPS_API_BASE}/geocode/json?${geocodeParams.toString()}`;
    const geocodeResponse = await fetch(geocodeUrl);
    const geocodeData = await geocodeResponse.json();

    if (geocodeData.status !== 'OK') {
      throw new Error(`Geocoding error: ${geocodeData.status} - ${geocodeData.error_message || 'Unknown error'}`);
    }

    if (!geocodeData.results || geocodeData.results.length === 0) {
      throw new Error(`Could not geocode location: ${location}`);
    }

    const centerLocation = geocodeData.results[0].geometry.location;
    const centerAddress = geocodeData.results[0].formatted_address;

    const placesParams = new URLSearchParams({
      query: searchQuery,
      location: `${centerLocation.lat},${centerLocation.lng}`,
      radius: Math.min(radius, 50000).toString(),
      key: apiKey,
    });

    const placesUrl = `${GOOGLE_MAPS_API_BASE}/place/textsearch/json?${placesParams.toString()}`;
    const placesResponse = await fetch(placesUrl);
    const placesData = await placesResponse.json();

    if (placesData.status !== 'OK' && placesData.status !== 'ZERO_RESULTS') {
      throw new Error(`Places API error: ${placesData.status} - ${placesData.error_message || 'Unknown error'}`);
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

    const places = (placesData.results || [])
      .map((place: unknown) => {
        const p = place as {
          name: string;
          formatted_address: string;
          geometry: { location: { lat: number; lng: number } };
          rating?: number;
          user_ratings_total?: number;
          types?: string[];
        };
        return {
          name: p.name,
          address: p.formatted_address,
          location: {
            lat: p.geometry.location.lat,
            lng: p.geometry.location.lng,
          },
          rating: p.rating,
          userRatingsTotal: p.user_ratings_total,
          description: p.types?.join(', '),
          types: p.types,
          distanceFromCenter: calculateDistance(
            centerLocation.lat,
            centerLocation.lng,
            p.geometry.location.lat,
            p.geometry.location.lng,
          ),
        };
      })
      .sort((a, b) => (a.distanceFromCenter || 0) - (b.distanceFromCenter || 0))
      .slice(0, maxResults);

    return {
      places,
      searchCenter: {
        address: centerAddress,
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
    const apiKey = getApiKey();

    let actualPlaceId = placeId;

    if (!actualPlaceId && placeName) {
      const searchQuery = location ? `${placeName} ${location}` : placeName;
      const findParams = new URLSearchParams({
        input: searchQuery,
        inputtype: 'textquery',
        fields: 'place_id',
        key: apiKey,
      });

      const findUrl = `${GOOGLE_MAPS_API_BASE}/place/findplacefromtext/json?${findParams.toString()}`;
      const findResponse = await fetch(findUrl);
      const findData = await findResponse.json();

      if (findData.status !== 'OK' || !findData.candidates?.[0]?.place_id) {
        throw new Error(`Could not find place: ${placeName}`);
      }

      actualPlaceId = findData.candidates[0].place_id;
    }

    if (!actualPlaceId) {
      throw new Error('Either placeId or placeName must be provided');
    }

    const detailsParams = new URLSearchParams({
      place_id: actualPlaceId,
      fields:
        'name,formatted_address,geometry,rating,user_ratings_total,type,formatted_phone_number,website,opening_hours,review',
      key: apiKey,
    });

    const detailsUrl = `${GOOGLE_MAPS_API_BASE}/place/details/json?${detailsParams.toString()}`;
    const detailsResponse = await fetch(detailsUrl);
    const detailsData = await detailsResponse.json();

    if (detailsData.status !== 'OK') {
      throw new Error(
        `Place Details API error: ${detailsData.status} - ${detailsData.error_message || 'Unknown error'}`,
      );
    }

    const place = detailsData.result;

    return {
      name: place.name,
      address: place.formatted_address,
      location: {
        lat: place.geometry.location.lat,
        lng: place.geometry.location.lng,
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
      reviews: place.reviews?.slice(0, 5).map((review: unknown) => {
        const r = review as {
          author_name: string;
          rating: number;
          text: string;
          time: number;
        };
        return {
          authorName: r.author_name,
          rating: r.rating,
          text: r.text,
          time: r.time,
        };
      }),
    };
  },
});

export const commuteTools = {
  getTravelTime,
  searchPlacesAlongRoute,
  searchPlacesByDistance,
  getPlaceDetails,
};
