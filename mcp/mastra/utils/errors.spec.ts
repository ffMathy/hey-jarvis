import { describe, expect, it } from 'bun:test';
import { extractErrorMessage } from './errors.js';

const FAILURE_MESSAGE = 'the fridge is on fire';

/**
 * Every shape an error slot has been observed to hold. The API layer and the email reply
 * handler both read errors that Mastra has already serialised, which is why a plain
 * object and a bare string matter as much as a real `Error`.
 */
describe('extractErrorMessage', () => {
  it('reads an Error instance', () => {
    expect(extractErrorMessage(new Error(FAILURE_MESSAGE))).toBe(FAILURE_MESSAGE);
  });

  it('reads the plain object Mastra serialises an error into', () => {
    expect(extractErrorMessage({ message: FAILURE_MESSAGE, name: 'Error' })).toBe(FAILURE_MESSAGE);
  });

  it('reads a bare string', () => {
    expect(extractErrorMessage(FAILURE_MESSAGE)).toBe(FAILURE_MESSAGE);
  });

  it('reports nothing when there is no error at all', () => {
    expect(extractErrorMessage(undefined)).toBeUndefined();
    expect(extractErrorMessage(null)).toBeUndefined();
  });

  it('reports nothing for an object carrying no message', () => {
    expect(extractErrorMessage({ name: 'Error' })).toBeUndefined();
  });

  it('reports nothing for a message that is not a string', () => {
    // Reading `.message` straight off the object would hand a caller `[object Object]`.
    expect(extractErrorMessage({ message: { nested: 'detail' } })).toBeUndefined();
  });

  it('treats an empty message as no detail', () => {
    // A blank `error` field reads as "no reason given"; the caller's fallback says more.
    expect(extractErrorMessage('')).toBeUndefined();
    expect(extractErrorMessage({ message: '' })).toBeUndefined();
  });
});
