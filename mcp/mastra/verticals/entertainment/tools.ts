import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';

// IMDb API types
interface IMDbSearchResult {
  id: string;
  title: string;
  year: number;
  type: 'movie' | 'series';
  poster?: string;
}

interface IMDbSearchResponse {
  results: IMDbSearchResult[];
  total: number;
}

interface IMDbTitleDetails {
  id: string;
  title: string;
  year: number;
  type: 'movie' | 'series';
  rating?: number;
  votes?: number;
  plot?: string;
  genres?: string[];
  runtime?: number;
  poster?: string;
}

// Spotify client management
let spotifyClient: SpotifyApi | null = null;

function getSpotifyClient(): SpotifyApi {
  if (spotifyClient) {
    return spotifyClient;
  }

  const clientId = process.env.HEY_JARVIS_SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.HEY_JARVIS_SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Spotify credentials not found. Please set HEY_JARVIS_SPOTIFY_CLIENT_ID and HEY_JARVIS_SPOTIFY_CLIENT_SECRET environment variables.',
    );
  }

  spotifyClient = SpotifyApi.withClientCredentials(clientId, clientSecret);
  return spotifyClient;
}

// IMDb Search Tool
export const searchIMDb = createTool({
  id: 'searchIMDb',
  description: 'Search for movies or TV series on IMDb by title query',
  inputSchema: z.object({
    query: z.string().describe('The search query (movie or series title to search for)'),
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
        year: z.number(),
        type: z.enum(['movie', 'series']),
        poster: z.string().optional(),
      }),
    ),
    total: z.number(),
    query: z.string(),
  }),
  execute: async (inputData) => {
    const limit = Math.min(inputData.limit || 10, 50);
    let url = `https://imdbapi.dev/api/search?query=${encodeURIComponent(inputData.query)}&limit=${limit}`;

    if (inputData.type) {
      url += `&type=${inputData.type}`;
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`IMDb API request failed: ${response.statusText}`);
    }

    const data = (await response.json()) as IMDbSearchResponse;

    return {
      results: data.results.map((item) => ({
        id: item.id,
        title: item.title,
        year: item.year,
        type: item.type,
        poster: item.poster,
      })),
      total: data.total,
      query: inputData.query,
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
    year: z.number(),
    type: z.enum(['movie', 'series']),
    rating: z.number().optional(),
    votes: z.number().optional(),
    plot: z.string().optional(),
    genres: z.array(z.string()).optional(),
    runtime: z.number().optional(),
    poster: z.string().optional(),
  }),
  execute: async (inputData) => {
    const url = `https://imdbapi.dev/api/title/${inputData.titleId}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`IMDb API request failed: ${response.statusText}`);
    }

    const data = (await response.json()) as IMDbTitleDetails;

    return {
      id: data.id,
      title: data.title,
      year: data.year,
      type: data.type,
      rating: data.rating,
      votes: data.votes,
      plot: data.plot,
      genres: data.genres,
      runtime: data.runtime,
      poster: data.poster,
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
    const client = getSpotifyClient();
    const limit = Math.min(inputData.limit || 10, 50);

    const searchResults = await client.search(inputData.query, ['track'], undefined, limit);

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
    const client = getSpotifyClient();

    const track = await client.tracks.get(inputData.trackId);

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
  },
});

// Export all entertainment tools
export const entertainmentTools = {
  searchIMDb,
  getIMDbTitleDetails,
  searchSpotifyTracks,
  getSpotifyTrackDetails,
};
