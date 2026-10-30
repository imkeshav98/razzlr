import { writeDriftReport } from './report.ts'

export default function globalTeardown() {
  writeDriftReport()
}
