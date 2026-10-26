---
paths:
  - "mcp/**"
---

# Commute Agent

> Part of [Jarvis Mastra AI Agents → Current Agents](mcp-current-agents.md). Paths in it are relative to `mcp/` unless they say otherwise.

Provides intelligent commute planning and navigation assistance using Google Maps:
- **4 Google Maps tools**: Travel time estimation, route-based place search, proximity-based place search, detailed place information
- **Google Gemini model**: Uses `gemini-flash-latest` for natural language processing
- **Traffic-aware routing**: Estimates travel time with real-time traffic data for driving mode
- **Multi-modal support**: Handles driving, walking, bicycling, and transit modes
- **Smart defaults**: Automatically assumes Aarhus, Denmark when no location is specified
- **Never asks questions**: Makes best-guess assumptions for seamless interaction

**Key Capabilities:**
- **Travel Time Estimation** (`getTravelTime` tool):
  - Calculate distance and duration between two locations
  - Optional real-time traffic data for driving routes
  - Support for departure time specification for future travel planning
  - Handles multiple travel modes (driving, walking, bicycling, transit)
  - Returns both normal duration and traffic-adjusted duration
  
- **Route-Based Place Search** (`searchPlacesAlongRoute` tool):
  - Find places along a route between origin and destination
  - Useful for finding EV chargers, gas stations, rest stops, restaurants
  - Searches at multiple points along the route (0%, 25%, 50%, 75%)
  - Returns distance from route in meters for each place
  - Results ordered by distance from route (closest first)
  - Returns name, address, GPS coordinates, ratings, place types, and distance from route
  
- **Proximity-Based Place Search** (`searchPlacesByDistance` tool):
  - Find places near a location, ordered by distance (closest first)
  - Configurable search radius up to 50km
  - Returns distance from center point in meters
  - Perfect for "what's nearby" queries
  
- **Detailed Place Information** (`getPlaceDetails` tool):
  - Get comprehensive information about specific places
  - Includes ratings, reviews (top 5), opening hours, contact information
  - Can search by Google Place ID or by name and location
  - Returns phone numbers, websites, and current open/closed status

**Example Use Cases:**
- "How long will it take to drive from Aarhus to Copenhagen with traffic?"
- "Find EV charging stations along my route to Copenhagen"
- "What restaurants are near me?" (defaults to Aarhus)
- "Show me the opening hours and reviews for [place name]"
- "Find the closest gas stations within 10km"

**Required Environment Variable:**
- `HEY_JARVIS_GOOGLE_MAPS_API_KEY` - Google Maps API key. Distinct from the Gemini key: this one is restricted to the Maps APIs and returns API_KEY_INVALID against Generative Language.

**Setup Instructions:**
Google Maps APIs require an API key rather than OAuth2 credentials. If you already have a Google Cloud project for Calendar/Tasks, you can reuse the same project and the same API key for both Gemini AI and Maps:

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select your existing project (same one used for Calendar/Tasks OAuth2)
3. Enable the required APIs:
   - Distance Matrix API
   - Directions API
   - Places API (New)
   - Geocoding API
4. Go to **Credentials** → **Create Credentials** → **API Key** (or reuse existing)
5. Store the API key in 1Password: `op://Jarvis/Google/Hey Jarvis API key`
6. Set environment variable: `HEY_JARVIS_GOOGLE_MAPS_API_KEY`

**Note:**
Maps APIs are public services (no user data access) that use API keys for billing and quota management, while Calendar/Tasks APIs access private user data and require OAuth2 authentication. Both can be enabled in the same Google Cloud project.
