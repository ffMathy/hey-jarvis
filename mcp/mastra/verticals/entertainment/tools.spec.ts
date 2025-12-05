// @ts-expect-error - bun:test types are built into Bun runtime
import { describe, expect, it } from 'bun:test';
import { entertainmentTools } from './tools';

// Type guard to check if result is a validation error
function isValidationError(result: unknown): result is { error: true; message: string } {
  return (
    result !== null && typeof result === 'object' && 'error' in result && (result as { error: boolean }).error === true
  );
}

describe('Entertainment Tools Integration Tests', () => {
  describe('IMDb Tools', () => {
    describe('searchIMDb', () => {
      it('should fetch popular titles', async () => {
        const result = await entertainmentTools.searchIMDb.execute({
          limit: 5,
        });

        if (isValidationError(result)) {
          throw new Error(`Validation failed: ${result.message}`);
        }

        expect(result).toBeDefined();
        expect(Array.isArray(result.results)).toBe(true);
        expect(typeof result.total).toBe('number');

        if (result.results.length > 0) {
          const firstResult = result.results[0];
          expect(typeof firstResult.id).toBe('string');
          expect(typeof firstResult.title).toBe('string');
          expect(['movie', 'series']).toContain(firstResult.type);

          console.log('✅ IMDb search completed successfully');
          console.log(`   Total results: ${result.total}`);
          console.log(`   First result: ${firstResult.title} (${firstResult.year})`);
        }
      }, 30000);

      it('should filter by movie type when specified', async () => {
        const result = await entertainmentTools.searchIMDb.execute({
          type: 'movie',
          limit: 5,
        });

        if (isValidationError(result)) {
          throw new Error(`Validation failed: ${result.message}`);
        }

        expect(result).toBeDefined();

        // All results should be movies when type filter is applied
        for (const item of result.results) {
          expect(item.type).toBe('movie');
        }

        console.log('✅ IMDb search with movie filter completed');
        console.log(`   Found ${result.results.length} movies`);
      }, 30000);

      it('should filter by series type when specified', async () => {
        const result = await entertainmentTools.searchIMDb.execute({
          type: 'series',
          limit: 5,
        });

        if (isValidationError(result)) {
          throw new Error(`Validation failed: ${result.message}`);
        }

        expect(result).toBeDefined();

        // All results should be series when type filter is applied
        for (const item of result.results) {
          expect(item.type).toBe('series');
        }

        console.log('✅ IMDb search with series filter completed');
        console.log(`   Found ${result.results.length} series`);
      }, 30000);
    });

    describe('getIMDbTitleDetails', () => {
      it('should fetch details for a valid title ID', async () => {
        // The Shawshank Redemption - a well-known movie
        const result = await entertainmentTools.getIMDbTitleDetails.execute({
          titleId: 'tt0111161',
        });

        if (isValidationError(result)) {
          throw new Error(`Validation failed: ${result.message}`);
        }

        expect(result).toBeDefined();
        expect(result.id).toBe('tt0111161');
        expect(typeof result.title).toBe('string');
        expect(['movie', 'series']).toContain(result.type);

        console.log('✅ IMDb title details fetched successfully');
        console.log(`   Title: ${result.title} (${result.year})`);
        console.log(`   Type: ${result.type}`);
        if (result.rating) {
          console.log(`   Rating: ${result.rating}`);
        }
        if (result.genres) {
          console.log(`   Genres: ${result.genres.join(', ')}`);
        }
      }, 30000);

      it('should handle invalid title ID gracefully', async () => {
        await expect(async () => {
          const result = await entertainmentTools.getIMDbTitleDetails.execute({
            titleId: 'tt0000000000invalid',
          });
          if (isValidationError(result)) {
            throw new Error(result.message);
          }
        }).toThrow();
      }, 30000);
    });
  });

  describe('Spotify Tools', () => {
    // Note: Spotify tests require valid credentials in environment variables
    const hasSpotifyCredentials =
      process.env.HEY_JARVIS_SPOTIFY_CLIENT_ID && process.env.HEY_JARVIS_SPOTIFY_CLIENT_SECRET;

    describe('searchSpotifyTracks', () => {
      it('should search for tracks by query', async () => {
        if (!hasSpotifyCredentials) {
          console.log('⏭️ Skipping Spotify test: credentials not configured');
          return;
        }

        const result = await entertainmentTools.searchSpotifyTracks.execute({
          query: 'Bohemian Rhapsody',
          limit: 5,
        });

        if (isValidationError(result)) {
          throw new Error(`Validation failed: ${result.message}`);
        }

        expect(result).toBeDefined();
        expect(result.query).toBe('Bohemian Rhapsody');
        expect(Array.isArray(result.tracks)).toBe(true);
        expect(typeof result.total).toBe('number');

        if (result.tracks.length > 0) {
          const firstTrack = result.tracks[0];
          expect(typeof firstTrack.id).toBe('string');
          expect(typeof firstTrack.name).toBe('string');
          expect(Array.isArray(firstTrack.artists)).toBe(true);
          expect(typeof firstTrack.album).toBe('string');
          expect(typeof firstTrack.durationMs).toBe('number');
          expect(typeof firstTrack.externalUrl).toBe('string');
          expect(typeof firstTrack.popularity).toBe('number');

          console.log('✅ Spotify search completed successfully');
          console.log(`   Query: "${result.query}"`);
          console.log(`   Total results: ${result.total}`);
          console.log(`   First result: ${firstTrack.name} by ${firstTrack.artists.join(', ')}`);
        }
      }, 30000);

      it('should throw error when credentials are missing', async () => {
        if (hasSpotifyCredentials) {
          console.log('⏭️ Skipping missing credentials test: credentials are configured');
          return;
        }

        await expect(async () => {
          await entertainmentTools.searchSpotifyTracks.execute({
            query: 'test',
            limit: 1,
          });
        }).toThrow('Spotify credentials not found');
      }, 30000);
    });

    describe('getSpotifyTrackDetails', () => {
      it('should fetch details for a valid track ID', async () => {
        if (!hasSpotifyCredentials) {
          console.log('⏭️ Skipping Spotify test: credentials not configured');
          return;
        }

        // Bohemian Rhapsody by Queen - a well-known track
        const result = await entertainmentTools.getSpotifyTrackDetails.execute({
          trackId: '7tFiyTwD0nx5a1eklYtX2J',
        });

        if (isValidationError(result)) {
          throw new Error(`Validation failed: ${result.message}`);
        }

        expect(result).toBeDefined();
        expect(result.id).toBe('7tFiyTwD0nx5a1eklYtX2J');
        expect(typeof result.name).toBe('string');
        expect(Array.isArray(result.artists)).toBe(true);
        expect(typeof result.album).toBe('string');
        expect(typeof result.durationMs).toBe('number');
        expect(typeof result.externalUrl).toBe('string');
        expect(typeof result.popularity).toBe('number');
        expect(typeof result.isExplicit).toBe('boolean');
        expect(typeof result.discNumber).toBe('number');
        expect(typeof result.trackNumber).toBe('number');

        console.log('✅ Spotify track details fetched successfully');
        console.log(`   Track: ${result.name}`);
        console.log(`   Artists: ${result.artists.join(', ')}`);
        console.log(`   Album: ${result.album}`);
        console.log(`   Duration: ${Math.round(result.durationMs / 1000)}s`);
      }, 30000);

      it('should handle invalid track ID gracefully', async () => {
        if (!hasSpotifyCredentials) {
          console.log('⏭️ Skipping Spotify test: credentials not configured');
          return;
        }

        await expect(async () => {
          const result = await entertainmentTools.getSpotifyTrackDetails.execute({
            trackId: 'invalidtrackid123456',
          });
          if (isValidationError(result)) {
            throw new Error(result.message);
          }
        }).toThrow();
      }, 30000);
    });
  });
});
