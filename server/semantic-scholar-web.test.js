import assert from "node:assert/strict";
import test from "node:test";
import { extractSemanticScholarAbstract, findExactSemanticScholarRecord, normalizeSemanticScholarTitle } from "./semantic-scholar-web.js";

test("normalizes Semantic Scholar result titles for exact matching", () => {
  assert.equal(
    normalizeSemanticScholarTitle("Indirect Predictive Power-Control: Grid Following"),
    normalizeSemanticScholarTitle("indirect predictive power control grid-following")
  );
});

test("extracts only the expanded abstract from a Semantic Scholar result card", () => {
  const abstract = extractSemanticScholarAbstract(`
Paper title
Authors
TLDR
Short generated summary.
Abstract
This is the complete publisher abstract. It contains enough text to be treated as useful metadata and must not include controls from the result card. The crawler should preserve the academic content while removing repeated whitespace.
Collapse
3 citations
IEEE
Save
Cite
  `);
  assert.equal(
    abstract,
    "This is the complete publisher abstract. It contains enough text to be treated as useful metadata and must not include controls from the result card. The crawler should preserve the academic content while removing repeated whitespace."
  );
});

test("rejects truncated cards without an expanded Abstract section", () => {
  assert.equal(extractSemanticScholarAbstract("Paper title\nA short preview…\nExpand"), "");
});

test("finds only an exact-title abstract in a nested web search response", () => {
  const result = findExactSemanticScholarRecord({
    results: [
      { paper: { title: { text: "A Similar Paper" }, abstract: { text: "x".repeat(300) } } },
      {
        paper: {
          title: { text: "Exact Paper: Grid-Following Control" },
          abstract: { text: "This exact record contains a complete abstract returned by the public search page. ".repeat(3) },
          url: "https://www.semanticscholar.org/paper/exact"
        }
      }
    ]
  }, "Exact Paper Grid Following Control");
  assert.equal(result.title, "Exact Paper: Grid-Following Control");
  assert.match(result.abstract, /complete abstract/);
});
