import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // Session worktrees keep their own copy of __tests__, but `@/lib` resolves
  // to this checkout — so collecting them runs stale tests against current
  // source and fails on changes they predate.
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/.claude/worktrees/'],
}

export default createJestConfig(config)
