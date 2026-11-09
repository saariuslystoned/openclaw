import AVFoundation
import CoreGraphics
import Foundation
import OpenClawKit
import OSLog

actor CameraCaptureService {
    struct CameraDeviceInfo: Encodable {
        let id: String
        let name: String
        let position: String
        let deviceType: String
    }

    enum CameraError: LocalizedError {
        case cameraUnavailable
        case microphoneUnavailable
        case captureFailed(String)
        case exportFailed(String)

        var errorDescription: String? {
            switch self {
            case .cameraUnavailable:
                "Camera unavailable"
            case .microphoneUnavailable:
                "Microphone unavailable"
            case let .captureFailed(msg), let .exportFailed(msg):
                msg
            }
        }
    }

    private let logger = Logger(subsystem: "ai.openclaw", category: "camera")

    func listDevices() -> [CameraDeviceInfo] {
        CameraDeviceResolver.availableCameras().map { device in
            CameraDeviceInfo(
                id: device.uniqueID,
                name: device.localizedName,
                position: CameraCapturePipelineSupport.positionLabel(device.position),
                deviceType: device.deviceType.rawValue)
        }
    }

    typealias SnapCapture = @Sendable (
        _ preferFrontCamera: Bool,
        _ deviceId: String?,
        _ maxWidth: Int,
        _ quality: Double,
        _ settleExposure: @Sendable () async throws -> Void,
        _ beforeCapture: @Sendable () async throws -> Void) async throws
        -> (data: Data, size: CGSize)

    func snap(
        facing: OpenClawCameraFacing,
        maxWidth: Int?,
        quality: Double?,
        deviceId: String?,
        delayMs: Int,
        capturePhoto: SnapCapture? = nil,
        sleep: @escaping @Sendable (UInt64) async throws -> Void = { try await Task.sleep(nanoseconds: $0) })
        async throws -> (data: Data, size: CGSize)
    {
        let (maxWidth, quality) = Self.normalizeSnap(maxWidth: maxWidth, quality: quality)
        let delayMs = max(0, delayMs)
        let deviceId = deviceId?.trimmingCharacters(in: .whitespacesAndNewlines)

        let capturePhoto = capturePhoto ?? self.capturePhoto
        return try await capturePhoto(
            facing == .front, deviceId, maxWidth, quality,
            {
                // Only the sleep policy crosses the boundary; device reads stay on this actor.
                try await sleep(50_000_000)
            },
            {
                try await Self.sleepDelayMs(delayMs, sleep: sleep)
                try Task.checkCancellation()
            })
    }

    func clip(
        facing: OpenClawCameraFacing,
        durationMs: Int?,
        includeAudio: Bool,
        deviceId: String?) async throws -> (path: String, durationMs: Int, hasAudio: Bool)
    {
        let durationMs = CaptureRateLimits.clampDurationMs(durationMs, defaultMs: 3000)
        let deviceId = deviceId?.trimmingCharacters(in: .whitespacesAndNewlines)

        try await self.ensureAccess(for: .video)
        if includeAudio {
            try await self.ensureAccess(for: .audio)
        }

        let tmpMovURL = FileManager().temporaryDirectory
            .appendingPathComponent("openclaw-camera-\(UUID().uuidString).mov")
        defer { try? FileManager().removeItem(at: tmpMovURL) }

        let outputURL = FileManager().temporaryDirectory
            .appendingPathComponent("openclaw-camera-\(UUID().uuidString).mp4")
        let logger = self.logger
        let recordedURL = try await CameraCapturePipelineSupport.withWarmMovieSession(
            options: CameraMovieSessionOptions(
                preferFrontCamera: facing == .front,
                deviceId: deviceId,
                includeAudio: includeAudio,
                durationMs: durationMs),
            pickCamera: Self.pickCamera,
            mapSetupError: { setupError in
                CameraCapturePipelineSupport.mapMovieSetupError(
                    setupError,
                    microphoneUnavailableError: CameraError.microphoneUnavailable,
                    captureFailed: CameraError.captureFailed)
            },
            operation: { output in
                // Replace the export destination only after camera setup succeeds.
                try? FileManager().removeItem(at: outputURL)
                var delegate: MovieFileDelegate?
                let recordedURL: URL = try await withCheckedThrowingContinuation { cont in
                    let captureDelegate = MovieFileDelegate(cont, logger: logger)
                    delegate = captureDelegate
                    output.startRecording(to: tmpMovURL, recordingDelegate: captureDelegate)
                }
                withExtendedLifetime(delegate) {}
                return recordedURL
            })
        try await Self.exportToMP4(inputURL: recordedURL, outputURL: outputURL)
        return (path: outputURL.path, durationMs: durationMs, hasAudio: includeAudio)
    }

    private func ensureAccess(for mediaType: AVMediaType) async throws {
        if let error = await PermissionManager.missingPermissions([mediaType == .video ? .camera : .microphone]) {
            throw error
        }
    }

    private nonisolated static func pickCamera(
        preferFrontCamera: Bool,
        deviceId: String?) throws -> AVCaptureDevice
    {
        try CameraCapturePipelineSupport.selectCamera(
            deviceId: deviceId,
            matching: CameraDeviceResolver.camera,
            fallback: {
                let position: AVCaptureDevice.Position = preferFrontCamera ? .front : .back
                // Many macOS cameras report `unspecified` position; fall back only without an explicit device.
                return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position) ??
                    AVCaptureDevice.default(for: .video)
            },
            unavailableError: CameraError.cameraUnavailable,
            deviceNotFoundError: { CameraPTZError.deviceNotFound($0) })
    }

    nonisolated static func normalizeSnap(maxWidth: Int?, quality: Double?) -> (maxWidth: Int, quality: Double) {
        // Default to a reasonable max width to keep downstream payload sizes manageable.
        // If you need full-res, explicitly request a larger maxWidth.
        let maxWidth = maxWidth.flatMap { $0 > 0 ? $0 : nil } ?? 1600
        let quality = min(1.0, max(0.05, quality ?? 0.9))
        return (maxWidth: maxWidth, quality: quality)
    }

    private nonisolated static func exportToMP4(inputURL: URL, outputURL: URL) async throws {
        let asset = AVURLAsset(url: inputURL)
        guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetMediumQuality) else {
            throw CameraError.exportFailed("Failed to create export session")
        }
        export.shouldOptimizeForNetworkUse = true

        do {
            try await export.export(to: outputURL, as: .mp4)
        } catch {
            throw CameraError.exportFailed(error.localizedDescription)
        }
    }

    private func capturePhoto(
        preferFrontCamera: Bool,
        deviceId: String?,
        maxWidth: Int,
        quality: Double,
        settleExposure: @Sendable () async throws -> Void,
        beforeCapture: @Sendable () async throws -> Void) async throws
        -> (data: Data, size: CGSize)
    {
        try await self.ensureAccess(for: .video)

        let prepared = try CameraCapturePipelineSupport.preparePhotoSession(
            preferFrontCamera: preferFrontCamera,
            deviceId: deviceId,
            pickCamera: Self.pickCamera,
            mapSetupError: { setupError in
                CameraError.captureFailed(setupError.localizedDescription)
            })
        let session = prepared.session
        let device = prepared.device
        let output = prepared.output

        session.startRunning()
        defer { session.stopRunning() }
        // The photo preset can choose a portrait format at startup on external webcams.
        // Select its landscape counterpart only after negotiation and before capturing.
        let formats = device.formats
        if let index = CameraDeviceResolver.landscapePhotoFormatIndex(
            deviceType: device.deviceType,
            activeFormat: device.activeFormat.formatDescription,
            formats: formats.map(\.formatDescription))
        {
            do {
                try device.lockForConfiguration()
                defer { device.unlockForConfiguration() }
                device.activeFormat = formats[index]
            } catch {
                self.logger.warning(
                    "camera landscape format selection failed: \(error.localizedDescription, privacy: .public)")
            }
        }
        try await CameraCapturePipelineSupport.warmUpCaptureSession()
        try await self.waitForExposureAndWhiteBalance(device: device, settleExposure: settleExposure)
        try await beforeCapture()

        var delegate: PhotoCaptureDelegate?
        let rawData: Data = try await withCheckedThrowingContinuation { continuation in
            let captureDelegate = PhotoCaptureDelegate(continuation)
            delegate = captureDelegate
            output.capturePhoto(
                with: CameraCapturePipelineSupport.makePhotoSettings(output: output),
                delegate: captureDelegate)
        }
        withExtendedLifetime(delegate) {}

        let res: (data: Data, widthPx: Int, heightPx: Int)
        do {
            res = try PhotoCapture.transcodeJPEGForGateway(
                rawData: rawData,
                maxWidthPx: maxWidth,
                quality: quality)
        } catch {
            throw CameraError.captureFailed(error.localizedDescription)
        }

        return (data: res.data, size: CGSize(width: res.widthPx, height: res.heightPx))
    }

    private func waitForExposureAndWhiteBalance(
        device: AVCaptureDevice,
        settleExposure: @Sendable () async throws -> Void) async throws
    {
        let maxSteps = 30 // ~1.5s
        for _ in 0..<maxSteps {
            if !(device.isAdjustingExposure || device.isAdjustingWhiteBalance) {
                return
            }
            try await settleExposure()
        }
    }

    private nonisolated static func sleepDelayMs(
        _ delayMs: Int,
        sleep: @Sendable (UInt64) async throws -> Void) async throws
    {
        guard delayMs > 0 else { return }
        let ns = UInt64(min(delayMs, 10000)) * 1_000_000
        try await sleep(ns)
    }
}

private final class PhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate {
    private var cont: CheckedContinuation<Data, Error>?

    init(_ cont: CheckedContinuation<Data, Error>) {
        self.cont = cont
    }

    func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?)
    {
        guard let cont else { return }
        self.cont = nil
        if let error {
            cont.resume(throwing: error)
            return
        }
        guard let data = photo.fileDataRepresentation() else {
            cont.resume(throwing: CameraCaptureService.CameraError.captureFailed("No photo data"))
            return
        }
        if data.isEmpty {
            cont.resume(throwing: CameraCaptureService.CameraError.captureFailed("Photo data empty"))
            return
        }
        cont.resume(returning: data)
    }

    func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings,
        error: Error?)
    {
        guard let error else { return }
        guard let cont else { return }
        self.cont = nil
        cont.resume(throwing: error)
    }
}

private final class MovieFileDelegate: NSObject, AVCaptureFileOutputRecordingDelegate {
    private var cont: CheckedContinuation<URL, Error>?
    private let logger: Logger

    init(_ cont: CheckedContinuation<URL, Error>, logger: Logger) {
        self.cont = cont
        self.logger = logger
    }

    func fileOutput(
        _ output: AVCaptureFileOutput,
        didFinishRecordingTo outputFileURL: URL,
        from connections: [AVCaptureConnection],
        error: Error?)
    {
        guard let cont else { return }
        self.cont = nil

        if let error {
            let ns = error as NSError
            if ns.domain == AVFoundationErrorDomain,
               ns.code == AVError.maximumDurationReached.rawValue
            {
                cont.resume(returning: outputFileURL)
                return
            }

            self.logger.error("camera record failed: \(error.localizedDescription, privacy: .public)")
            cont.resume(throwing: error)
            return
        }

        cont.resume(returning: outputFileURL)
    }
}
