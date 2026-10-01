import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import type { AffectedEntity } from '../../utils/affected-entities.js';
import { answerLookup } from '../../utils/direct-lookup-factory.js';
import { getPublicAgents } from '..';
import { getCalendarEvents } from '../calendar/tools.js';
import { listRepositoryIssues } from '../coding/tools.js';
import { findEmails } from '../email/tools.js';
import { BILKA_BASKET, getCurrentCartContents } from '../shopping/tools.js';
import { getAllTasks } from '../todo-list/tools.js';
import { getUserCurrentLocation } from '../weather/shortcuts.js';
import { getCurrentWeatherByCity, getForecastByCity } from '../weather/tools.js';
import { DIRECT_LOOKUPS, findDirectLookup } from './direct-lookups.js';

describe('DIRECT_LOOKUPS', () => {
  it('names every lookup once', () => {
    const ids = DIRECT_LOOKUPS.map((lookup) => lookup.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only answers for agents routing can send a request to', async () => {
    const routable = new Set((await getPublicAgents()).map((agent) => agent.id));

    for (const lookup of DIRECT_LOOKUPS) {
      expect(routable.has(lookup.agentId)).toBe(true);
    }
  });

  it('finds a lookup by its id', () => {
    expect(findDirectLookup('calendar.today')?.agentId).toBe('calendar');
    expect(findDirectLookup('calendar.yesterday')).toBeUndefined();
  });
});

/**
 * What each lookup reports as touched, which is what the agent's call of the same tool would have
 * reported: a request answered without the agent has to light up the same thing on sir's headset as
 * one the agent answers. Each lookup's tool is answered here as its service would answer, and the
 * tool's own reader then says what was touched.
 */
describe('what a lookup reports as touched', () => {
  const spies: { mockRestore: () => void }[] = [];

  afterEach(() => {
    for (const spy of spies.splice(0)) {
      spy.mockRestore();
    }
  });

  const FAMILY_CALENDAR = { id: 'family@group.calendar.google.com', name: 'Family' };
  const DEFAULT_TASK_LIST = { id: 'MTIzNDU2Nzg5', name: 'My Tasks' };

  function calendarAnswering() {
    spies.push(spyOn(getCalendarEvents, 'execute').mockResolvedValue({ events: [], calendars: [FAMILY_CALENDAR] }));
  }

  /** Nobody located, so the weather is looked up for the home city. */
  function weatherAnsweringForTheHomeCity() {
    spies.push(
      spyOn(getUserCurrentLocation, 'execute').mockResolvedValue({
        users: [],
        zones: [],
        timestamp: '2026-10-01T10:00:00Z',
      }),
    );
    spies.push(
      spyOn(getCurrentWeatherByCity, 'execute').mockResolvedValue({
        location: 'Aarhus',
        coordinates: { lat: 56.16, lon: 10.2 },
        temperature: 12,
        feelsLike: 10,
        tempMin: 11,
        tempMax: 13,
        humidity: 80,
        pressure: 1012,
        windSpeed: 5,
        windDirection: 270,
        cloudiness: 75,
        condition: 'Clouds',
        description: 'broken clouds',
      }),
    );
    spies.push(
      spyOn(getForecastByCity, 'execute').mockResolvedValue({
        location: 'Aarhus',
        coordinates: { lat: 56.16, lon: 10.2 },
        forecast: [],
      }),
    );
  }

  /**
   * Every lookup: how its tools answer, and what it must report. Keyed by lookup id, so a lookup
   * added without saying what it reports fails the first test below.
   */
  const CASES: Record<string, { toolsAnswer: () => void; touched: AffectedEntity[] }> = {
    // `allCalendars` reports the calendars the events came from, as the agent's call would.
    'calendar.today': { toolsAnswer: calendarAnswering, touched: [FAMILY_CALENDAR] },
    'calendar.tomorrow': { toolsAnswer: calendarAnswering, touched: [FAMILY_CALENDAR] },
    'calendar.week': { toolsAnswer: calendarAnswering, touched: [FAMILY_CALENDAR] },
    'email.unread': {
      toolsAnswer: () => spies.push(spyOn(findEmails, 'execute').mockResolvedValue({ emails: [], totalCount: 0 })),
      touched: [{ id: 'inbox', name: 'Inbox' }],
    },
    // By the list's real id, not the `@default` alias it was asked for by.
    'todoList.open': {
      toolsAnswer: () =>
        spies.push(spyOn(getAllTasks, 'execute').mockResolvedValue({ tasks: [], taskList: DEFAULT_TASK_LIST })),
      touched: [DEFAULT_TASK_LIST],
    },
    'shoppingList.contents': {
      toolsAnswer: () => spies.push(spyOn(getCurrentCartContents, 'execute').mockResolvedValue([])),
      touched: [BILKA_BASKET],
    },
    'coding.openIssues': {
      toolsAnswer: () =>
        spies.push(spyOn(listRepositoryIssues, 'execute').mockResolvedValue({ issues: [], total_count: 0 })),
      touched: [{ id: 'ffmathy/hey-jarvis', name: 'hey-jarvis' }],
    },
    // A forecast is from the outside world, and locating the user is a survey of the house.
    'weather.now': { toolsAnswer: weatherAnsweringForTheHomeCity, touched: [] },
    'weather.forecast': { toolsAnswer: weatherAnsweringForTheHomeCity, touched: [] },
  };

  function answer(id: string) {
    const lookup = findDirectLookup(id);
    if (!lookup) {
      throw new Error(`There is no lookup "${id}"`);
    }
    return answerLookup(lookup);
  }

  it('says what every lookup reports', () => {
    expect(Object.keys(CASES).sort()).toEqual(DIRECT_LOOKUPS.map((lookup) => lookup.id).sort());
  });

  for (const [id, { toolsAnswer, touched }] of Object.entries(CASES)) {
    const what = touched.length > 0 ? touched.map((entity) => entity.id).join(', ') : 'nothing';

    it(`${id} reports ${what}`, async () => {
      toolsAnswer();

      const outcome = await answer(id);

      expect(outcome?.text.length).toBeGreaterThan(0);
      expect(outcome?.entities).toEqual(touched);
    });
  }

  it('reports nothing when its tool fails, and throws so the agent can take over', async () => {
    spies.push(spyOn(getAllTasks, 'execute').mockRejectedValue(new Error('Google Tasks is down')));

    await expect(answer('todoList.open')).rejects.toThrow('Google Tasks is down');
  });
});
