import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia

final class RecordingDelegate: NSObject, SCRecordingOutputDelegate {
    let ready: URL
    var finished = false
    var failure: Error?
    init(ready: URL) { self.ready = ready }
    func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
        try? Data(String(Date().timeIntervalSince1970).utf8).write(to: ready)
    }
    func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) { finished = true }
    func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) { failure = error; finished = true }
}

let output = URL(fileURLWithPath: CommandLine.arguments[1])
let ready = URL(fileURLWithPath: CommandLine.arguments[2])
let seconds = Double(CommandLine.arguments[3])!
let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
let display = content.displays.first!
let configuration = SCStreamConfiguration()
configuration.width = display.width
configuration.height = display.height
configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
configuration.showsCursor = false
configuration.capturesAudio = false
let stream = SCStream(filter: SCContentFilter(display: display, excludingWindows: []), configuration: configuration, delegate: nil)
let recordingConfiguration = SCRecordingOutputConfiguration()
recordingConfiguration.outputURL = output
recordingConfiguration.outputFileType = .mov
recordingConfiguration.videoCodecType = .h264
let delegate = RecordingDelegate(ready: ready)
let recording = SCRecordingOutput(configuration: recordingConfiguration, delegate: delegate)
try stream.addRecordingOutput(recording)
try await stream.startCapture()
try await Task.sleep(for: .seconds(seconds))
try await stream.stopCapture()
for _ in 0..<100 {
    if delegate.finished { break }
    try await Task.sleep(for: .milliseconds(100))
}
if let error = delegate.failure { throw error }
if !delegate.finished { fatalError("Recording did not finish") }
