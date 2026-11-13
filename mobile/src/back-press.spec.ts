import { describe, expect, it, mock } from 'bun:test';
import { backOnTheConversation } from './back-press';

describe('backOnTheConversation', () => {
  it('hangs up when opened from the launcher with no glance, and still lets the app go', () => {
    const hangUp = mock(() => {});
    const onBack = backOnTheConversation({ inSheet: false, onBackToGlance: undefined, hangUp });

    expect(onBack?.()).toBe(false);
    expect(hangUp).toHaveBeenCalledTimes(1);
  });

  it('goes back to the glance when there is one, without hanging up itself', () => {
    const hangUp = mock(() => {});
    const onBackToGlance = mock(() => {});
    const onBack = backOnTheConversation({ inSheet: false, onBackToGlance, hangUp });

    expect(onBack?.()).toBe(true);
    expect(onBackToGlance).toHaveBeenCalledTimes(1);
    expect(hangUp).not.toHaveBeenCalled();
  });

  it('leaves back to the sheet when summoned into one', () => {
    const hangUp = mock(() => {});
    expect(backOnTheConversation({ inSheet: true, onBackToGlance: () => {}, hangUp })).toBeUndefined();
    expect(backOnTheConversation({ inSheet: true, onBackToGlance: undefined, hangUp })).toBeUndefined();
  });
});
