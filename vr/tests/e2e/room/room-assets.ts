/**
 * Where the page asks for the furnished room's photographs and models. Nothing serves this path but
 * the tests: `fixtures.ts` answers it from `tests/e2e/room/assets/` on disk, so the site never has them.
 */
export const ROOM_ASSETS_PATH = '/__xr-room/';
