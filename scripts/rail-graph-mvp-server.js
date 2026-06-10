import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const STAGES = new Set([
  'diagnose',
  'extract',
  'emitFast',
  'postFix',
  'match',
  'manifest',
])

const tasks = new Map()

function json(res, status, data) {
  const body = JSON.stringify(data)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function safeAggregatePath(aggregateKey, file) {
  const safeKey = String(aggregateKey || 'default').replace(/[\\/:<>"|?*\x00-\x1f]/g, '_').slice(0, 120) || 'default'
  const safeFile = String(file || '').replace(/\\/g, '/')
  if (!safeFile || safeFile.includes('..') || safeFile.startsWith('/') || safeFile.includes('\x00')) {
    throw new Error('Invalid aggregate file')
  }
  const root = path.resolve('aggregates', safeKey)
  const target = path.resolve(root, safeFile)
  if (!target.startsWith(root + path.sep) && target !== root) {
    throw new Error('Aggregate path escapes aggregate root')
  }
  return target
}

function script(project, name) {
  return path.join(project.scriptsRoot, name)
}

// 关键: 所有 python 调用都用 -u 标志, 强制 stdout/stderr 立即 flush 进 pipe;
// 否则 Python 默认 block-buffer piped stdout, UI 端要等子进程结束才看得到进度.
function buildCommand(stage, project) {
  switch (stage) {
    case 'diagnose':
      return ['python', '-u', script(project, 'diagnose_osm_tags.py'), '--input', project.pbfPath]
    case 'extract':
      return [
        'python', '-u', script(project, 'extract_rail_osm.py'),
        '--input', project.pbfPath,
        '--output-dir', project.osmOutputDir,
        '--cache-db', project.cacheDbPath,
      ]
    case 'emitFast':
      return [
        'python', '-u', script(project, 'emit_geojson_fast.py'),
        '--cache-db', project.cacheDbPath,
        '--output-dir', project.osmOutputDir,
        '--pbf', project.pbfPath,
      ]
    case 'postFix':
      return ['python', '-u', script(project, 'fix_geojson_post.py'), '--input-dir', project.osmOutputDir]
    case 'match':
      return [
        'python', '-u', script(project, 'match_company_lines.py'),
        '--reference', project.referenceGeoJsonPath,
        '--osm-dir', project.osmOutputDir,
        '--output-root', project.matchedOutputRoot,
      ]
    case 'manifest':
      return ['python', '-u', script(project, 'build_match_manifest.py')]
    default:
      throw new Error(`Unsupported stage: ${stage}`)
  }
}

function pushLog(task, text) {
  const lines = String(text).split(/\r?\n/).filter(Boolean)
  task.log.push(...lines)
  if (task.log.length > 1200) {
    task.log.splice(0, task.log.length - 1200)
  }
}

function startTask(stage, project) {
  if (!STAGES.has(stage)) {
    throw new Error(`Unsupported stage: ${stage}`)
  }
  const command = buildCommand(stage, project)
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const task = {
    id,
    stage,
    status: 'running',
    command,
    cwd: project.scriptsRoot,
    startedAt: new Date().toISOString(),
    log: [],
    artifacts: [],
  }
  tasks.set(id, task)

  const child = spawn(command[0], command.slice(1), {
    cwd: project.scriptsRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    // PYTHONUNBUFFERED=1 是 python -u 的双保险, 避免某些子调用/库自己 buffer stdout.
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
  })
  task.child = child
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => pushLog(task, chunk))
  child.stderr.on('data', (chunk) => pushLog(task, chunk))
  child.on('error', (error) => {
    task.status = 'failed'
    task.error = error.message
    task.finishedAt = new Date().toISOString()
    pushLog(task, error.message)
  })
  child.on('close', (code) => {
    if (task.status === 'cancelled') return
    task.exitCode = code ?? undefined
    task.status = code === 0 ? 'succeeded' : 'failed'
    task.finishedAt = new Date().toISOString()
  })

  return sanitizeTask(task)
}

function sanitizeTask(task) {
  const { child, ...publicTask } = task
  return publicTask
}

function fileKind(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.geojson') return 'geojson'
  if (ext === '.json') return 'json'
  if (ext === '.sqlite' || ext === '.db') return 'sqlite'
  if (ext === '.log' || ext === '.txt') return 'log'
  return 'other'
}

function lineDirOf(project) {
  if (project.lineDir) return project.lineDir
  if (project.companyDir && project.lineName) {
    return path.join(project.companyDir, project.lineName)
  }
  return ''
}

function collectArtifacts(project) {
  const lineDir = lineDirOf(project)
  const out = []
  const seen = new Set()

  if (lineDir && fs.existsSync(lineDir) && !seen.has(lineDir)) {
    seen.add(lineDir)
    walk(lineDir, out, 0, 4)
  }

  const shallowRoots = [
    project.osmOutputDir,
    project.overridePath ? path.dirname(project.overridePath) : '',
  ].filter(Boolean)
  for (const root of shallowRoots) {
    if (!root || seen.has(root) || !fs.existsSync(root)) continue
    seen.add(root)
    walk(root, out, 0, 1)
  }

  return out
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .slice(0, 500)
}

function walk(dir, out, depth, maxDepth = 4) {
  if (depth > maxDepth) return
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out, depth + 1, maxDepth)
      continue
    }
    const kind = fileKind(full)
    if (kind === 'other') continue
    const stat = fs.statSync(full)
    out.push({
      path: full,
      name: entry.name,
      kind,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    })
  }
}

export function railGraphMvpServerPlugin() {
  return {
    name: 'rail-graph-mvp-server',
    configureServer(server) {
      server.middlewares.use('/api/rail-graph-mvp', async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://localhost')
          const pathname = url.pathname
          if (req.method === 'POST' && pathname === '/metadata/scan-paths') {
            const body = await readBody(req)
            const settings = body.settings || {}
            const scripts = [
              'diagnose_osm_tags.py',
              'extract_rail_osm.py',
              'emit_geojson_fast.py',
              'fix_geojson_post.py',
              'match_company_lines.py',
              'build_match_manifest.py',
              'plan_line_batches.py',
              'merge_and_build_override.py'
            ]
            const scriptStatus = {}
            let scriptsOk = true
            if (settings.scriptsRoot && fs.existsSync(settings.scriptsRoot)) {
              for (const s of scripts) {
                const present = fs.existsSync(path.join(settings.scriptsRoot, s))
                scriptStatus[s] = present
                if (!present) scriptsOk = false
              }
            } else {
              scriptsOk = false
              for (const s of scripts) scriptStatus[s] = false
            }
            let pbfExists = false
            let pbfSize = 0
            let pbfModTime = ''
            if (settings.pbfPath && fs.existsSync(settings.pbfPath)) {
              pbfExists = true
              const stat = fs.statSync(settings.pbfPath)
              pbfSize = stat.size
              pbfModTime = stat.mtime.toISOString()
            }
            let cacheExists = false
            let cacheSize = 0
            let cacheModTime = ''
            if (settings.cacheDbPath && fs.existsSync(settings.cacheDbPath)) {
              cacheExists = true
              const stat = fs.statSync(settings.cacheDbPath)
              cacheSize = stat.size
              cacheModTime = stat.mtime.toISOString()
            }
            const companyGeoJsons = []
            if (settings.geojsonSourceDir && fs.existsSync(settings.geojsonSourceDir)) {
              try {
                const files = fs.readdirSync(settings.geojsonSourceDir)
                for (const f of files) {
                  if (f.endsWith('.geojson')) {
                    const fullPath = path.join(settings.geojsonSourceDir, f)
                    const stat = fs.statSync(fullPath)
                    companyGeoJsons.push({
                      name: path.basename(f, '.geojson'),
                      path: fullPath,
                      size: stat.size,
                      modifiedAt: stat.mtime.toISOString()
                    })
                  }
                }
              } catch (e) {}
            }
            const companies = []
            if (settings.matchedOutputRoot && fs.existsSync(settings.matchedOutputRoot)) {
              try {
                const dirEntries = fs.readdirSync(settings.matchedOutputRoot, { withFileTypes: true })
                for (const entry of dirEntries) {
                  if (entry.isDirectory()) {
                    const cName = entry.name
                    const cPath = path.join(settings.matchedOutputRoot, cName)
                    const lineEntries = fs.readdirSync(cPath, { withFileTypes: true })
                    const lines = []
                    for (const lEntry of lineEntries) {
                      if (lEntry.isDirectory()) {
                        const lName = lEntry.name
                        const lPath = path.join(cPath, lName)
                        const artifacts = {
                          matchedAssets: fs.existsSync(path.join(lPath, 'matched_assets.geojson')),
                          matchedHigh: fs.existsSync(path.join(lPath, 'matched_high.geojson')),
                          matchReport: fs.existsSync(path.join(lPath, 'match_report.json')),
                        }
                        let matchedAssetsSize = 0
                        if (artifacts.matchedAssets) {
                          matchedAssetsSize = fs.statSync(path.join(lPath, 'matched_assets.geojson')).size
                        }
                        let matchedHighSize = 0
                        if (artifacts.matchedHigh) {
                          matchedHighSize = fs.statSync(path.join(lPath, 'matched_high.geojson')).size
                        }
                        lines.push({
                          name: lName,
                          path: lPath,
                          artifacts,
                          matchedAssetsSize,
                          matchedHighSize,
                        })
                      }
                    }
                    companies.push({
                      name: cName,
                      path: cPath,
                      lines
                    })
                  }
                }
              } catch (e) {}
            }
            json(res, 200, {
              scriptsRoot: {
                exists: fs.existsSync(settings.scriptsRoot || ''),
                ok: scriptsOk,
                files: scriptStatus
              },
              pbf: {
                exists: pbfExists,
                size: pbfSize,
                modifiedAt: pbfModTime
              },
              cacheDb: {
                exists: cacheExists,
                size: cacheSize,
                modifiedAt: cacheModTime
              },
              geojsonSourceDir: {
                exists: fs.existsSync(settings.geojsonSourceDir || ''),
                files: companyGeoJsons
              },
              osmOutputDir: {
                exists: fs.existsSync(settings.osmOutputDir || '')
              },
              matchedOutputRoot: {
                exists: fs.existsSync(settings.matchedOutputRoot || ''),
                companies
              }
            })
            return
          }
          if (req.method === 'POST' && pathname === '/metadata/companies-and-lines') {
            const body = await readBody(req)
            const root = body.matchedOutputRoot
            if (!root || !fs.existsSync(root)) {
              json(res, 200, { companies: [] })
              return
            }
            const companies = []
            try {
              const dirEntries = fs.readdirSync(root, { withFileTypes: true })
              for (const entry of dirEntries) {
                if (entry.isDirectory()) {
                  const cName = entry.name
                  const cPath = path.join(root, cName)
                  const lineEntries = fs.readdirSync(cPath, { withFileTypes: true })
                  const lines = []
                  for (const lEntry of lineEntries) {
                    if (lEntry.isDirectory()) {
                      lines.push(lEntry.name)
                    }
                  }
                  companies.push({
                    name: cName,
                    lines
                  })
                }
              }
            } catch (e) {}
            json(res, 200, { companies })
            return
          }
          if (req.method === 'POST' && pathname === '/metadata/line-artifacts') {
            const body = await readBody(req)
            const lineDir = body.lineDir
              || (body.companyDir && body.lineName ? path.join(body.companyDir, body.lineName) : '')
            const stat = (file) => {
              const p = path.join(lineDir, file)
              if (!fs.existsSync(p)) return { exists: false, path: p, size: 0, modifiedAt: '' }
              const s = fs.statSync(p)
              return { exists: true, path: p, size: s.size, modifiedAt: s.mtime.toISOString() }
            }
            if (!lineDir || !fs.existsSync(lineDir)) {
              json(res, 200, {
                lineDir,
                exists: false,
                matchedAssets: { exists: false, path: '', size: 0, modifiedAt: '' },
                matchedHigh: { exists: false, path: '', size: 0, modifiedAt: '' },
                matchedMedium: { exists: false, path: '', size: 0, modifiedAt: '' },
                matchedLow: { exists: false, path: '', size: 0, modifiedAt: '' },
                matchReport: { exists: false, path: '', size: 0, modifiedAt: '' },
              })
              return
            }
            json(res, 200, {
              lineDir,
              exists: true,
              matchedAssets: stat('matched_assets.geojson'),
              matchedHigh: stat('matched_high.geojson'),
              matchedMedium: stat('matched_medium.geojson'),
              matchedLow: stat('matched_low.geojson'),
              matchReport: stat('match_report.json'),
            })
            return
          }
          if (req.method === 'POST' && pathname === '/tasks') {
            const body = await readBody(req)
            const task = startTask(body.stage, body.project)
            json(res, 200, task)
            return
          }
          const taskMatch = pathname.match(/^\/tasks\/([^/]+)$/)
          if (req.method === 'GET' && taskMatch) {
            const task = tasks.get(taskMatch[1])
            if (!task) {
              json(res, 404, { error: 'Task not found' })
              return
            }
            json(res, 200, sanitizeTask(task))
            return
          }
          const cancelMatch = pathname.match(/^\/tasks\/([^/]+)\/cancel$/)
          if (req.method === 'POST' && cancelMatch) {
            const task = tasks.get(cancelMatch[1])
            if (!task) {
              json(res, 404, { error: 'Task not found' })
              return
            }
            if (task.child && task.status === 'running') {
              task.status = 'cancelled'
              task.finishedAt = new Date().toISOString()
              task.child.kill()
            }
            json(res, 200, sanitizeTask(task))
            return
          }
          if (req.method === 'POST' && pathname === '/artifacts') {
            const body = await readBody(req)
            json(res, 200, collectArtifacts(body.project))
            return
          }
          if (req.method === 'POST' && pathname === '/artifact/read') {
            const body = await readBody(req)
            if (!body.path || typeof body.path !== 'string') {
              json(res, 400, { error: 'Missing artifact path' })
              return
            }
            const text = fs.readFileSync(body.path, 'utf8')
            json(res, 200, JSON.parse(text))
            return
          }
          // 保存与读取手动清理覆盖 / Save and read manual cleaning overrides
          if (req.method === 'POST' && pathname === '/overrides/save') {
            const body = await readBody(req)
            if (!body.path || typeof body.path !== 'string' || !body.override) {
              json(res, 400, { error: 'Missing override path or override object' })
              return
            }
            fs.mkdirSync(path.dirname(body.path), { recursive: true })
            fs.writeFileSync(body.path, JSON.stringify(body.override, null, 2), 'utf8')
            json(res, 200, { ok: true })
            return
          }
          if (req.method === 'POST' && pathname === '/overrides/read') {
            const body = await readBody(req)
            if (!body.path || typeof body.path !== 'string') {
              json(res, 400, { error: 'Missing override path' })
              return
            }
            if (fs.existsSync(body.path)) {
              try {
                const content = JSON.parse(fs.readFileSync(body.path, 'utf8'))
                json(res, 200, content)
                return
              } catch (e) {}
            }
            json(res, 200, { remove: [], keep: [], meta: {} })
            return
          }
          if (req.method === 'POST' && pathname === '/fixture/export') {
            const body = await readBody(req)
            const { filename, featureCollection } = body
            if (!filename || !featureCollection) {
              json(res, 400, { error: 'Missing filename or featureCollection' })
              return
            }
            const safe = String(filename).replace(/[\\/:<>"|?*\x00-\x1f]/g, '')
            if (!safe || safe.length > 200) {
              json(res, 400, { error: 'Invalid filename' })
              return
            }
            const fixtureDir = path.resolve('src', 'rail-graph-v1-mvp', 'fixtures')
            fs.mkdirSync(fixtureDir, { recursive: true })
            const outPath = path.join(fixtureDir, safe)
            fs.writeFileSync(outPath, JSON.stringify(featureCollection, null, 2), 'utf8')
            json(res, 200, { ok: true, path: outPath, features: featureCollection.features?.length ?? 0 })
            return
          }
          if (req.method === 'POST' && pathname === '/workspace/seed-source') {
            const body = await readBody(req)
            const { projectKey, sourceGeoJsonPath, featureCollection, geojsonSourceDir, matchedOutputRoot } = body

            if (!sourceGeoJsonPath || !featureCollection) {
              json(res, 400, { error: 'Missing sourceGeoJsonPath or featureCollection' })
              return
            }

            const resolvedPath = path.resolve(sourceGeoJsonPath)
            const allowedDirs = [
              path.resolve(geojsonSourceDir || 'D:\\GIS\\geojson_source'),
              path.resolve(matchedOutputRoot || 'D:\\GIS\\matched_by_company'),
            ]
            const allowed = allowedDirs.some(dir => resolvedPath.startsWith(dir))
            if (!allowed) {
              json(res, 403, { error: 'Access denied: Target path must be within geojsonSourceDir or matchedOutputRoot' })
              return
            }

            fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })
            fs.writeFileSync(resolvedPath, JSON.stringify(featureCollection, null, 2), 'utf8')
            json(res, 200, { ok: true })
            return
          }
          json(res, 404, { error: 'Unknown rail graph MVP API route' })
        } catch (error) {
          json(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      })
      server.middlewares.use('/api/rail-graph-aggregate', async (req, res) => {
        try {
          const url = new URL(req.url || '/', 'http://localhost')
          const pathname = url.pathname
          if (req.method === 'POST' && pathname === '/read') {
            const body = await readBody(req)
            const filePath = safeAggregatePath(body.aggregateKey, body.file)
            if (!fs.existsSync(filePath)) {
              json(res, 404, { error: 'Aggregate file not found' })
              return
            }
            json(res, 200, JSON.parse(fs.readFileSync(filePath, 'utf8')))
            return
          }
          if (req.method === 'POST' && pathname === '/write') {
            const body = await readBody(req)
            const filePath = safeAggregatePath(body.aggregateKey, body.file)
            fs.mkdirSync(path.dirname(filePath), { recursive: true })
            fs.writeFileSync(filePath, JSON.stringify(body.data, null, 2), 'utf8')
            json(res, 200, { ok: true, path: filePath })
            return
          }
          json(res, 404, { error: 'Unknown rail graph aggregate API route' })
        } catch (error) {
          json(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      })
    },
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  console.log('railGraphMvpServerPlugin is a Vite plugin and is not meant to be run directly.')
}
