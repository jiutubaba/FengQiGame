import { expect, it } from "vitest";
import {
  formatLeaderboardScore,
  formatNumber,
} from "../../../src/utils/format.js";

it("排行榜数值沿用地图 math.format 的单位门槛并固定保留两位小数", () => {
  for (const [value, expected] of [
    [0, "0.00"],
    [12.345, "12.35"],
    [123.456789, "123.46"],
    [123.001, "123.00"],
    [9999999, "9999999.00"],
    [1e7, "1000.00万"],
    [1e9 - 1, "100000.00万"],
    [1e9, "10.00亿"],
    [1e13 - 1, "100000.00亿"],
    [1e13, "10.00兆"],
    [123456789012345, "123.46兆"],
    [23456789012345, "23.46兆"],
    [Number.MAX_SAFE_INTEGER, "9007.20兆"],
    [-1234567890, "-12.35亿"],
    ["1234567890.000000", "12.35亿"],
    [NaN, "0.00"],
    [Infinity, "—"],
  ]) {
    expect(formatLeaderboardScore(value), String(value)).toBe(expected);
  }
  expect(formatNumber(12345678)).toBe("12,345,678");
});
