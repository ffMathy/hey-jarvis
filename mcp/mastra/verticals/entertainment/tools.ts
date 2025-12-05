import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';

// IMDb API response schemas for runtime validation
const imdbTitleSchema = z.object({
  id: z.string(),
  type: z.string(),
  primaryTitle: z.string(),
  originalTitle: z.string().optional(),
  primaryImage: z
    .object({
      url: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
    })
    .optional()
    .nullable(),
  startYear: z.number().optional(),
  endYear: z.number().optional(),
  runtimeSeconds: z.number().optional(),
  genres: z.array(z.string()).optional(),
  rating: z
    .object({
      aggregateRating: z.number(),
      voteCount: z.number(),
    })
    .optional()
    .nullable(),
  plot: z.string().optional(),
});

const imdbListResponseSchema = z.object({
  titles: z.array(imdbTitleSchema).optional(),
  totalCount: z.number().optional(),
  nextPageToken: z.string().optional(),
});

// Spotify client management with credential tracking
let spotifyClient: SpotifyApi | null = null;
let cachedClientId: string | null = null;
let cachedClientSecret: string | null = null;

function getSpotifyClient(): SpotifyApi {
  const clientId = process.env.HEY_JARVIS_SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.HEY_JARVIS_SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Spotify credentials not found. Please set HEY_JARVIS_SPOTIFY_CLIENT_ID and HEY_JARVIS_SPOTIFY_CLIENT_SECRET environment variables.',
    );
  }

  // Re-create client if credentials have changed
  if (spotifyClient && cachedClientId === clientId && cachedClientSecret === clientSecret) {
    return spotifyClient;
  }

  spotifyClient = SpotifyApi.withClientCredentials(clientId, clientSecret);
  cachedClientId = clientId;
  cachedClientSecret = clientSecret;
  return spotifyClient;
}

// Map IMDb type to a simplified type
function mapIMDbType(type: string): 'movie' | 'series' {
  if (type === 'movie' || type === 'tvMovie' || type === 'short' || type === 'video') {
    return 'movie';
  }
  return 'series';
}

// IMDb Search Tool
export const searchIMDb = createTool({
  id: 'searchIMDb',
  description: 'Search for movies or TV series on IMDb. Returns popular titles matching the search criteria.',
  inputSchema: z.object({
    type: z
      .enum(['movie', 'series'])
      .optional()
      .describe('Filter by type: movie or series. If not specified, returns both.'),
    limit: z.number().optional().default(10).describe('Maximum number of results to return (default: 10, max: 50)'),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        year: z.number().optional(),
        type: z.enum(['movie', 'series']),
        poster: z.string().optional(),
        rating: z.number().optional(),
        genres: z.array(z.string()).optional(),
        plot: z.string().optional(),
      }),
    ),
    total: z.number(),
  }),
  execute: async (inputData) => {
    const limit = Math.min(inputData.limit || 10, 50);
    let url = `https://api.imdbapi.dev/titles?pageSize=${limit}`;

    // Map type filter to IMDb API types
    if (inputData.type === 'movie') {
      url += '&types=MOVIE';
    } else if (inputData.type === 'series') {
      url += '&types=TV_SERIES&types=TV_MINI_SERIES';
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`IMDb API request failed: ${response.statusText}`);
    }

    const rawData = await response.json();
    const parseResult = imdbListResponseSchema.safeParse(rawData);

    if (!parseResult.success) {
      throw new Error(`IMDb API returned unexpected response format: ${parseResult.error.message}`);
    }

    const data = parseResult.data;
    const titles = data.titles || [];

    return {
      results: titles.map((item) => ({
        id: item.id,
        title: item.primaryTitle,
        year: item.startYear,
        type: mapIMDbType(item.type),
        poster: item.primaryImage?.url,
        rating: item.rating?.aggregateRating,
        genres: item.genres,
        plot: item.plot,
      })),
      total: data.totalCount || titles.length,
    };
  },
});

// IMDb Get Title Details Tool
export const getIMDbTitleDetails = createTool({
  id: 'getIMDbTitleDetails',
  description: 'Get detailed information about a specific movie or TV series from IMDb by its ID',
  inputSchema: z.object({
    titleId: z.string().describe('The IMDb title ID (e.g., tt0111161 for The Shawshank Redemption)'),
  }),
  outputSchema: z.object({
    id: z.string(),
    title: z.string(),
    year: z.number().optional(),
    type: z.enum(['movie', 'series']),
    rating: z.number().optional(),
    votes: z.number().optional(),
    plot: z.string().optional(),
    genres: z.array(z.string()).optional(),
    runtimeMinutes: z.number().optional(),
    poster: z.string().optional(),
  }),
  execute: async (inputData) => {
    const url = `https://api.imdbapi.dev/titles/${inputData.titleId}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`IMDb API request failed: ${response.statusText}`);
    }

    const rawData = await response.json();
    const parseResult = imdbTitleSchema.safeParse(rawData);

    if (!parseResult.success) {
      throw new Error(`IMDb API returned unexpected response format: ${parseResult.error.message}`);
    }

    const data = parseResult.data;

    return {
      id: data.id,
      title: data.primaryTitle,
      year: data.startYear,
      type: mapIMDbType(data.type),
      rating: data.rating?.aggregateRating,
      votes: data.rating?.voteCount,
      plot: data.plot,
      genres: data.genres,
      runtimeMinutes: data.runtimeSeconds ? Math.round(data.runtimeSeconds / 60) : undefined,
      poster: data.primaryImage?.url,
    };
  },
});

// Spotify Search Tracks Tool
export const searchSpotifyTracks = createTool({
  id: 'searchSpotifyTracks',
  description: 'Search for tracks on Spotify by query (song name, artist, album, etc.)',
  inputSchema: z.object({
    query: z.string().describe('The search query (e.g., song name, artist name, or combination)'),
    limit: z.number().optional().default(10).describe('Maximum number of results to return (default: 10, max: 50)'),
  }),
  outputSchema: z.object({
    tracks: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        artists: z.array(z.string()),
        album: z.string(),
        releaseDate: z.string().optional(),
        durationMs: z.number(),
        previewUrl: z.string().nullable().optional(),
        externalUrl: z.string(),
        popularity: z.number(),
      }),
    ),
    total: z.number(),
    query: z.string(),
  }),
  execute: async (inputData) => {
    try {
      const client = getSpotifyClient();
      const limit = Math.min(inputData.limit || 10, 50);

      const searchResults = await client.search(inputData.query, ['track'], undefined, limit);

      if (!searchResults.tracks) {
        throw new Error('No track results returned from Spotify.');
      }

      const tracks = searchResults.tracks.items.map((track) => ({
        id: track.id,
        name: track.name,
        artists: track.artists.map((artist) => artist.name),
        album: track.album.name,
        releaseDate: track.album.release_date,
        durationMs: track.duration_ms,
        previewUrl: track.preview_url,
        externalUrl: track.external_urls.spotify,
        popularity: track.popularity,
      }));

      return {
        tracks,
        total: searchResults.tracks.total,
        query: inputData.query,
      };
    } catch (error) {
      throw new Error(
        error && typeof error === 'object' && 'message' in error
          ? `Failed to search Spotify: ${(error as Error).message}`
          : 'Failed to search Spotify.',
      );
    }
  },
});

// Spotify Get Track Details Tool
export const getSpotifyTrackDetails = createTool({
  id: 'getSpotifyTrackDetails',
  description: 'Get detailed information about a specific track on Spotify by its ID',
  inputSchema: z.object({
    trackId: z.string().describe('The Spotify track ID'),
  }),
  outputSchema: z.object({
    id: z.string(),
    name: z.string(),
    artists: z.array(z.string()),
    album: z.string(),
    releaseDate: z.string().optional(),
    durationMs: z.number(),
    previewUrl: z.string().nullable().optional(),
    externalUrl: z.string(),
    popularity: z.number(),
    isExplicit: z.boolean(),
    discNumber: z.number(),
    trackNumber: z.number(),
  }),
  execute: async (inputData) => {
    try {
      const client = getSpotifyClient();
      const track = await client.tracks.get(inputData.trackId);

      if (!track) {
        throw new Error('Track not found on Spotify.');
      }

      return {
        id: track.id,
        name: track.name,
        artists: track.artists.map((artist) => artist.name),
        album: track.album.name,
        releaseDate: track.album.release_date,
        durationMs: track.duration_ms,
        previewUrl: track.preview_url,
        externalUrl: track.external_urls.spotify,
        popularity: track.popularity,
        isExplicit: track.explicit,
        discNumber: track.disc_number,
        trackNumber: track.track_number,
      };
    } catch (error) {
      throw new Error(
        error && typeof error === 'object' && 'message' in error
          ? `Failed to fetch track details from Spotify: ${(error as Error).message}`
          : 'Failed to fetch track details from Spotify.',
      );
    }
  },
});

// Export all entertainment tools
export const entertainmentTools = {
  searchIMDb,
  getIMDbTitleDetails,
  searchSpotifyTracks,
  getSpotifyTrackDetails,
};
