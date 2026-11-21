// Test-only configuration (never used in production).
export const TEST_ENV = {
  SESSION_SECRET: "test-secret-".padEnd(48, "x"),
  ADMIN_PASSWORD: "AdminPass123",
  ADMIN_EMAIL: "admin@test.local",
  ADMIN_NAME: "מנהל בדיקות",
};
globalThis.Netlify = { env: { get: (k) => TEST_ENV[k] } };
