// Copies the compiled __name__ ZK artifacts into public/ so the browser can
// fetch them: every contract under contract/managed/, not only the one this UI
// was generated for (__MANAGED__), so an example that compiles several
// contracts (shielded-chips) can wire the others in its seed files.
//
// Why: in Node the harness reads keys from disk (NodeZkConfigProvider). A browser
// can't, so the UI uses FetchZkConfigProvider, which GETs
//   <base>/keys/<circuit>.prover, <base>/keys/<circuit>.verifier, <base>/zkir/<circuit>.bzkir
// We serve them from /managed/<contract>/ (see src/midnight/providers.ts).
//
// @if monorepo
// `npm run dev` and `npm run build` run it first.
// The source is the gitignored output of `npm run compile` in examples/__name__,
// and the destination (public/managed/) is gitignored too.
//
// It also refuses to run on a Node older than the repo root's engines.node:
// npm doesn't enforce `engines`, and a shell defaulting to Node 20 crashed
// the dev server in hello-world/ui with an unrelated-looking error. This is
// the first thing `dev` and `build` run, so it fails early and clearly.
// @endif
// @if standalone
// `npm run dev` and `npm run build` run it first. The source is the gitignored
// output of `npm run compile` in the project, and the destination
// (public/managed/) is gitignored too.
//
// It also refuses to run on a Node older than the project's engines.node, so
// a shell on an old Node fails here, early and clearly, rather than in the
// dev server with an unrelated-looking error.
// @endif
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// @if monorepo
const range = JSON.parse(readFileSync(path.resolve(here, "../../../../package.json"), "utf8")).engines?.node;
// @endif
// @if standalone
const range = JSON.parse(readFileSync(path.resolve(here, "../../package.json"), "utf8")).engines?.node;
// @endif
const min = Number(/^>=\s*(\d+)/.exec(range ?? "")?.[1]);
if (min && Number(process.versions.node.split(".")[0]) < min) {
  // @if monorepo
  console.error(
    `[copy:zk] Node ${process.versions.node} is too old: this repo needs Node ${range} (see .nvmrc). Try \`nvm use\`.`,
  );
  // @endif
  // @if standalone
  console.error(
    `[copy:zk] Node ${process.versions.node} is too old: this project needs Node ${range}.`,
  );
  // @endif
  process.exit(1);
}
const managed = path.resolve(here, "../../contract/managed");
const primary = path.join(managed, "__MANAGED__");

for (const dir of ["keys", "zkir"]) {
  if (!existsSync(path.join(primary, dir))) {
    // @if monorepo
    console.error(
      `[copy:zk] ${path.join(primary, dir)} not found.\n` +
        "Compile the contract first:  npm run compile -w @midnight-ntwrk/example-__name__",
    );
    // @endif
    // @if standalone
    console.error(
      `[copy:zk] ${path.join(primary, dir)} not found.\n` +
        "Compile the contract first:  npm run compile",
    );
    // @endif
    process.exit(1);
  }
}

// A compiled contract is a managed/<c>/ with compiler/contract-info.json.
const contracts = readdirSync(managed).filter(
  (c) =>
    existsSync(path.join(managed, c, "compiler", "contract-info.json")) &&
    ["keys", "zkir"].every((dir) => existsSync(path.join(managed, c, dir))),
);

const destRoot = path.resolve(here, "../public/managed");
rmSync(destRoot, { recursive: true, force: true });
for (const c of contracts) {
  for (const dir of ["keys", "zkir"]) {
    cpSync(path.join(managed, c, dir), path.join(destRoot, c, dir), { recursive: true });
  }
}
console.log(
  `[copy:zk] copied keys/ and zkir/ of ${contracts.join(", ")} to ${path.relative(process.cwd(), destRoot)}`,
);
