# Knowledge original-download guide proof

Source: `8afafb352787dd7a3b8b102fce946191c036573b`.
Base: `61093f1d32cb0042c858796f87f86920f910bd6d`.
Only changed path: `docs/plugins/knowledge/evidence.md`, eight added lines.

The added paragraph explains the existing programmatic download contract: retain the authorized record/reference/hash, start at zero, independently decode each response data field from base64, append bytes, follow the returned decoded-byte offset, stop at null. It does not alter the API, security checks, limits, or implementation.

## Source and validation

- Complete fresh-base guide:5956 bytes, SHA256 `fea409f27429b3aed754ec5f7b152dd18c71969e9a8cd95fee0c8e2a3423b94c`.
- Complete proposed and committed guide:6491 bytes, SHA256 `160b20f8c3759dc7e17aae518099056c36b1d844a0b02315bd08999ef90979b6`. Staged unchanged from the reviewed proposal.
- Full `attachment-contract.ts`, `vault.ts` and `evidence-view.ts` match the independently inspected retained source byte-for-byte at this base. Producer offsets count decoded bytes; the UI independently decodes pages, checks requested offset/hash, then streams bytes or creates a binary Blob.
- The complete pinned CODEOWNERS has no matching rule for this guide. A bounded six-result open-PR search and complete file lists for the strongest related proposals189822/195010 found no conflicting edit to this guide. This is scoped overlap evidence, not a global ownership guarantee.
- Actual Oxfmt0.74.0 check passed on the sole changed file. This matches the pinned formatter version; the already-owned frozen tool ran read-only in a cleared, network-isolated namespace. No product runtime or shared dependency install was used or changed.
- `git diff --check` passed. Heading, existing link and frontmatter delimiter sets are unchanged. Removing the single insertion restores the exact base bytes.

No runtime tests were added or run for this documentation-only edit. No browser download or behavior change is claimed. CI and exact-head external reviews remain pending publication. A shared publisher owns new core PR creation; this proof does not reserve a slot or authorize merge. Human maintainer approval is still required for merge.
