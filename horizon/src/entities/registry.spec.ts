import { describe, expect, it } from 'bun:test';
import {
  cleanEntityReports,
  createEntityStore,
  drawerEntries,
  EMPTY_REGISTRY,
  ENTITY_REGISTRY_KEY,
  type EntityRegistry,
  entityLabel,
  forgetAnchor,
  hasAnchor,
  knownEntity,
  MAX_ENTITIES_PER_MARK,
  MAX_ENTITY_ID_LENGTH,
  MAX_ENTITY_NAME_LENGTH,
  MAX_KNOWN_ENTITIES,
  parseEntityRegistry,
  placedEntities,
  placeEntity,
  placementStateOf,
  pruneEntities,
  recordEntities,
  rememberAnchor,
  serialiseEntityRegistry,
  unplaceEntity,
  unusedAnchors,
  usedAnchors,
  WRITE_DELAY_MILLISECONDS,
} from './registry';

const ANCHOR = '6f0a4c1e-2d3b-4a5c-9e8f-0123456789ab';
const OTHER_ANCHOR = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';

function withKitchen(now = 1000): EntityRegistry {
  return recordEntities(EMPTY_REGISTRY, [{ id: 'light.kitchen_ceiling', name: 'Kitchen ceiling light' }], now);
}

describe('cleanEntityReports', () => {
  it('trims ids and names, and leaves out whatever is not an entity', () => {
    expect(
      cleanEntityReports([
        { id: '  inbox:work  ', name: '  Work inbox ' },
        { id: '', name: 'Nothing' },
        { id: '   ' },
        { id: 42 },
        { name: 'No id' },
        'calendar:home',
        null,
        [{ id: 'nested' }],
        { id: 'calendar:home', name: '   ' },
      ]),
    ).toEqual([{ id: 'inbox:work', name: 'Work inbox' }, { id: 'calendar:home' }]);
  });

  it('never cuts an id, since a cut id is another id, but cuts a name that is only shown', () => {
    const longName = 'n'.repeat(MAX_ENTITY_NAME_LENGTH + 30);
    expect(
      cleanEntityReports([
        { id: 'x'.repeat(MAX_ENTITY_ID_LENGTH + 1) },
        { id: 'y'.repeat(MAX_ENTITY_ID_LENGTH), name: longName },
      ]),
    ).toEqual([{ id: 'y'.repeat(MAX_ENTITY_ID_LENGTH), name: 'n'.repeat(MAX_ENTITY_NAME_LENGTH) }]);
  });

  it('keeps one report per id, with the last name given, and a later nameless report keeps it', () => {
    expect(
      cleanEntityReports([
        { id: 'light.desk', name: 'Desk' },
        { id: 'light.desk', name: 'Desk lamp' },
        { id: 'light.desk' },
      ]),
    ).toEqual([{ id: 'light.desk', name: 'Desk lamp' }]);
  });

  it(`takes at most ${MAX_ENTITIES_PER_MARK} entities from one mark`, () => {
    const many = Array.from({ length: MAX_ENTITIES_PER_MARK + 10 }, (_, index) => ({ id: `thing.${index}` }));
    const cleaned = cleanEntityReports(many);
    expect(cleaned).toHaveLength(MAX_ENTITIES_PER_MARK);
    expect(cleaned.at(-1)?.id).toBe(`thing.${MAX_ENTITIES_PER_MARK - 1}`);
  });
});

describe('entityLabel', () => {
  it('shows the name, or the id when there is none', () => {
    expect(entityLabel({ id: 'inbox:work', name: 'Work inbox' })).toBe('Work inbox');
    expect(entityLabel({ id: 'inbox:work' })).toBe('inbox:work');
  });
});

describe('recordEntities', () => {
  it('adds a new entity with one mark', () => {
    expect(withKitchen(1000).entities['light.kitchen_ceiling']).toEqual({
      id: 'light.kitchen_ceiling',
      name: 'Kitchen ceiling light',
      firstMarkedAt: 1000,
      lastMarkedAt: 1000,
      marks: 1,
    });
  });

  it('counts a known entity again, keeping when it was first marked, and takes a newer name', () => {
    const again = recordEntities(withKitchen(1000), [{ id: 'light.kitchen_ceiling', name: 'Kitchen' }], 5000);
    expect(again.entities['light.kitchen_ceiling']).toEqual({
      id: 'light.kitchen_ceiling',
      name: 'Kitchen',
      firstMarkedAt: 1000,
      lastMarkedAt: 5000,
      marks: 2,
    });
  });

  it('keeps the name it has when a mark gives none', () => {
    const again = recordEntities(withKitchen(), [{ id: 'light.kitchen_ceiling' }], 2000);
    expect(again.entities['light.kitchen_ceiling']?.name).toBe('Kitchen ceiling light');
  });

  it('keeps a placement through later marks', () => {
    const placed = placeEntity(withKitchen(), 'light.kitchen_ceiling', ANCHOR, [0.1, 0.2, 0.3], 1500);
    const again = recordEntities(placed, [{ id: 'light.kitchen_ceiling' }], 2000);
    expect(again.entities['light.kitchen_ceiling']?.placement).toEqual({
      anchor: ANCHOR,
      offset: [0.1, 0.2, 0.3],
      placedAt: 1500,
    });
  });

  it('returns the same registry when the mark names nothing worth keeping', () => {
    const registry = withKitchen();
    expect(recordEntities(registry, [{ id: '' }, 'junk'], 2000)).toBe(registry);
    expect(recordEntities(registry, [], 2000)).toBe(registry);
  });

  it(`forgets the least recently marked beyond ${MAX_KNOWN_ENTITIES}`, () => {
    let registry = EMPTY_REGISTRY;
    for (let index = 0; index < MAX_KNOWN_ENTITIES + 5; index++) {
      registry = recordEntities(registry, [{ id: `thing.${index}` }], index);
    }
    expect(Object.keys(registry.entities)).toHaveLength(MAX_KNOWN_ENTITIES);
    expect(registry.entities['thing.0']).toBeUndefined();
    expect(registry.entities['thing.4']).toBeUndefined();
    expect(registry.entities['thing.5']).toBeDefined();
  });
});

describe('pruneEntities', () => {
  it('never forgets a placed entity, lost ones included', () => {
    let registry = recordEntities(EMPTY_REGISTRY, [{ id: 'old.placed' }, { id: 'old.lost' }], 0);
    registry = placeEntity(registry, 'old.placed', ANCHOR, [0, 0, 0], 1);
    registry = placeEntity(registry, 'old.lost', OTHER_ANCHOR, [0, 0, 0], 1);
    registry = forgetAnchor(registry, OTHER_ANCHOR);
    registry = recordEntities(registry, [{ id: 'new.one' }, { id: 'new.two' }], 10);
    const pruned = pruneEntities(registry, 2);
    expect(Object.keys(pruned.entities).sort()).toEqual(['old.lost', 'old.placed']);
  });

  it('returns the same registry when nothing is over the limit', () => {
    const registry = withKitchen();
    expect(pruneEntities(registry, 5)).toBe(registry);
  });
});

describe('placing', () => {
  it('places a known entity on an anchor, and remembers the anchor', () => {
    const placed = placeEntity(withKitchen(), 'light.kitchen_ceiling', ANCHOR, [0.5, -0.2, 1.25], 3000);
    expect(placed.entities['light.kitchen_ceiling']?.placement).toEqual({
      anchor: ANCHOR,
      offset: [0.5, -0.2, 1.25],
      placedAt: 3000,
    });
    expect(placed.anchors[ANCHOR]).toEqual({ createdAt: 3000 });
    expect(placementStateOf(placed, 'light.kitchen_ceiling')).toBe('placed');
    expect(placedEntities(placed).map((entity) => entity.id)).toEqual(['light.kitchen_ceiling']);
  });

  it('keeps when an anchor it already had was created', () => {
    const registry = rememberAnchor(withKitchen(), ANCHOR, 100);
    const placed = placeEntity(registry, 'light.kitchen_ceiling', ANCHOR, [0, 0, 0], 3000);
    expect(placed.anchors[ANCHOR]).toEqual({ createdAt: 100 });
  });

  it('refuses an entity never marked, an offset that is not a point, and an anchor that is no handle', () => {
    const registry = withKitchen();
    expect(placeEntity(registry, 'light.unknown', ANCHOR, [0, 0, 0], 1)).toBe(registry);
    expect(placeEntity(registry, 'light.kitchen_ceiling', ANCHOR, [0, Number.NaN, 0], 1)).toBe(registry);
    expect(placeEntity(registry, 'light.kitchen_ceiling', ANCHOR, [0, 1e6, 0], 1)).toBe(registry);
    expect(placeEntity(registry, 'light.kitchen_ceiling', '  ', [0, 0, 0], 1)).toBe(registry);
  });

  it('moves a placed entity to a new anchor and offset', () => {
    const first = placeEntity(withKitchen(), 'light.kitchen_ceiling', ANCHOR, [0, 0, 0], 1);
    const moved = placeEntity(first, 'light.kitchen_ceiling', OTHER_ANCHOR, [1, 2, 3], 2);
    expect(moved.entities['light.kitchen_ceiling']?.placement).toEqual({
      anchor: OTHER_ANCHOR,
      offset: [1, 2, 3],
      placedAt: 2,
    });
    expect(unusedAnchors(moved)).toEqual([ANCHOR]);
    expect(usedAnchors(moved)).toEqual([OTHER_ANCHOR]);
  });

  it('unplaces back into the drawer, and leaves an unplaced one as it was', () => {
    const placed = placeEntity(withKitchen(), 'light.kitchen_ceiling', ANCHOR, [0, 0, 0], 1);
    const unplaced = unplaceEntity(placed, 'light.kitchen_ceiling');
    expect(unplaced.entities['light.kitchen_ceiling']?.placement).toBeUndefined();
    expect(placementStateOf(unplaced, 'light.kitchen_ceiling')).toBe('unplaced');
    expect(unplaceEntity(unplaced, 'light.kitchen_ceiling')).toBe(unplaced);
    expect(unplaceEntity(unplaced, 'light.unknown')).toBe(unplaced);
  });

  it('reads a placement on a forgotten anchor as lost, until it is placed again', () => {
    const placed = placeEntity(withKitchen(), 'light.kitchen_ceiling', ANCHOR, [0, 0, 0], 1);
    const lost = forgetAnchor(placed, ANCHOR);
    expect(lost.anchors).toEqual({});
    expect(placementStateOf(lost, 'light.kitchen_ceiling')).toBe('lost');
    expect(placedEntities(lost)).toEqual([]);
    expect(forgetAnchor(lost, ANCHOR)).toBe(lost);
    const again = placeEntity(lost, 'light.kitchen_ceiling', OTHER_ANCHOR, [0, 0, 0], 2);
    expect(placementStateOf(again, 'light.kitchen_ceiling')).toBe('placed');
  });

  it('has no placement state for an entity never marked', () => {
    expect(placementStateOf(EMPTY_REGISTRY, 'light.unknown')).toBeUndefined();
  });
});

describe('drawerEntries', () => {
  it('puts what needs placing first, then what is placed, each most recently marked first', () => {
    let registry = recordEntities(EMPTY_REGISTRY, [{ id: 'light.old', name: 'Old lamp' }], 1);
    registry = recordEntities(registry, [{ id: 'inbox:work', name: 'Work inbox' }], 2);
    registry = recordEntities(registry, [{ id: 'light.placed', name: 'Placed lamp' }], 3);
    registry = recordEntities(registry, [{ id: 'calendar:home' }], 4);
    registry = recordEntities(registry, [{ id: 'light.lost', name: 'Lost lamp' }], 5);
    registry = placeEntity(registry, 'light.placed', ANCHOR, [0, 0, 0], 6);
    registry = placeEntity(registry, 'light.lost', OTHER_ANCHOR, [0, 0, 0], 6);
    registry = forgetAnchor(registry, OTHER_ANCHOR);
    expect(drawerEntries(registry)).toEqual([
      { id: 'light.lost', label: 'Lost lamp', state: 'lost' },
      { id: 'calendar:home', label: 'calendar:home', state: 'unplaced' },
      { id: 'inbox:work', label: 'Work inbox', state: 'unplaced' },
      { id: 'light.old', label: 'Old lamp', state: 'unplaced' },
      { id: 'light.placed', label: 'Placed lamp', state: 'placed' },
    ]);
  });
});

describe('parseEntityRegistry', () => {
  it('reads nothing, junk, and another version as empty', () => {
    expect(parseEntityRegistry(null)).toBe(EMPTY_REGISTRY);
    expect(parseEntityRegistry('{not json')).toBe(EMPTY_REGISTRY);
    expect(parseEntityRegistry('[]')).toBe(EMPTY_REGISTRY);
    expect(parseEntityRegistry(JSON.stringify({ version: 2, entities: {}, anchors: {} }))).toBe(EMPTY_REGISTRY);
    expect(parseEntityRegistry(JSON.stringify({ version: 1, entities: [], anchors: {} }))).toBe(EMPTY_REGISTRY);
  });

  it('round-trips what it wrote', () => {
    let registry = recordEntities(EMPTY_REGISTRY, [{ id: 'light.a', name: 'A' }, { id: 'inbox:b' }], 10);
    registry = placeEntity(registry, 'light.a', ANCHOR, [0.25, 1.5, -0.75], 20);
    expect(parseEntityRegistry(serialiseEntityRegistry(registry))).toEqual(registry);
  });

  it('leaves out each entry that does not read, and keeps the rest', () => {
    const stored = {
      version: 1,
      anchors: {
        [ANCHOR]: { createdAt: 5 },
        'bad-anchor': { createdAt: 'yesterday' },
        '': { createdAt: 1 },
      },
      entities: {
        'light.good': { id: 'light.good', name: 'Good', firstMarkedAt: 1, lastMarkedAt: 2, marks: 3 },
        'light.mismatch': { id: 'light.other', firstMarkedAt: 1, lastMarkedAt: 2, marks: 1 },
        'light.no-marks': { id: 'light.no-marks', firstMarkedAt: 1, lastMarkedAt: 2, marks: 0 },
        'light.bad-time': { id: 'light.bad-time', firstMarkedAt: -1, lastMarkedAt: 2, marks: 1 },
        'light.bad-placement': {
          id: 'light.bad-placement',
          firstMarkedAt: 1,
          lastMarkedAt: 2,
          marks: 1,
          placement: { anchor: ANCHOR, offset: [0, 'up', 0], placedAt: 3 },
        },
        'light.placed': {
          id: 'light.placed',
          name: 42,
          firstMarkedAt: 1,
          lastMarkedAt: 2,
          marks: 1,
          placement: { anchor: ANCHOR, offset: [1, 2, 3], placedAt: 3 },
        },
        'light.junk': 'not an entity',
      },
    };
    const parsed = parseEntityRegistry(JSON.stringify(stored));
    expect(parsed.anchors).toEqual({ [ANCHOR]: { createdAt: 5 } });
    expect(parsed.entities).toEqual({
      'light.good': { id: 'light.good', name: 'Good', firstMarkedAt: 1, lastMarkedAt: 2, marks: 3 },
      // A placement that does not read is dropped with the entity kept, back in the drawer.
      'light.bad-placement': { id: 'light.bad-placement', firstMarkedAt: 1, lastMarkedAt: 2, marks: 1 },
      'light.placed': {
        id: 'light.placed',
        firstMarkedAt: 1,
        lastMarkedAt: 2,
        marks: 1,
        placement: { anchor: ANCHOR, offset: [1, 2, 3], placedAt: 3 },
      },
    });
  });
});

describe('ids that are also the names of what every object has', () => {
  // Model output may name anything; these are the keys a plain object would answer for itself.
  const RESERVED = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];

  it('records each as an entity of its own, named only as it was named', () => {
    const registry = recordEntities(
      EMPTY_REGISTRY,
      RESERVED.map((id) => ({ id })),
      5,
    );
    expect(Object.keys(registry.entities).sort()).toEqual([...RESERVED].sort());
    for (const id of RESERVED) {
      expect(knownEntity(registry, id)).toEqual({ id, firstMarkedAt: 5, lastMarkedAt: 5, marks: 1 });
    }
    expect(drawerEntries(registry).map((entry) => entry.label)).toEqual([...RESERVED].sort());
    // Nothing leaks into the registry's own shape.
    expect(Object.getPrototypeOf(registry.entities)).toBe(Object.prototype);
    expect(Object.hasOwn(registry, 'marks')).toBe(false);
  });

  it('counts a second mark of one on the first', () => {
    const once = recordEntities(EMPTY_REGISTRY, [{ id: '__proto__', name: 'Odd' }], 5);
    const twice = recordEntities(once, [{ id: '__proto__' }], 6);
    expect(knownEntity(twice, '__proto__')).toEqual({
      id: '__proto__',
      name: 'Odd',
      firstMarkedAt: 5,
      lastMarkedAt: 6,
      marks: 2,
    });
  });

  it('knows none of them before they are marked', () => {
    const registry = withKitchen();
    for (const id of RESERVED) {
      expect(knownEntity(registry, id)).toBeUndefined();
      expect(placementStateOf(registry, id)).toBeUndefined();
      expect(placeEntity(registry, id, ANCHOR, [0, 0, 0], 1)).toBe(registry);
      expect(unplaceEntity(registry, id)).toBe(registry);
    }
  });

  it('places, moves and unplaces one, and forgets an anchor by such a handle', () => {
    const marked = recordEntities(EMPTY_REGISTRY, [{ id: 'constructor' }], 5);
    const placed = placeEntity(marked, 'constructor', '__proto__', [1, 2, 3], 6);
    expect(placementStateOf(placed, 'constructor')).toBe('placed');
    expect(hasAnchor(placed, '__proto__')).toBe(true);
    expect(hasAnchor(placed, 'toString')).toBe(false);
    expect(usedAnchors(placed)).toEqual(['__proto__']);
    expect(placementStateOf(forgetAnchor(placed, '__proto__'), 'constructor')).toBe('lost');
    expect(forgetAnchor(placed, 'toString')).toBe(placed);
    expect(placementStateOf(unplaceEntity(placed, 'constructor'), 'constructor')).toBe('unplaced');
  });

  it('writes them out and reads them back', () => {
    const marked = recordEntities(EMPTY_REGISTRY, [{ id: '__proto__', name: 'Odd' }, { id: 'constructor' }], 5);
    const registry = placeEntity(marked, '__proto__', ANCHOR, [1, 2, 3], 6);
    const text = serialiseEntityRegistry(registry);
    expect(JSON.parse(text).entities).toHaveProperty(['__proto__', 'name'], 'Odd');
    const again = parseEntityRegistry(text);
    expect(serialiseEntityRegistry(again)).toBe(text);
    expect(knownEntity(again, '__proto__')?.placement?.anchor).toBe(ANCHOR);
    expect(knownEntity(again, 'constructor')?.name).toBeUndefined();
  });

  it('reads a stored handle or id of __proto__ as an entry, not as the prototype', () => {
    const stored =
      '{"version":1,"anchors":{"__proto__":{"createdAt":1}},' +
      '"entities":{"__proto__":{"id":"__proto__","firstMarkedAt":1,"lastMarkedAt":2,"marks":1}}}';
    const registry = parseEntityRegistry(stored);
    expect(Object.keys(registry.anchors)).toEqual(['__proto__']);
    expect(Object.keys(registry.entities)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(registry.entities)).toBe(Object.prototype);
    expect(knownEntity(registry, '__proto__')?.marks).toBe(1);
  });
});

/** A storage over a map that counts its writes, and can be told to throw. */
function memoryStorage(initial?: string) {
  const items = new Map<string, string>();
  if (initial !== undefined) items.set(ENTITY_REGISTRY_KEY, initial);
  let writes = 0;
  let refuse = false;
  return {
    items,
    get writes() {
      return writes;
    },
    refuse(on: boolean) {
      refuse = on;
    },
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (refuse) throw new Error('QuotaExceededError');
      writes += 1;
      items.set(key, value);
    },
  };
}

/** A scheduler the test runs by hand. */
function manualSchedule() {
  const waiting: { callback: () => void; milliseconds: number; cancelled: boolean }[] = [];
  return {
    waiting,
    schedule: (callback: () => void, milliseconds: number) => {
      const entry = { callback, milliseconds, cancelled: false };
      waiting.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    runAll() {
      for (const entry of waiting.splice(0)) if (!entry.cancelled) entry.callback();
    },
  };
}

describe('createEntityStore', () => {
  it('starts from what is stored', () => {
    const stored = serialiseEntityRegistry(withKitchen());
    const store = createEntityStore(memoryStorage(stored), manualSchedule().schedule);
    expect(store.registry).toEqual(withKitchen());
  });

  it('starts empty when the storage throws on reading', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
    };
    expect(createEntityStore(throwing, manualSchedule().schedule).registry).toBe(EMPTY_REGISTRY);
  });

  it('writes a burst of changes once, a moment after the first', () => {
    const storage = memoryStorage();
    const timer = manualSchedule();
    const store = createEntityStore(storage, timer.schedule);
    store.update((registry) => recordEntities(registry, [{ id: 'light.a' }], 1));
    store.update((registry) => recordEntities(registry, [{ id: 'light.b' }], 2));
    expect(timer.waiting).toHaveLength(1);
    expect(timer.waiting[0]?.milliseconds).toBe(WRITE_DELAY_MILLISECONDS);
    expect(storage.writes).toBe(0);
    timer.runAll();
    expect(storage.writes).toBe(1);
    expect(parseEntityRegistry(storage.items.get(ENTITY_REGISTRY_KEY) ?? null)).toEqual(store.registry);
  });

  it('writes nothing for a change that changes nothing', () => {
    const storage = memoryStorage();
    const timer = manualSchedule();
    const store = createEntityStore(storage, timer.schedule);
    store.update((registry) => unplaceEntity(registry, 'light.unknown'));
    expect(timer.waiting).toHaveLength(0);
    store.flush();
    expect(storage.writes).toBe(0);
  });

  it('writes at once on flush, and not again when the timer fires', () => {
    const storage = memoryStorage();
    const timer = manualSchedule();
    const store = createEntityStore(storage, timer.schedule);
    store.update((registry) => recordEntities(registry, [{ id: 'light.a' }], 1));
    store.flush();
    expect(storage.writes).toBe(1);
    timer.runAll();
    expect(storage.writes).toBe(1);
  });

  it('says why a write failed, keeps the registry for the session, and clears the problem on success', () => {
    const storage = memoryStorage();
    const timer = manualSchedule();
    const store = createEntityStore(storage, timer.schedule);
    storage.refuse(true);
    store.update((registry) => recordEntities(registry, [{ id: 'light.a' }], 1));
    store.flush();
    expect(store.writeProblem).toContain('would not keep the placements');
    expect(store.registry.entities['light.a']).toBeDefined();
    storage.refuse(false);
    store.update((registry) => recordEntities(registry, [{ id: 'light.b' }], 2));
    store.flush();
    expect(store.writeProblem).toBeUndefined();
    expect(storage.writes).toBe(1);
  });
});
