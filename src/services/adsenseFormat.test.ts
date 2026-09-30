import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeAdsenseAccount,
  parseIsoDateParts,
  shapeAdsenseReport,
} from "./adsenseFormat.js";

describe("normalizeAdsenseAccount", () => {
  it("accepts pub, ca-pub, and resource names", () => {
    assert.equal(normalizeAdsenseAccount("pub-1"), "accounts/pub-1");
    assert.equal(normalizeAdsenseAccount("ca-pub-42"), "accounts/pub-42");
    assert.equal(normalizeAdsenseAccount("accounts/pub-7"), "accounts/pub-7");
  });

  it("rejects empty and non-publisher ids", () => {
    assert.throws(() => normalizeAdsenseAccount("  "), /required/);
    assert.throws(() => normalizeAdsenseAccount("accounts/not-a-pub"), /Invalid/);
  });
});

describe("parseIsoDateParts", () => {
  it("parses a real calendar day", () => {
    assert.deepEqual(parseIsoDateParts("2026-09-29"), {
      year: 2026,
      month: 9,
      day: 29,
    });
  });

  it("rejects impossible dates", () => {
    assert.throws(() => parseIsoDateParts("2026-02-31"), /Invalid date/);
    assert.throws(() => parseIsoDateParts("09-29-2026"), /YYYY-MM-DD/);
  });
});

describe("shapeAdsenseReport", () => {
  it("keys cells by header name and formats dates", () => {
    const shaped = shapeAdsenseReport({
      startDate: { year: 2026, month: 9, day: 1 },
      endDate: { year: 2026, month: 9, day: 29 },
      totalMatchedRows: "1",
      headers: [
        { name: "DATE", type: "DIMENSION" },
        { name: "ESTIMATED_EARNINGS", type: "METRIC_CURRENCY", currencyCode: "CAD" },
      ],
      rows: [{ cells: [{ value: "2026-09-01" }, { value: "1.25" }] }],
      totals: { cells: [{ value: "" }, { value: "1.25" }] },
    });
    assert.equal(shaped.startDate, "2026-09-01");
    assert.equal(shaped.rows[0]?.DATE, "2026-09-01");
    assert.equal(shaped.rows[0]?.ESTIMATED_EARNINGS, "1.25");
    assert.equal(shaped.totals?.ESTIMATED_EARNINGS, "1.25");
    assert.equal(shaped.headers[1]?.currencyCode, "CAD");
  });
});
