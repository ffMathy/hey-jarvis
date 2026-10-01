import { describe, expect, it } from 'bun:test';
import { summariseForecastByDay } from './lookups.js';

function entry(datetime: string, temperature: number, windSpeed: number, description: string) {
  return { datetime, temperature, windSpeed, description };
}

describe('summariseForecastByDay', () => {
  it('reports each household day once, with its range, wind and usual conditions', () => {
    const days = summariseForecastByDay([
      entry('2026-10-01 09:00:00', 10, 3, 'light rain'),
      entry('2026-10-01 12:00:00', 14, 6, 'light rain'),
      entry('2026-10-01 15:00:00', 13, 4, 'overcast clouds'),
      // 22:00 UTC is midnight in Copenhagen, so this entry belongs to the next day.
      entry('2026-10-01 22:00:00', 8, 2, 'clear sky'),
    ]);

    expect(days).toEqual([
      { day: '2026-10-01', lowestTemperature: 10, highestTemperature: 14, strongestWind: 6, mostly: 'light rain' },
      { day: '2026-10-02', lowestTemperature: 8, highestTemperature: 8, strongestWind: 2, mostly: 'clear sky' },
    ]);
  });

  it('reports only as many days as asked', () => {
    const forecast = ['01', '02', '03', '04'].map((day) => entry(`2026-10-${day} 12:00:00`, 10, 1, 'clear sky'));

    expect(summariseForecastByDay(forecast, 2).map((day) => day.day)).toEqual(['2026-10-01', '2026-10-02']);
  });
});
