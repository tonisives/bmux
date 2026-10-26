import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

let execute = promisify(execFile)
let harnessPaths = new Set([
  '.github/workflows/remote-app.yml',
  '.github/workflows/remote-chooser.yml',
  'remote-app/README.md',
  'remote-app/scripts/add-ios-launcher-tests.rb',
  'remote-app/scripts/ios-launcher-smoke.mjs',
  'remote-app/scripts/ios-launcher-tests.swift',
  'remote-app/scripts/verify-ios-reused-app.mjs',
  'tests/fixtures/remote-workspace-main.ts',
  'tests/remote-workspace.electron.test.ts',
])

export let verifyReusedChanges = changed => {
  let productChanges = changed.filter(file => !harnessPaths.has(file) && !file.startsWith('docs/') && !['README.md', 'AGENTS.md'].includes(file))
  assert.deepEqual(productChanges, [], 'Retained app reuse requires unchanged product, configuration, dependencies and runtime inputs')
}

let iosBuildJob = workflow => {
  let lines = workflow.split('\n')
  let start = lines.indexOf('  ios:')
  assert.ok(start >= 0, 'The source workflow must contain its native iOS build job')
  let end = lines.findIndex((line, index) => index > start && /^  [\w-]+:$/.test(line))
  return lines.slice(start, end < 0 ? undefined : end).filter(line => line !== '    if: ${{ !inputs.retained_app_run }}' && !line.startsWith('    timeout-minutes:')).join('\n').trimEnd()
}

let repairExecutables = async folder => {
  let machO = new Set(['cffaedfe', 'feedfacf', 'cefaedfe', 'feedface', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'])
  for (let entry of await readdir(folder, { withFileTypes: true })) {
    let file = path.join(folder, entry.name)
    if (entry.isDirectory()) await repairExecutables(file)
    else if (entry.isFile()) {
      let handle = await open(file, 'r')
      let header = Buffer.alloc(4)
      try { await handle.read(header, 0, 4, 0) } finally { await handle.close() }
      if (machO.has(header.toString('hex'))) await chmod(file, (await stat(file)).mode | 0o111)
    }
  }
}

let main = async () => {
  let runId = process.argv[2] ?? process.env.BMUX_RETAINED_APP_RUN
  assert.match(runId ?? '', /^\d+$/)
  let repository = process.env.GITHUB_REPOSITORY ?? 'tonisives/bmux'
  let api = async route => JSON.parse((await execute('gh', ['api', `repos/${repository}/${route}`], { maxBuffer: 8 * 1024 * 1024 })).stdout)
  let run = await api(`actions/runs/${runId}`)
  assert.equal(run.path, '.github/workflows/remote-app.yml')
  assert.equal(run.head_repository.full_name, repository)
  assert.match(run.head_sha, /^[a-f0-9]{40}$/)
  await execute('git', ['fetch', '--no-tags', '--depth=1', 'origin', run.head_sha])
  let target = (await execute('git', ['rev-parse', 'HEAD'])).stdout.trim()
  if (process.env.GITHUB_SHA) assert.equal(target, process.env.GITHUB_SHA)
  let changed = (await execute('git', ['diff', '--name-only', run.head_sha, target])).stdout.trim().split('\n').filter(Boolean)
  verifyReusedChanges(changed)
  let sourceJob = iosBuildJob((await execute('git', ['show', `${run.head_sha}:.github/workflows/remote-app.yml`])).stdout)
  let targetJob = iosBuildJob((await execute('git', ['show', `${target}:.github/workflows/remote-app.yml`])).stdout)
  assert.equal(sourceJob, targetJob, 'The retained native build configuration must match')
  let { jobs } = await api(`actions/runs/${runId}/jobs?per_page=100`)
  let job = jobs.find(value => value.name === 'ios (Debug)')
  assert.equal(job?.status, 'completed')
  let compile = job.steps.find(step => step.name.startsWith('Run xcodebuild -workspace ios/bmuxremote.xcworkspace -scheme bmuxremote -configuration Debug '))
  let startup = job.steps.find(step => step.name === 'Run pnpm smoke:ios')
  assert.equal(compile?.conclusion, 'success')
  assert.equal(startup?.conclusion, 'success')
  let { artifacts } = await api(`actions/runs/${runId}/artifacts?per_page=100`)
  let artifact = artifacts.find(value => value.name === 'remote-app-ios-development-simulator')
  assert.ok(artifact && !artifact.expired)
  assert.equal(artifact.workflow_run.head_sha, run.head_sha)
  assert.equal(artifact.workflow_run.id, Number(runId))
  assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/)
  let archive = (await execute('gh', ['api', `repos/${repository}/actions/artifacts/${artifact.id}/zip`], { encoding: 'buffer', maxBuffer: artifact.size_in_bytes + 1024 * 1024, timeout: 180_000 })).stdout
  let digest = `sha256:${createHash('sha256').update(archive).digest('hex')}`
  assert.equal(digest, artifact.digest, 'The downloaded artifact must match its recorded digest')
  await mkdir('ios', { recursive: true })
  await writeFile('ios/retained-app.zip', archive)
  let products = 'ios/build/Build/Products/Debug-iphonesimulator'
  await mkdir(products, { recursive: true })
  await execute('ditto', ['-x', '-k', 'ios/retained-app.zip', products])
  let app = path.join(products, 'bmuxremote.app')
  let info = JSON.parse((await execute('plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Info.plist')])).stdout)
  assert.equal(info.CFBundleIdentifier, 'cc.bmux.remote')
  assert.equal(info.DTPlatformName, 'iphonesimulator')
  assert.equal(info.CFBundleExecutable, path.basename(info.CFBundleExecutable))
  await repairExecutables(app)
  let hashes = {}
  for (let file of [info.CFBundleExecutable, `${info.CFBundleExecutable}.debug.dylib`]) {
    hashes[file] = createHash('sha256').update(await readFile(path.join(app, file))).digest('hex')
  }
  let proof = {
    checkedAt: new Date().toISOString(), sourceRun: Number(runId), sourceUrl: run.html_url,
    sourceSha: run.head_sha, targetSha: target, sourceJob: job.id, sourceJobConclusion: job.conclusion,
    nativeCompile: compile.conclusion, nativeStartup: startup.conclusion,
    unchangedNativeBuildJobSha256: createHash('sha256').update(sourceJob).digest('hex'),
    buildJobNormalization: ['dispatch routing condition', 'job timeout budget'],
    allowedHarnessChanges: changed, productChanges: [], artifactId: artifact.id,
    artifactDigest: artifact.digest, downloadedDigest: digest, executableHashes: hashes,
    bundleIdentifier: info.CFBundleIdentifier, sdk: info.DTSDKName, executableModesRestored: true,
  }
  await mkdir('ios-smoke', { recursive: true })
  await writeFile('ios-smoke/reused-app-provenance.json', JSON.stringify(proof, null, 2))
  console.log(JSON.stringify(proof, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main()
