import { describe, it, expect } from "vitest";
import { deepEqual } from "../backends/manager.js";

describe("deepEqual", () => {
  it("returns true for identical primitives", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("foo", "foo")).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
  });

  it("returns false for different primitives", () => {
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual("foo", "bar")).toBe(false);
  });

  it("returns true for identical objects with same key order", () => {
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  it("returns true for identical objects with different key order", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("returns false for objects with different values", () => {
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
  });

  it("returns false for objects with different keys", () => {
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
  });

  it("handles nested objects with different key order", () => {
    expect(deepEqual({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } })).toBe(true);
  });

  it("handles arrays (order matters for arrays)", () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2, 3], [3, 2, 1])).toBe(false);
  });

  it("handles null", () => {
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual({ a: null }, { a: null })).toBe(true);
  });

  it("handles undefined", () => {
    expect(deepEqual(undefined, undefined)).toBe(true);
    expect(deepEqual(undefined, null)).toBe(false);
  });

  it("handles mixed nested structures", () => {
    const obj1 = { a: [1, { b: 2 }], c: { d: [3, 4] } };
    const obj2 = { c: { d: [3, 4] }, a: [1, { b: 2 }] };
    expect(deepEqual(obj1, obj2)).toBe(true);
  });
});