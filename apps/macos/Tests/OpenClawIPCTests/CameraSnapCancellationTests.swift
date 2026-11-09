import Foundation
import Testing
@testable import OpenClaw

private enum SnapProbeError: Error {
    case captureReached
}

private actor SnapProbe {
    private var sleeps: [UInt64] = []
    private var captures = 0

    func slept(_ nanoseconds: UInt64) {
        self.sleeps.append(nanoseconds)
    }

    func captured() {
        self.captures += 1
    }

    func snapshot() -> (sleeps: [UInt64], captures: Int) {
        (self.sleeps, self.captures)
    }
}

struct CameraSnapCancellationTests {
    @Test(arguments: [true, false])
    func cancellationDuringSettlingPreventsCapture(adjustingExposure: Bool) async {
        let probe = SnapProbe()
        // Cancel only this joined child, never the test runner's task.
        let task = Task { () -> Bool in
            do {
                _ = try await CameraCaptureService().snap(
                    facing: .front, maxWidth: nil, quality: nil, deviceId: nil, delayMs: 200,
                    capturePhoto: { _, _, _, _, settleExposure, beforeCapture in
                        if adjustingExposure {
                            try await settleExposure()
                        }
                        try await beforeCapture()
                        await probe.captured()
                        throw SnapProbeError.captureReached
                    },
                    sleep: { nanoseconds in
                        await probe.slept(nanoseconds)
                        withUnsafeCurrentTask { $0?.cancel() }
                        try Task.checkCancellation()
                    })
                return false
            } catch is CancellationError {
                return true
            } catch {
                return false
            }
        }

        let cancelled = await task.value
        let snapshot = await probe.snapshot()
        #expect(cancelled)
        #expect(snapshot.captures == 0)
        #expect(snapshot.sleeps == [adjustingExposure ? 50_000_000 : 200_000_000])
    }

    @Test func cancellationWithZeroDelayPreventsCaptureWhenSleeperReturns() async {
        let probe = SnapProbe()
        let task = Task { () -> Bool in
            do {
                _ = try await CameraCaptureService().snap(
                    facing: .front, maxWidth: nil, quality: nil, deviceId: nil, delayMs: 0,
                    capturePhoto: { _, _, _, _, settleExposure, beforeCapture in
                        try await settleExposure()
                        try await beforeCapture()
                        await probe.captured()
                        throw SnapProbeError.captureReached
                    },
                    sleep: { nanoseconds in
                        await probe.slept(nanoseconds)
                        // Deliberately return after cancellation: the final guard must catch it.
                        withUnsafeCurrentTask { $0?.cancel() }
                    })
                return false
            } catch is CancellationError {
                return true
            } catch {
                return false
            }
        }
        let cancelled = await task.value
        let snapshot = await probe.snapshot()
        #expect(cancelled)
        #expect(snapshot.captures == 0)
        #expect(snapshot.sleeps == [50_000_000])
    }

    @Test func uncancelledSettlingStillReachesCaptureWithClampedDelay() async {
        let probe = SnapProbe()
        do {
            _ = try await CameraCaptureService().snap(
                facing: .front, maxWidth: nil, quality: nil, deviceId: nil, delayMs: 20000,
                capturePhoto: { _, _, _, _, _, beforeCapture in
                    try await beforeCapture()
                    await probe.captured()
                    throw SnapProbeError.captureReached
                },
                sleep: { await probe.slept($0) })
            Issue.record("Expected the fake capture boundary")
        } catch SnapProbeError.captureReached {
            // The fixture stops before JPEG decoding; it never opens a camera.
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
        let snapshot = await probe.snapshot()
        #expect(snapshot.captures == 1)
        #expect(snapshot.sleeps == [10_000_000_000])
    }
}
