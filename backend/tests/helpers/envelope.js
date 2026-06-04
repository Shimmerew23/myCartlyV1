// Shared assertions for the frozen API response contract (utils/ApiResponse.js
// + the central errorHandler). Used by tests/envelope.test.js to assert that
// every route group still emits the legacy envelope/shape after the
// MongoDB -> PostgreSQL/Prisma migration (Phase 1 workstream).

// Standard success envelope: { statusCode, success, message, data, timestamp }
function expectEnvelope(res, expectedStatus = 200) {
  expect(res.status).toBe(expectedStatus);
  expect(res.body).toHaveProperty('statusCode', expectedStatus);
  expect(res.body).toHaveProperty('success', expectedStatus < 400);
  expect(typeof res.body.message).toBe('string');
  expect(res.body).toHaveProperty('data');
  expect(typeof res.body.timestamp).toBe('string');
  expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
}

// Paginated envelope adds a `pagination` object alongside `data`.
function expectPaginatedEnvelope(res, expectedStatus = 200) {
  expectEnvelope(res, expectedStatus);
  expect(Array.isArray(res.body.data)).toBe(true);
  expect(typeof res.body.pagination).toBe('object');
  expect(res.body.pagination).not.toBeNull();
}

// Error envelope from the central errorHandler: { success:false, message, errors }
function expectErrorEnvelope(res, expectedStatus) {
  expect(res.status).toBe(expectedStatus);
  expect(res.body).toHaveProperty('success', false);
  expect(typeof res.body.message).toBe('string');
  expect(Array.isArray(res.body.errors)).toBe(true);
}

module.exports = { expectEnvelope, expectPaginatedEnvelope, expectErrorEnvelope };
