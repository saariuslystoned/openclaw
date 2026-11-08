# H38 additive integration validation

Source head: `233e789a02100b6c4f78afb6fe50c393f8d4402d`.
Parents: original candidate `0d3f88d56881af8d0aa45978d9d6d6de6739703b` and official main `0566b7771956f0f5dcb1a1ce32a729e7c5f5d9e7`.
PR: https://github.com/openclaw/openclaw/pull/195244

A supported review-materializer preflight rejected the old branch because the then-current PR base was not its ancestor. An explicit owner assignment admitted one integration-only upstream merge. It merged cleanly without production edits: the three-file patch against the incorporated main is byte-identical to the original candidate patch against its prepared base (explicit identical diff prefixes; SHA256 `e0554fe2e62fdc08d6ba67a0558083b945df5ea287595884750b1d4f63132ca5`). The original candidate and [original base-red/candidate-green proof](https://github.com/saariuslystoned/openclaw/blob/7f306b9d242caf490d43917a602d8512a9e6b17a/proof/nested-attachment-0d3f88d5/PROOF.md) remain immutable history.

## Actual validation on the integrated head

- Fresh frozen install: pnpm12.15.0, Node26.13.0, Linux arm64; current lock SHA256 `e70294edfd369acccae4580b909e4fe0738e3c4933cb3164bc8407125353c4d9`. Public dependency preparation used a cleared-environment namespace; no account credentials or private state. Lock supply-chain validation passed. No additional agent skill was approved.
- **52 tests / 6 files passed**, 236.593s wrapper, using the same original fictional three-stage fixture and five sibling suites. The supported runner prepared its current source runtime (15067 inputs); this is not a full release/Gateway build claim.
- Original download succeeds in canonical, portable nested-only, and restored-top-level stages. Every stage retained valid/verified records, exact source/body/control hashes, unrelated-record denial, and unchanged source bytes. Complete machine rows are in `h38-integration-consumer-acceptance.json`.
- Oxfmt, type-aware Oxlint, full tracked extension-test TypeScript, measured allocation ratchet, and `git diff --check` passed. The original untracked proof fixture was renamed back to retained text after execution and before TypeScript, preserving its bytes; no tracked compiler input was excluded. Local formatter/linter does not claim pinned-Bun CI parity.

Commands and times are in the JSON receipts; output is in `TERMINAL.txt`. Original fixture SHA256 `d2dcde6999896ed4f46f93ea4fe37e54b231df50e487f65fc2d1f032d74f6b4b` (9948 bytes), unchanged. Paths identifying the operator/task root are replaced with placeholders. Stores and text are wholly fictional.

## Limits and remaining gates

This is registered-operation/native SQLite proof with synthetic host authority, not live Gateway/UI/model execution. The initial base-red proof belongs to the old prepared base; it was not rerun on incorporated main. New-head CI and native exact-head review remain pending; old-head verdicts do not clear the integrated head. Comprehensive review is not launched: the current facade cannot supply required unchanged source context to its isolated review workspace, and its bundle staging additionally refuses local shallow roots. Neither refusal was bypassed. Human maintainer approval remains required for merge. No source architecture, permission, schema, allocation beyond the original46-line entry, or shared baseline was changed.
