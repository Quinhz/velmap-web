import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const inputPath = path.join(rootDir, 'css', 'tailwind-input.css');
const outputPath = path.join(rootDir, 'css', 'tailwind.css');

export async function buildTailwindCss() {
  const inputCss = fs.readFileSync(inputPath, 'utf8');
  const compiler = await compile(inputCss, {
    base: path.dirname(inputPath),
    onDependency() {},
  });

  const scanner = new Scanner({
    sources: [
      { base: rootDir, pattern: 'index.html', negated: false },
      { base: path.join(rootDir, 'js'), pattern: '**/*.js', negated: false },
    ],
  });

  const candidates = scanner.scan();
  const css = compiler.build(candidates);
  fs.writeFileSync(outputPath, css, 'utf8');
  return { outputPath, candidateCount: candidates.length, bytes: Buffer.byteLength(css, 'utf8') };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  buildTailwindCss()
    .then((res) => {
      console.log(`Built ${path.relative(rootDir, res.outputPath)} (${res.candidateCount} classes, ${res.bytes} bytes)`);
    })
    .catch((err) => {
      console.error('Failed to build Tailwind CSS:', err);
      process.exit(1);
    });
}
