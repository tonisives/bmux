import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'

// Keep the error in CI logs even if a later test or worker teardown hangs.
export default class FailureReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === test.expectedStatus || result.status === 'skipped') return
    console.error(`Test ${result.status}: ${test.titlePath().join(' > ')}`)
    for (let error of result.errors) console.error(error.stack ?? error.message ?? error.value)
  }
}
