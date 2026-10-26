import XCTest

final class BMUXLauncherTests: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "cc.bmux.remote")
  private let remoteURL = "https://metro-mobile.bmux.cc"
  private let localURL = "http://127.0.0.1:19731"

  override func setUpWithError() throws {
    continueAfterFailure = false
    app.launchArguments = ["-EXDevMenuIsOnboardingFinished", "1", "-EXDevMenuShowsAtLaunch", "0"]
  }

  private func capture(_ name: String) {
    let image = XCTAttachment(screenshot: app.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
  }

  override func tearDownWithError() throws {
    capture("launcher-final-state")
    let hierarchy = XCTAttachment(string: app.debugDescription)
    hierarchy.lifetime = .keepAlways
    add(hierarchy)
    app.terminate()
  }

  func testRemoteServerChoiceAndRememberedManualURL() throws {
    app.launch()
    XCTAssertTrue(app.staticTexts[remoteURL].firstMatch.waitForExistence(timeout: 30))
    let initialRemoteLabels = app.staticTexts[remoteURL].count
    capture("01-default-remote-server")

    app.buttons["Enter URL manually"].tap()
    let field = app.textFields.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    field.tap()
    field.typeText(localURL)
    XCTAssertEqual(field.value as? String, localURL)
    capture("02-editable-server-url")
    app.buttons["Connect"].tap()

    XCTAssertTrue(app.staticTexts["Your sessions, wherever you are."].waitForExistence(timeout: 180))
    capture("03-metro-welcome")
    app.terminate()
    app.launch()

    XCTAssertTrue(app.staticTexts[localURL].firstMatch.waitForExistence(timeout: 30))
    XCTAssertTrue(app.staticTexts[remoteURL].firstMatch.exists)
    XCTAssertEqual(app.staticTexts[remoteURL].count, initialRemoteLabels)
    XCTAssertTrue(app.buttons["Enter URL manually"].exists)
    capture("04-remembered-server-choice")
  }
}
