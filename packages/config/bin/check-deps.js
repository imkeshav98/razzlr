#!/usr/bin/env node
// Fails when a workspace dependency points the wrong way (ADR-0001).
import { checkRepo } from '../src/dependency-direction.ts'

const violations = checkRepo(process.cwd())
for (const v of violations) console.error(`✗ ${v}`)
if (violations.length > 0) process.exit(1)
console.log('Dependency direction OK')
