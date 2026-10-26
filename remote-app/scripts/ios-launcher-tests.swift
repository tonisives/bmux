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
    XCUIDevice.shared.orientation = .portrait
    app.launchArguments = ["-EXDevMenuIsOnboardingFinished", "1", "-EXDevMenuShowsAtLaunch", "0"]
  }

  private func capture(_ name: String) {
    let image = XCTAttachment(screenshot: app.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
  }

  private func orient(landscape: Bool) {
    XCUIDevice.shared.orientation = landscape ? .landscapeLeft : .portrait
    let layout = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      let frame = self.app.windows.firstMatch.frame
      return landscape ? frame.width > frame.height : frame.height > frame.width
    }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [layout], timeout: 15), .completed)
  }

  private func assertPageOnly() {
    XCTAssertTrue(app.buttons["Page details"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["Open Docs"].exists)
    XCTAssertFalse(app.buttons["Attention, 0 pending"].exists)
    XCTAssertEqual(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@ OR label == %@", "Settings", "Search")).count, 0)
  }

  override func tearDownWithError() throws {
    capture("launcher-final-state")
    let hierarchy = XCTAttachment(string: app.debugDescription)
    hierarchy.lifetime = .keepAlways
    add(hierarchy)
    app.terminate()
    XCUIDevice.shared.orientation = .portrait
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
    app.buttons["Demo"].tap()
    XCTAssertTrue(app.buttons["Open Docs"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["Open Notes"].exists)
    XCTAssertTrue(app.buttons["Attention, 0 pending"].exists)
    capture("04-demo-list")
    app.buttons["Open Docs"].tap()
    assertPageOnly()
    capture("05-demo-page")
    app.buttons["Page details"].tap()
    XCTAssertTrue(app.staticTexts["Watch"].waitForExistence(timeout: 10))
    capture("06-demo-page-details")
    app.buttons["Close"].tap()
    XCTAssertTrue(app.staticTexts["Watch"].waitForNonExistence(timeout: 10))
    orient(landscape: true)
    assertPageOnly()
    capture("07-demo-page-landscape")
    orient(landscape: false)
    app.terminate()
    app.launch()

    XCTAssertTrue(serverEntries(localURL).firstMatch.waitForExistence(timeout: 30))
    XCTAssertTrue(serverEntries(remoteURL).firstMatch.exists)
    XCTAssertEqual(serverEntries(remoteURL).count, initialRemoteEntries)
    XCTAssertTrue(manualEntry.exists)
    capture("08-remembered-server-choice")
  }
}
