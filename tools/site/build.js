// Builds what the repo's page (docs/, served by GitHub Pages) runs: the
// scenes bundled for a browser, and the synth as it is.
//   bun tools/site/build.js
const { copyFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..', '..')

Bun.build({
  entrypoints: [join(__dirname, 'entry.ts')],
  outdir: join(ROOT, 'docs'),
  naming: 'scenes.js',
  format: 'iife',
  minify: true,
}).then(built => {
  if (!built.success) {
    console.error(built.logs.join('\n'))
    process.exit(1)
  }

  copyFileSync(join(ROOT, 'tools', 'sound', 'synth.js'), join(ROOT, 'docs', 'synth.js'))
  console.log('docs/scenes.js and docs/synth.js written')
})
