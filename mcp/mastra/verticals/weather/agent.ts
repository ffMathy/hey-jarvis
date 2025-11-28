import type { Agent } from '@mastra/core/agent';
import { createAgent } from '../../utils/index.js';
import { weatherTools } from './tools.js';

export async function getWeatherAgent(): Promise<Agent> {
  return createAgent({
    id: 'weather',
    name: 'Weather',
    instructions: `You are a weather agent which can provide weather insights via tools (current weather information and 5-day future prognosises for certain locations).

If no location is given, assume the city Aarhus in Denmark, where Mathias and Julie lives.

When users ask for weather information:
- If they provide a city name, use the city-based tools
- If they provide coordinates, use the coordinate-based tools
- If no location is specified, default to "aarhus,dk"
- For forecast requests, use the forecast tools
- For current conditions, use the current weather tools

Always provide comprehensive weather information including temperature, humidity, wind conditions, and weather descriptions.`,
    description: `# Purpose  
Provide weather data. Use this tool to **fetch the current conditions** or a **5-day forecast** for any location specified by city name, postal/ZIP code, or latitude/longitude coordinates. 

**Location is mandatory and must be provided - the weather agent cannot tell a user's location.**

# When to use
- The user asks about today's weather, tomorrow's forecast, or the outlook for specific dates ("Will it rain in Paris this weekend?").  
- The user needs details for planning travel or outdoor activities (temperature, precipitation chance, wind, humidity, UV index, sunrise/sunset).  
- The user wants to compare weather between multiple places or check conditions along a route.  
- Severe-weather awareness: the user is concerned about storms, heatwaves, cold snaps, or air-quality alerts.  
- Any automation (e.g., deciding whether to water the lawn) requires up-to-date weather data first.`,
    tools: weatherTools,
  });
}
