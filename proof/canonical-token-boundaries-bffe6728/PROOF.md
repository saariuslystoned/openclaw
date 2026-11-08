# Canonical-equivalence token-boundary diagnostic

Issue: https://github.com/openclaw/openclaw/issues/195031 . Exact source: `bffe6728a1a102512a477e48526341083a4f0f5c`. All ten complete Knowledge source/helper/doc/test files in receipt.json match the independently reproduced original source; runtime dependency freshness is not inferred from source equality.

Independent diagnostic execution: Node26.13.0 / ICU78.3 / Unicode17.0 / SQLite3.54.0, cleared environment, network unshared, read-only artifact mount, temporary isolated HOME, no source/store/credential mounts. Exit0, seven cases, positive/negative controls and in-memory SQLite cleanup pass, wrapper0.090s; stderr empty.

## Finding

With the owner's FTS5 column layout, unicode61(remove_diacritics2), and opening highlight convention, a token can begin inside an NFC-changed grapheme. U+0600 followed by composing Jamo, Latin, Greek or reordered Latin marks produced FOUR such starts. All four had a unique exact normalization-stable split back to original UTF-16 start4493 from projected start4173. Therefore a changed-grapheme interior alone does not justify discarding location.

The unchanged ASCII/prepend-ASCII and bare-Jamo cases distinguish unchanged interior starts from changed boundary starts. Separate-row and absent-query controls, marker round trips, original-string/hash preservation and source-derived snippet/Markdown-line/UTF-16 controls pass. Blindly treating projected offsets as original loses the late match in compact snippets for the bare-Jamo, prepend-Jamo, Latin and Greek cases. An opening excerpt also does not reach those late targets.

One reordered-mark token END has no stable split; its START still maps exactly. The current snippet consumer uses the first match START. This does not prove a general all-boundary normalization mapper or that all possible token starts are recoverable.

## Reproduction and artifacts

Copy diagnostic.mjs.txt unchanged to a disposable `diagnostic.mjs`, then run `node diagnostic.mjs` with qualified Node26. It imports only node:assert, node:crypto and node:sqlite; creates an in-memory database; performs no file/network/model operations. Full source SHA25618a9b56f0314980aa732726eb2dac7d961021abc140eb54f7068e6ea3a242593. TERMINAL.jsonl is the full unchanged15398B stdout SHA2566ca31c5c12aa3d167ce29c9af6c65fdbe6e4564afb89341f2d39469a0ddf8f0a. receipt.json binds source hashes, runtime and claim limits; manifest.json binds all artifacts.

## Limits and next requirement

This is tokenizer/native-normalization reachability evidence and transparent source-derived snippet arithmetic, NOT a registered Knowledge operation/native-store/Gateway/UI repair test or external review. No product source was changed. Tiny-grapheme enumeration is diagnostic-only: repeated normalization across arbitrarily long combining sequences can be quadratic. A production repair still needs a bounded-cost exact-start mapping design, complete NFC query/persistent/current/history/temporary projections, existing-index row/snapshot refresh, original source/citation/scope preservation, registered behavior tests and required reviews. No unlocated-excerpt fallback or new cap/dependency is approved by this observation. Canonical equivalence remains separate from a broader Greek accent-insensitivity policy.
