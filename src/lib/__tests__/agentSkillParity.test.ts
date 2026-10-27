import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const REPO_ROOT = path.resolve(__dirname, '../../..')
const SKILL_PATH = path.join(REPO_ROOT, 'public/agent-skill/repertoire-hero/SKILL.md')
const API_V1_DIR = path.join(REPO_ROOT, 'src/app/api/v1')

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const
type HttpMethod = (typeof HTTP_METHODS)[number]

interface DiscoveredRoute {
  method: HttpMethod
  endpoint: string
  filePath: string
}

export function discoverApiRoutes(dir: string = API_V1_DIR): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = []

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.name === 'route.ts') {
        const content = fs.readFileSync(fullPath, 'utf8')
        const relPath = path.relative(path.join(REPO_ROOT, 'src/app'), path.dirname(fullPath))
        // Convert [param] to {param}
        const endpoint = '/' + relPath.replace(/\[([^\]]+)\]/g, '{$1}')

        for (const method of HTTP_METHODS) {
          const exportRegex = new RegExp(`export\\s+const\\s+${method}\\b|export\\s+async\\s+function\\s+${method}\\b`)
          if (exportRegex.test(content)) {
            routes.push({
              method,
              endpoint,
              filePath: fullPath,
            })
          }
        }
      }
    }
  }

  walk(dir)
  return routes
}

export function parseSkillHeadings(skillContent: string): Array<{ method: string; endpoint: string }> {
  const headings: Array<{ method: string; endpoint: string }> = []
  const headingRegex = /^#+\s+(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/v1\S*)/gm
  let match: RegExpExecArray | null
  while ((match = headingRegex.exec(skillContent)) !== null) {
    headings.push({
      method: match[1],
      endpoint: match[2],
    })
  }
  return headings
}

describe('agentSkillParity', () => {
  it('serves the skill file with valid frontmatter and security rules', () => {
    expect(fs.existsSync(SKILL_PATH), `${SKILL_PATH} must exist`).toBe(true)
    const content = fs.readFileSync(SKILL_PATH, 'utf8')

    // Frontmatter check
    expect(content).toMatch(/^---\n([\s\S]*?)\n---/)
    expect(content).toMatch(/name:\s*repertoire-hero/)
    expect(content).toMatch(/description:\s*.+/)

    // Token mentions
    expect(content).toContain('REPERTOIRE_HERO_TOKEN')
    expect(content).toContain('REPERTOIRE_HERO_URL')

    // Contains no rh_pat_ literal longer than the 7-character prefix
    // Matches rh_pat_ followed by 4 or more alphanumeric/base64url chars (excluding dots/placeholders)
    const patLiterals = content.match(/rh_pat_[A-Za-z0-9_-]{4,}/g) ?? []
    expect(patLiterals).toEqual([])
  })

  it('matches every exported /api/v1 route to a skill heading and vice-versa', () => {
    const skillContent = fs.readFileSync(SKILL_PATH, 'utf8')
    const discovered = discoverApiRoutes()
    expect(discovered.length).toBeGreaterThan(0)

    const skillHeadings = parseSkillHeadings(skillContent)
    expect(skillHeadings.length).toBe(discovered.length)

    // Check every discovered route has a heading
    for (const route of discovered) {
      const match = skillHeadings.find(
        (h) => h.method === route.method && h.endpoint === route.endpoint,
      )
      expect(
        match,
        `Expected heading "${route.method} ${route.endpoint}" in SKILL.md for route in ${route.filePath}`,
      ).toBeDefined()
    }

    // Check every skill heading names an existing route
    for (const heading of skillHeadings) {
      const match = discovered.find(
        (r) => r.method === heading.method && r.endpoint === heading.endpoint,
      )
      expect(
        match,
        `SKILL.md heading "${heading.method} ${heading.endpoint}" does not match any route in src/app/api/v1`,
      ).toBeDefined()
    }
  })

  it('fails parity check when a route is missing from the skill', () => {
    // Incomplete skill content missing POST /api/v1/tabs
    const incompleteSkill = '### GET /api/v1/songs\n### GET /api/v1/songs/{versionId}\n'
    const headings = parseSkillHeadings(incompleteSkill)
    const discovered = discoverApiRoutes()

    const missing = discovered.filter(
      (r) => !headings.some((h) => h.method === r.method && h.endpoint === r.endpoint),
    )
    expect(missing.length).toBeGreaterThan(0)
    expect(missing.some((r) => r.endpoint === '/api/v1/tabs')).toBe(true)
  })
})
