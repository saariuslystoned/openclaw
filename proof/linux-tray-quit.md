# Tray reveal during quit: source and compile evidence

Base: `7c7a4d5db4adf174b324cfe47c17123808a7de61`. This branch changes only the shared main-window reveal boundary and records its verification limits.

`DesktopState::claim_quit` sets the quit flag before teardown joins. `tray::show_window` previously requested show, unminimize and focus without reading that flag. A worker-thread caller can enqueue those effects. The change checks the flag inside a main-thread closure immediately before the effects. Current production quit claims also run on the main thread. Existing main-thread reveals stay synchronous; off-thread calls queue one guarded callback.

The dependency contract was inspected in checksum-verified Tauri2.12.5 and tauri-runtime-wry2.12.3 sources. Wry Context::send_user_message executes immediately on the UI thread, queues otherwise; run_on_main_thread delegates to it. No independent lifecycle flag or cleanup owner is added. Updater and Gateway behavior are unchanged.

## Executed checks

- Offline `cargo test --locked --offline --no-run --bin openclaw-desktop`: passed with Rust1.97.1. This compiled the test executable; it did not launch the desktop app.
- Existing `desktop_quit_claim_requires_current_route_and_has_one_teardown_owner`: passed in an isolated, network-off environment with empty HOME and no host display or bus sockets. This checks quit ownership, not window visibility.
- rustfmt check on the changed Rust file and `git diff --check`: passed.

Captured test result:

```text
running 1 test
test navigation_tests::desktop_quit_claim_requires_current_route_and_has_one_teardown_owner ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 356 filtered out; finished in 0.01s
```

An existing dead-code warning for GatewayOperationQueue::Action was retained. No dependency or lockfile changes.

## Required native regression: not executed

Actual window reappearance on the base and suppression on the candidate remain unverified. The available control surface did not offer native Linux interaction/capture; no shell, xdotool, DBus or raw-CDP bypass was used. No installed app, personal Gateway, updater network or live desktop was touched.

Required next proof: use an approved isolated native executor and the real app with a synthetic Gateway. Confirm ordinary reveal, then hide the window; establish a real quit claim while owned teardown is still pending; deliver the reveal request and observe the window through cleanup. Base must reproduce the visible problem before any native red/green claim; candidate must stay hidden after quit and preserve ordinary reveal and cleanup. The existing native harness needs an observable ordering point for this scenario. A mock-runtime visibility test would pass with the original defect and was deliberately not substituted.

This branch is source/compile-qualified and ready for the missing native regression, not native-validated or merge-ready. No upstream PR is created by this work.
