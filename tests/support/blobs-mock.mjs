// In-memory stand-in for @netlify/blobs used by the test build.
const data = new Map();
export const __reset = () => data.clear();
export const __dump = () => Object.fromEntries(data);
export const getStore = () => ({
  get: async (k, o) => (data.has(k) ? (o?.type === "json" ? JSON.parse(data.get(k)) : data.get(k)) : null),
  setJSON: async (k, v) => { data.set(k, JSON.stringify(v)); return { modified: true }; },
  set: async (k, v) => { data.set(k, String(v)); return { modified: true }; },
  delete: async (k) => { data.delete(k); },
});
