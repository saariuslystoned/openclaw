# Canonical token-origin counterexample

Issue: https://github.com/openclaw/openclaw/issues/195031 . Bound OpenClaw source: bffe6728a1a102512a477e48526341083a4f0f5c; all ten complete source/helper/doc/test hashes are in receipt.json. This supplements the earlier seven-case diagnostic; those observations remain valid.

Four short native FTS5/NFC cases executed unchanged on Node26.13.0 / ICU78.3 / Unicode17.0 / SQLite3.54.0 in a cleared-environment, network-unshared namespace with read-only artifact mount, temporary HOME and no product source, store or credentials. Exit0; all actual observations precede prediction checks; zero control failures; in-memory DB cleanup passed; wrapper0.042s; stderr empty.

## Actual counterexample

Original S: SPACE, U+1AB0, U+0323, a, t, l, a, s.
Projected NFC(S): SPACE, U+0323, U+1AB0, a, t, l, a, s.
Literal query: U+1AB0 followed by atlas.

Both original and projected FTS corpora match the query. Actual original token start is UTF-16 offset1; projected start is2. The additive NFD-weight candidate is2, but BOTH prefix and suffix NFC equalities fail. The exhaustive oracle checks all nine code-point boundaries of this eight-unit source: NONE is a normalization-stable cut at projected start2. The original token origin remains observable at1.

The already-ordered, known-mark and plain controls have identical original/projected starts2,3,1 and valid stable cuts respectively. Positive-row, unrelated-row, absent-query and stored-byte/hash controls pass throughout.

This refutes a total mapping strategy based solely on normalization-stable prefix partitions. It does not refute exact source-origin mapping, and it does not authorize dropping a hit, returning an unlocated opening excerpt or imposing a new input cap.

## Reproduction

Copy diagnostic.mjs.txt unchanged to diagnostic.mjs in a disposable qualified Node26 environment and run `node diagnostic.mjs`. It imports only node:crypto and node:sqlite, creates an in-memory database and performs no file, network or model operations. SHA25680be266fc904d93cbeb7d995c6d596ebddc45570e66db468d8262b04e6263bc7. Full unchanged30377B stdout is TERMINAL.jsonl, SHA256ab3b0385d20d7f81a44297c141f0fc9a860b2b60358e6d7d1568d58a85d49baf. receipt.json and manifest.json bind exact source, runtime, sizes, hashes and limits.

## Limits

This is actual in-memory SQLite tokenizer/native-normalization evidence only. It imports no production module and proves no registered operation, native Knowledge store, Gateway/UI, product integration or completed repair. It is not a new current product defect: the proposed NFC repair/mapping has not been implemented. The earlier canonical-equivalence bug remains independently reproduced.

A complete repair still must preserve original record/citation bytes, exact source snippet positions, scope and eligibility, current/history/temporary corpus correctness and unchanged-old-index refresh. A revised native-normalizer origin strategy needs separate qualification; no new precision policy or implementation is approved here. The exhaustive short-input oracle is diagnostic-only, not a proposed production algorithm.
