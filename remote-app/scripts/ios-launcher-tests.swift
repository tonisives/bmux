import XCTest

final class BMUXLauncherTests: XCTestCase {
  private let app = XCUIApplication(bundleIdentifier: "cc.bmux.remote")
  private let remoteURL = "https://metro-mobile.bmux.cc"
  private let localURL = "http://localhost:19731"

  private func serverEntries(_ url: String) -> XCUIElementQuery {
    app.buttons.matching(NSPredicate(format: "label CONTAINS %@", url))
  }

  private var manualEntry: XCUIElement {
    app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Enter URL manually")).firstMatch
  }

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
    XCTAssertTrue(serverEntries(remoteURL).firstMatch.waitForExistence(timeout: 30))
    XCTAssertTrue(serverEntries(remoteURL).firstMatch.isHittable)
    let initialRemoteEntries = serverEntries(remoteURL).count
    capture("01-default-remote-server")

    manualEntry.tap()
    let field = app.textFields.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    field.tap()
    field.typeText(localURL)
    XCTAssertEqual(field.value as? String, localURL)
    capture("02-editable-server-url")
    app.buttons["Connect"].tap()

    XCTAssertTrue(app.buttons["Sign in"].waitForExistence(timeout: 180))
    XCTAssertTrue(app.buttons["Sign in"].isHittable)
    XCTAssertTrue(app.buttons["Demo"].exists)
    capture("03-metro-welcome")
    app.terminate()
    app.launch()

    XCTAssertTrue(serverEntries(localURL).firstMatch.waitForExistence(timeout: 30))
    XCTAssertTrue(serverEntries(remoteURL).firstMatch.exists)
    XCTAssertEqual(serverEntries(remoteURL).count, initialRemoteEntries)
    XCTAssertTrue(manualEntry.exists)
    capture("04-remembered-server-choice")
  }
}
