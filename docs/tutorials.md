# Tutorials

Each example's tutorial lives in `examples/<name>/tutorials/` as `.mdx` pages,
starting with `index.mdx`. This repo is the source of truth. The pages are
published on [docs.midnight.network](https://docs.midnight.network/tutorials)
under `/tutorials/<name>/`.

The examples form one learning path, read in order. See
[Learning path](../README.md#learning-path) in the root README.

## How syncing works

When a change under `examples/*/tutorials/` lands on `main`, the
[`sync-tutorials` workflow](../.github/workflows/sync-tutorials.yml) opens (or
updates) one pull request against
[`midnightntwrk/midnight-docs`](https://github.com/midnightntwrk/midnight-docs)
that mirrors each example's `tutorials/` into `docs/tutorials/<name>/`.

```
edit examples/<name>/tutorials/ → PR merged to main → workflow opens a midnight-docs PR → docs team merges → published
```

- **Edit tutorials here, never in midnight-docs.** The next sync overwrites
  direct edits to a synced folder.
- Deletions and renames propagate too: the sync uses `rsync --delete`.
- `README.md` in a `tutorials/` folder is not synced.
- `_category_.yaml` (Docusaurus sidebar label and position) is **owned by
  midnight-docs**. The sync excludes it and leaves the docs-side copy alone.
  A new tutorial needs one added on the docs side.
- Images and other assets a page needs live next to it in `tutorials/` and are
  referenced by relative path, so they sync with the page. Anything added only
  on the docs side inside a synced folder (other than `README.md` and
  `_category_.yaml`) is deleted by the next sync.
- If midnight-docs already has a docs-authored folder with the example's name
  (`private-party` does), the first sync replaces its pages wholesale. Land a
  docs-side PR alongside it that removes or redirects the old pages.
- An example whose `tutorials/index.mdx` still has the `tutorial-template`
  marker line from the scaffold is skipped, so a stub never reaches the docs.
- All synced examples share one docs branch, `sync/examples-tutorials`, so
  successive merges here update a single open docs PR.
- The workflow needs the `DEVREL_DOCS_PR_TOKEN` secret, a token that can push
  branches and open PRs on midnight-docs.

## Writing a tutorial

`yarn new:example` copies a starter `tutorials/index.mdx` from
[`templates/example/tutorials/`](../templates/example/tutorials/index.mdx).

- **Prerequisites:** open by naming the previous learning-path step and linking
  its docs page.
- **Commands:** use this repo's commands: `yarn install && yarn compile` at the
  root, then `cd examples/<name>`, `yarn env:up`, `yarn wait:dust`,
  `yarn test:local`. Never `git clone` a standalone `example-*` repo. CI fails
  if a tutorial does.
- **Links:** the pages render on the docs site, so:
  - link other docs pages site-absolute (`/tutorials/<name>/…`,
    `/getting-started/…`);
  - link source files with a full GitHub URL
    (`https://github.com/midnightntwrk/midnight-examples/blob/main/examples/<name>/…`),
    not a relative path.
- **Code blocks:** quote the example's current files, and give each quoted block
  a `title` naming its file relative to the example, e.g.
  ` ```compact title="contract/battleship.compact" `. CI
  (`node scripts/check-tutorial-code.mjs`) fails if a titled block's lines no
  longer appear verbatim in that file (trailing whitespace aside), so when the
  code changes, update the tutorial in the same PR. Docusaurus options such as
  `showLineNumbers` or `{2-4}` may sit before or after `title=`. Leave commands and sample output untitled.
- **Docs components:** `@site/…` imports such as `PersonaTiles` resolve on the
  docs site only. They are fine to use; they just won't render on GitHub.
