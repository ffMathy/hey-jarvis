import { beforeAll, describe, expect, it } from 'bun:test';
import { commuteTools } from './tools';

// Type guard to check if result is a validation error
function isValidationError(result: unknown): result is { error: true; message: string } {
  return (
    typeof result === 'object' && result !== null && 'error' in result && (result as { error: boolean }).error === true
  );
}

describe('Commute Tools Integration Tests', () => {
  beforeAll(() => {
    // Verify API key is configured
    if (!process.env.HEY_JARVIS_GOOGLE_API_KEY) {
      throw new Error('HEY_JARVIS_GOOGLE_API_KEY environment variable is required for commute tools tests');
    }
  });

  describe('getTravelTime', () => {
    it('should fetch travel time between two cities', async () => {
      const result = await commuteTools.getTravelTime.execute({
        origin: 'Aarhus, Denmark',
        destination: 'Copenhagen, Denmark',
        mode: 'driving',
        includeTraffic: true,
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(result.distance).toBeDefined();
      expect(typeof result.distance.text).toBe('string');
      expect(typeof result.distance.value).toBe('number');
      expect(result.duration).toBeDefined();
      expect(typeof result.duration.text).toBe('string');
      expect(typeof result.duration.value).toBe('number');
      expect(typeof result.startAddress).toBe('string');
      expect(typeof result.endAddress).toBe('string');
      expect(result.mode).toBe('driving');

      // Validate reasonable ranges (Aarhus to Copenhagen is ~190km)
      expect(result.distance.value).toBeGreaterThan(150000); // > 150km
      expect(result.distance.value).toBeLessThan(250000); // < 250km
      expect(result.duration.value).toBeGreaterThan(5400); // > 1.5 hours
      expect(result.duration.value).toBeLessThan(14400); // < 4 hours

      console.log('✅ Travel time fetched successfully');
      console.log('   - Route:', result.startAddress, '→', result.endAddress);
      console.log('   - Distance:', result.distance.text);
      console.log('   - Duration:', result.duration.text);
      if (result.durationInTraffic) {
        console.log('   - Duration in traffic:', result.durationInTraffic.text);
      }
    }, 30000);

    it('should handle coordinates as input', async () => {
      // Coordinates for Aarhus and Copenhagen
      const result = await commuteTools.getTravelTime.execute({
        origin: '56.1629,10.2039',
        destination: '55.6761,12.5683',
        mode: 'driving',
        includeTraffic: false,
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      expect(result).toBeDefined();
      expect(result.distance.value).toBeGreaterThan(150000);
      console.log('✅ Travel time with coordinates fetched successfully');
    }, 30000);

    it('should support different travel modes', async () => {
      const result = await commuteTools.getTravelTime.execute({
        origin: 'Aarhus, Denmark',
        destination: 'Aarhus C, Denmark',
        mode: 'walking',
        includeTraffic: false,
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      expect(result).toBeDefined();
      expect(result.mode).toBe('walking');
      console.log('✅ Walking mode travel time fetched successfully');
    }, 30000);
  });

  describe('searchPlacesAlongRoute', () => {
    it('should find EV charging stations along a route', async () => {
      const result = await commuteTools.searchPlacesAlongRoute.execute({
        origin: 'Aarhus, Denmark',
        destination: 'Copenhagen, Denmark',
        searchQuery: 'EV charging station',
        maxResults: 5,
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(result.places).toBeDefined();
      expect(Array.isArray(result.places)).toBe(true);
      expect(result.routeInfo).toBeDefined();
      expect(typeof result.routeInfo.origin).toBe('string');
      expect(typeof result.routeInfo.destination).toBe('string');

      // Check if we found any places
      expect(result.places.length).toBeGreaterThan(0);
      expect(result.places.length).toBeLessThanOrEqual(5);

      // Validate first place structure
      const firstPlace = result.places[0];
      expect(typeof firstPlace.name).toBe('string');
      expect(typeof firstPlace.address).toBe('string');
      expect(firstPlace.location).toBeDefined();
      expect(typeof firstPlace.location.lat).toBe('number');
      expect(typeof firstPlace.location.lng).toBe('number');
      expect(typeof firstPlace.distanceFromRoute).toBe('number');

      // Verify places are ordered by distance from route (closest first)
      for (let i = 0; i < result.places.length - 1; i++) {
        const currentDistance = result.places[i].distanceFromRoute;
        const nextDistance = result.places[i + 1].distanceFromRoute;
        if (currentDistance !== undefined && nextDistance !== undefined) {
          expect(currentDistance).toBeLessThanOrEqual(nextDistance);
        }
      }

      console.log('✅ Places along route fetched successfully');
      console.log('   - Found:', result.places.length, 'charging stations');
      console.log('   - First result:', firstPlace.name);
      console.log('   - Address:', firstPlace.address);
      if (firstPlace.rating) {
        console.log('   - Rating:', firstPlace.rating, '⭐');
      }
      if (firstPlace.distanceFromRoute !== undefined) {
        console.log('   - Distance from route:', (firstPlace.distanceFromRoute / 1000).toFixed(2), 'km');
      }
    }, 45000); // Longer timeout as this makes multiple API calls

    it('should find restaurants along a route', async () => {
      const result = await commuteTools.searchPlacesAlongRoute.execute({
        origin: 'Aarhus, Denmark',
        destination: 'Odense, Denmark',
        searchQuery: 'restaurant',
        maxResults: 3,
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      expect(result).toBeDefined();
      expect(result.places.length).toBeGreaterThan(0);
      expect(result.places.length).toBeLessThanOrEqual(3);

      console.log('✅ Restaurants along route fetched successfully');
      console.log('   - Found:', result.places.length, 'restaurants');
    }, 45000);
  });

  describe('searchPlacesByDistance', () => {
    it('should find nearby gas stations ordered by distance', async () => {
      const result = await commuteTools.searchPlacesByDistance.execute({
        location: 'Aarhus, Denmark',
        searchQuery: 'gas station',
        radius: 5000,
        maxResults: 5,
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(result.places).toBeDefined();
      expect(Array.isArray(result.places)).toBe(true);
      expect(result.searchCenter).toBeDefined();
      expect(typeof result.searchCenter.address).toBe('string');
      expect(result.searchCenter.location).toBeDefined();

      // Check if we found any places
      expect(result.places.length).toBeGreaterThan(0);
      expect(result.places.length).toBeLessThanOrEqual(5);

      // Validate first place structure
      const firstPlace = result.places[0];
      expect(typeof firstPlace.name).toBe('string');
      expect(typeof firstPlace.address).toBe('string');
      expect(firstPlace.location).toBeDefined();
      expect(typeof firstPlace.distanceFromCenter).toBe('number');

      // Verify places are ordered by distance (closest first)
      for (let i = 0; i < result.places.length - 1; i++) {
        const currentDistance = result.places[i].distanceFromCenter;
        const nextDistance = result.places[i + 1].distanceFromCenter;
        if (currentDistance !== undefined && nextDistance !== undefined) {
          expect(currentDistance).toBeLessThanOrEqual(nextDistance);
        }
      }

      console.log('✅ Nearby places by distance fetched successfully');
      console.log('   - Search center:', result.searchCenter.address);
      console.log('   - Found:', result.places.length, 'gas stations');
      console.log('   - Closest:', firstPlace.name);
      if (firstPlace.distanceFromCenter !== undefined) {
        console.log('   - Distance:', (firstPlace.distanceFromCenter / 1000).toFixed(2), 'km');
      }
    }, 30000);

    it('should find coffee shops with larger radius', async () => {
      const result = await commuteTools.searchPlacesByDistance.execute({
        location: 'Aarhus C, Denmark',
        searchQuery: 'coffee shop',
        radius: 2000,
        maxResults: 10,
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      expect(result).toBeDefined();
      expect(result.places.length).toBeGreaterThan(0);
      expect(result.places.length).toBeLessThanOrEqual(10);

      console.log('✅ Coffee shops fetched successfully');
      console.log('   - Found:', result.places.length, 'coffee shops');
    }, 30000);
  });

  describe('getPlaceDetails', () => {
    it('should fetch details for a specific place by name', async () => {
      const result = await commuteTools.getPlaceDetails.execute({
        placeName: 'Aros Aarhus Kunstmuseum',
        location: 'Aarhus, Denmark',
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(typeof result.name).toBe('string');
      expect(typeof result.address).toBe('string');
      expect(result.location).toBeDefined();
      expect(typeof result.location.lat).toBe('number');
      expect(typeof result.location.lng).toBe('number');

      console.log('✅ Place details fetched successfully');
      console.log('   - Name:', result.name);
      console.log('   - Address:', result.address);
      if (result.rating) {
        console.log('   - Rating:', result.rating, '⭐');
        console.log('   - Reviews:', result.userRatingsTotal);
      }
      if (result.phoneNumber) {
        console.log('   - Phone:', result.phoneNumber);
      }
      if (result.website) {
        console.log('   - Website:', result.website);
      }
      if (result.openingHours) {
        console.log('   - Open now:', result.openingHours.openNow);
      }
    }, 30000);

    it('should include reviews when available', async () => {
      const result = await commuteTools.getPlaceDetails.execute({
        placeName: 'Aarhus Domkirke',
        location: 'Aarhus, Denmark',
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      expect(result).toBeDefined();
      expect(typeof result.name).toBe('string');

      if (result.reviews && result.reviews.length > 0) {
        const firstReview = result.reviews[0];
        expect(typeof firstReview.authorName).toBe('string');
        expect(typeof firstReview.rating).toBe('number');
        expect(typeof firstReview.text).toBe('string');
        console.log('✅ Place with reviews fetched successfully');
        console.log('   - Total reviews:', result.reviews.length);
      }
    }, 30000);
  });
});
