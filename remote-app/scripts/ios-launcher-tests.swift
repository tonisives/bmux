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
    app.launchArguments = ["-EXDevMenuIsOnboardingFinished", "1", "-EXDevMenuShowsAtLaunch", "0", "-EXDevMenuShowFloatingActionButton", "0"]
  }

  private func capture(_ name: String) {
    let image = XCTAttachment(screenshot: app.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
    let hierarchy = XCTAttachment(string: app.debugDescription)
    hierarchy.name = name + "-hierarchy"
    hierarchy.lifetime = .keepAlways
    add(hierarchy)
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

  private func waitForPageLayout(landscape: Bool) {
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      let page = self.app.descendants(matching: .any).matching(identifier: "demo-browser-page").firstMatch
      guard page.exists else { return false }
      let window = self.app.windows.firstMatch.frame, frame = page.frame
      let inset = max(0, frame.minX - window.minX)
      return (window.width > window.height) == landscape
        && abs(frame.width - (window.width - 2 * inset)) <= 2
        && frame.width >= window.width * 0.8
        && frame.height >= window.height * 0.65
        && frame.maxY <= window.maxY + 1
    }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed, "The browser page must fill the rotated window before capture")
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

    let loaded = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      self.app.buttons["Sign in with Google"].exists || self.app.staticTexts["Error loading app"].exists
    }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [loaded], timeout: 180), .completed)
    if app.staticTexts["Error loading app"].exists { capture("03-metro-load-failure") }
    XCTAssertFalse(app.staticTexts["Error loading app"].exists, "The native chooser could not reach the disposable Metro server; see the failure capture and Metro health log")
    let signInReady = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      let button = self.app.buttons["Sign in with Google"]
      return button.exists && button.isEnabled && button.isHittable
    }, object: nil)
    XCTAssertEqual(XCTWaiter.wait(for: [signInReady], timeout: 10), .completed)
    XCTAssertTrue(app.buttons["Demo"].exists)
    capture("03-metro-welcome")
    app.buttons["Demo"].tap()
    XCTAssertTrue(app.buttons["Open Docs"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["Open Notes"].exists)
    XCTAssertTrue(app.buttons["Attention, 0 pending"].exists)
    capture("04-demo-list")
    app.buttons["Open Docs"].tap()
    assertPageOnly()
    waitForPageLayout(landscape: false)
    capture("05-demo-page")
    app.buttons["Page details"].tap()
    XCTAssertTrue(app.staticTexts["Watch"].waitForExistence(timeout: 10))
    capture("06-demo-page-details")
    app.buttons["Close"].tap()
    XCTAssertTrue(app.staticTexts["Watch"].waitForNonExistence(timeout: 10))
    orient(landscape: true)
    assertPageOnly()
    waitForPageLayout(landscape: true)
    capture("07-demo-page-landscape")
    orient(landscape: false)
    waitForPageLayout(landscape: false)
    app.terminate()
    app.launch()

    XCTAssertTrue(serverEntries(localURL).firstMatch.waitForExistence(timeout: 30))
    XCTAssertTrue(serverEntries(remoteURL).firstMatch.exists)
    XCTAssertEqual(serverEntries(remoteURL).count, initialRemoteEntries)
    XCTAssertTrue(manualEntry.exists)
    capture("08-remembered-server-choice")
  }
}
