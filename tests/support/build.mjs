// Bundles the Netlify function with the in-memory blobs mock -> tests/.build/api.mjs
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
await build({
  entryPoints: [path.join(root, "netlify/functions/api.mts")],
  bundle: true, platform: "node", format: "esm", logLevel: "error",
  outfile: path.join(root, "tests/.build/api.mjs"),
  // keep the mock external so tests and the bundle share ONE store instance
  plugins: [{ name: "blobs-mock", setup(b) { b.onResolve({ filter: /^@netlify\/blobs$/ }, () => ({ path: "../support/blobs-mock.mjs", external: true })); } }],
});
console.log("built tests/.build/api.mjs");
