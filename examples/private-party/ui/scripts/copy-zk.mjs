// Copies the compiled private-party ZK artifacts into public/ so the browser can
// fetch them: every contract under contract/managed/, not only the one this UI
// was generated for (private-party), so an example that compiles several
// contracts (shielded-chips) can wire the others in its seed files.
//
// Why: in Node the harness reads keys from disk (NodeZkConfigProvider). A browser
// can't, so the UI uses FetchZkConfigProvider, which GETs
//   <base>/keys/<circuit>.prover, <base>/keys/<circuit>.verifier, <base>/zkir/<circuit>.bzkir
// We serve them from /managed/<contract>/ (see src/midnight/providers.ts).
//
// `yarn dev` and `yarn build` run it first (Yarn 4 does not run pre* scripts).
// The source is the gitignored output of `yarn compile` in examples/private-party,
// and the destination (public/managed/) is gitignored too.
//
// It also refuses to run on a Node older than the repo root's engines.node:
// Yarn 4 doesn't enforce `engines`, and a shell defaulting to Node 20 crashed
// the dev server in hello-world/ui with an unrelated-looking error. This is
// the first thing `dev` and `build` run, so it fails early and clearly.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const range = JSON.parse(readFileSync(path.resolve(here, "../../../../package.json"), "utf8")).engines?.node;
const min = Number(/^>=\s*(\d+)/.exec(range ?? "")?.[1]);
if (min && Number(process.versions.node.split(".")[0]) < min) {
  console.error(
    `[copy:zk] Node ${process.versions.node} is too old: this repo needs Node ${range} (see .nvmrc). Try \`nvm use\`.`,
  );
  process.exit(1);
}
const managed = path.resolve(here, "../../contract/managed");
const primary = path.join(managed, "private-party");

for (const dir of ["keys", "zkir"]) {
  if (!existsSync(path.join(primary, dir))) {
    console.error(
      `[copy:zk] ${path.join(primary, dir)} not found.\n` +
        "Compile the contract first:  yarn workspace @midnight-ntwrk/example-private-party run compile",
    );
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
