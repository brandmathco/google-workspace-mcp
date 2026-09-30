import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertCommerceProject,
  branchParent,
  catalogParent,
  projectNumberFromOAuthClientId,
  servingConfigName,
  shapeCommerceSearch,
} from "./commerceFormat.js";

describe("commerce resource names", () => {
  it("builds catalog, serving config, and branch paths", () => {
    assert.equal(
      catalogParent("retail-demo-42"),
      "projects/retail-demo-42/locations/global/catalogs/default_catalog",
    );
    assert.equal(
      servingConfigName("retail-demo-42"),
      "projects/retail-demo-42/locations/global/catalogs/default_catalog/servingConfigs/default_search",
    );
    assert.equal(
      branchParent("123456789012", "0"),
      "projects/123456789012/locations/global/catalogs/default_catalog/branches/0",
    );
  });

  it("rejects path injection and short project ids", () => {
    assert.throws(() => assertCommerceProject("../etc"), /Invalid Google Cloud project/);
    assert.throws(() => catalogParent("ok-project", "a/b"), /Invalid catalog/);
    assert.throws(() => servingConfigName("ok-project", "default search"), /Invalid serving/);
  });
});

describe("projectNumberFromOAuthClientId", () => {
  it("reads the project number already embedded in the OAuth client id", () => {
    assert.equal(
      projectNumberFromOAuthClientId("1234567890123-abc.apps.googleusercontent.com"),
      "1234567890123",
    );
    assert.equal(projectNumberFromOAuthClientId("not-a-client"), undefined);
  });
});

describe("shapeCommerceSearch", () => {
  it("keeps a short product summary", () => {
    const shaped = shapeCommerceSearch({
      totalSize: 1,
      correctedQuery: "tea",
      results: [
        {
          id: "sku-1",
          product: {
            id: "sku-1",
            title: "Jasmine tea",
            uri: "https://example.com/tea",
            availability: "IN_STOCK",
            brands: ["Oasis"],
            priceInfo: { price: 12, currencyCode: "CAD", originalPrice: 14 },
          },
        },
      ],
    });
    assert.equal(shaped.correctedQuery, "tea");
    assert.equal(shaped.results[0]?.title, "Jasmine tea");
    assert.equal(shaped.results[0]?.price, 12);
    assert.equal(shaped.results[0]?.currencyCode, "CAD");
  });
});
