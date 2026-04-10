import { MACRO } from '../constants/macros'

function hasFlag(...flags: string[]): boolean {
  return process.argv.some(arg => flags.includes(arg))
}

if (hasFlag('--version', '-v')) {
  process.stdout.write(`${MACRO.VERSION || ''}\n`)
  process.exit(0)
}

if (hasFlag('--help-lite')) {
  process.stdout.write(
    `Usage: cpaper [options] [command] [prompt]\n\n` +
      `Common options:\n` +
      `  -h, --help           Show full help\n` +
      `  -v, --version        Show version\n` +
      `  -p, --print          Print response and exit (non-interactive)\n` +
      `  -c, --cwd <cwd>      Set working directory\n`,
  )
  process.exit(0)
}

if (hasFlag('--acp')) {
  await import('./acp.js')
} else if (hasFlag('--web')) {
  await import('./web.js')
} else {
  await import('./cli.js')
}
