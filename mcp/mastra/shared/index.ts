
import { shoppingListAgent } from '../verticals/shopping/index.js';
import { weatherAgent } from '../verticals/weather/index.js';

export const publicAgents = {
    weather: weatherAgent,
    shopping: shoppingListAgent
};