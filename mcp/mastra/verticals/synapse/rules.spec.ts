import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadRules, matchRules, parseRule, patternMatches, resolveRulesDirectory } from './rules';
import type { StateChange } from './state-change';

const whatsAppFromMom: StateChange = {
  source: 'phone',
  stateType: 'notification_posted',
  stateData: { app: 'com.whatsapp', title: 'Mom', text: 'Dinner at 6/7?' },
};

const frontDoorOpened: StateChange = {
  source: 'internet-of-things',
  stateType: 'device_state_change',
  stateData: {
    entityId: 'binary_sensor.front_door_contact',
    newState: 'on',
    observedStates: ['on', 'off', 'on'],
    changeCount: 3,
  },
};

describe('parseRule', () => {
  it('reads the patterns, description and instructions', () => {
    const rule = parseRule(
      'family-messages',
      [
        '---',
        'description: Messages from family',
        'patterns:',
        '  - phone/notification_posted',
        '  - event: internet-of-things/*',
        '    data:',
        '      entityId: binary_sensor.front_door*',
        '---',
        '',
        'Always tell me straight away.',
        '',
      ].join('\n'),
    );

    expect(rule).toEqual({
      name: 'family-messages',
      description: 'Messages from family',
      patterns: [
        'phone/notification_posted',
        { event: 'internet-of-things/*', data: { entityId: 'binary_sensor.front_door*' } },
      ],
      instructions: 'Always tell me straight away.',
    });
  });

  it('rejects a file without frontmatter', () => {
    expect(() => parseRule('bare', 'Just instructions.')).toThrow(
      'bare: a rule must start with a --- frontmatter block',
    );
  });

  it('rejects a rule that applies to nothing', () => {
    expect(() => parseRule('empty', '---\npatterns: []\n---\nDo things.')).toThrow('a rule needs at least one pattern');
    expect(() => parseRule('missing', '---\ndescription: No patterns\n---\nDo things.')).toThrow('patterns');
  });

  it('rejects a rule with nothing to say', () => {
    expect(() => parseRule('silent', '---\npatterns:\n  - weather/*\n---\n\n')).toThrow('needs instructions');
  });
});

describe('patternMatches', () => {
  it('matches a glob against the source and state type', () => {
    expect(patternMatches('phone/notification_posted', whatsAppFromMom)).toBe(true);
    expect(patternMatches('phone/*', whatsAppFromMom)).toBe(true);
    expect(patternMatches('{weather,phone}/*', whatsAppFromMom)).toBe(true);
    expect(patternMatches('weather/*', whatsAppFromMom)).toBe(false);
  });

  it('also requires every data glob to match', () => {
    expect(patternMatches({ event: 'phone/*', data: { app: 'com.whatsapp', title: 'mom' } }, whatsAppFromMom)).toBe(
      true,
    );
    expect(patternMatches({ event: 'phone/*', data: { app: 'com.whatsapp', title: 'dad' } }, whatsAppFromMom)).toBe(
      false,
    );
  });

  it('lets a star cross slashes, since values are text rather than paths', () => {
    expect(patternMatches({ event: 'phone/*', data: { text: '*6/7*' } }, whatsAppFromMom)).toBe(true);
  });

  it('ignores case', () => {
    expect(patternMatches({ event: 'PHONE/*', data: { title: 'MOM' } }, whatsAppFromMom)).toBe(true);
  });

  it('matches an array field when any element does, and numbers as text', () => {
    expect(
      patternMatches(
        { event: 'internet-of-things/*', data: { observedStates: 'off', changeCount: 3 } },
        frontDoorOpened,
      ),
    ).toBe(true);
  });

  it('never matches a field the state change does not have', () => {
    expect(patternMatches({ event: 'phone/*', data: { sender: '*' } }, whatsAppFromMom)).toBe(false);
  });

  it('reads nested fields by dotted path', () => {
    const buttonPressed: StateChange = {
      source: 'internet-of-things',
      stateType: 'home_assistant_event',
      stateData: { eventType: 'zha_event', data: { command: 'double' } },
    };

    expect(patternMatches({ event: '*/home_assistant_event', data: { 'data.command': 'double' } }, buttonPressed)).toBe(
      true,
    );
  });
});

describe('matchRules', () => {
  it('returns the rules any of whose patterns match, without their patterns', () => {
    const rules = [
      parseRule('doors', '---\npatterns:\n  - weather/*\n  - internet-of-things/device_state_change\n---\nDoors.'),
      parseRule('messages', '---\ndescription: Chat\npatterns:\n  - phone/*\n---\nMessages.'),
    ];

    expect(matchRules(rules, whatsAppFromMom)).toEqual([
      { name: 'messages', description: 'Chat', instructions: 'Messages.' },
    ]);
    expect(matchRules(rules, frontDoorOpened).map((rule) => rule.name)).toEqual(['doors']);
  });
});

describe('loadRules', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'synapse-rules-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('loads every Markdown file in name order, and leaves out the ones that do not parse', () => {
    writeFileSync(path.join(directory, 'b-messages.md'), '---\npatterns:\n  - phone/*\n---\nMessages.');
    writeFileSync(path.join(directory, 'a-weather.md'), '---\npatterns:\n  - weather/*\n---\nWeather.');
    writeFileSync(path.join(directory, 'broken.md'), 'No frontmatter.');
    writeFileSync(path.join(directory, '.gitkeep'), '');

    expect(loadRules(directory).map((rule) => rule.name)).toEqual(['a-weather', 'b-messages']);
  });

  it('has no rules when there is no directory', () => {
    expect(loadRules(undefined)).toEqual([]);
  });
});

describe('the rules in the repository', () => {
  const directory = resolveRulesDirectory();

  it('can be found', () => {
    expect(directory).toBeDefined();
  });

  // loadRules only logs a rule that does not parse, so a broken one would silently apply to
  // nothing. Parsing each here is what stops one from being merged.
  it('all parse', () => {
    const files = readdirSync(directory ?? '').filter((file) => file.endsWith('.md'));

    for (const file of files) {
      expect(() => parseRule(file, readFileSync(path.join(directory ?? '', file), 'utf8'))).not.toThrow();
    }
  });
});
