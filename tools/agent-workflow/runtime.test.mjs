import assert from "node:assert/strict";
import test from "node:test";

import { resolveLinearEndpoint } from "./runtime.mjs";

const official = "https://api.linear.app/graphql";

test("Linear endpoint override는 loopback host만 허용하고 나머지는 경고와 함께 무시한다", () => {
  const warnings = [];
  const warn = (message) => warnings.push(message);

  for (const override of [
    "http://127.0.0.1:5321/graphql",
    "http://localhost:5321/graphql",
    "http://[::1]:5321/graphql",
  ]) {
    assert.equal(resolveLinearEndpoint(override, official, warn), override);
  }
  assert.deepEqual(warnings, []);

  for (const override of [
    "https://evil.example.com/graphql",
    "https://api.linear.app.evil.example.com/graphql",
    "http://127.0.0.1.evil.example.com/graphql",
    "not a url",
  ]) {
    assert.equal(resolveLinearEndpoint(override, official, warn), official, override);
  }
  assert.equal(warnings.length, 4);
  assert.match(warnings[0], /loopback host만 허용/);

  assert.equal(resolveLinearEndpoint(undefined, official, warn), official);
  assert.equal(resolveLinearEndpoint("", official, warn), official);
  assert.equal(warnings.length, 4);
});
