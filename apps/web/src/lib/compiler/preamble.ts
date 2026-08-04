import fs from "fs/promises";
import path from "path";

/**
 * Map of LaTeX command/environment patterns to required packages.
 * Each entry is [regex, packageName].
 */
const PACKAGE_RULES: [RegExp, string][] = [
  // amsmath
  [/\\binom\b/, "amsmath"],
  [/\\tfrac\b/, "amsmath"],
  [/\\dfrac\b/, "amsmath"],
  [/\\operatorname\b/, "amsmath"],
  [/\\DeclareMathOperator\b/, "amsmath"],
  [/\\intertext\b/, "amsmath"],
  [/\\text\s*\{/, "amsmath"],
  [/\\begin\s*\{align\*?\}/, "amsmath"],
  [/\\begin\s*\{gather\*?\}/, "amsmath"],
  [/\\begin\s*\{multline\*?\}/, "amsmath"],
  [/\\begin\s*\{equation\*\}/, "amsmath"],
  [/\\begin\s*\{split\}/, "amsmath"],
  [/\\begin\s*\{aligned\}/, "amsmath"],
  [/\\begin\s*\{gathered\}/, "amsmath"],

  // amssymb
  [/\\mathbb\b/, "amssymb"],
  [/\\mathfrak\b/, "amssymb"],

  // amsthm
  [/\\begin\s*\{theorem\}/, "amsthm"],
  [/\\begin\s*\{lemma\}/, "amsthm"],
  [/\\begin\s*\{proof\}/, "amsthm"],
  [/\\theoremstyle\b/, "amsthm"],

  // hyperref
  [/\\url\s*\{/, "hyperref"],
  [/\\href\s*\{/, "hyperref"],
];

/**
 * Strip %-comments from a line (respecting escaped \%).
 */
function stripComment(line: string): string {
  let i = 0;
  while (i < line.length) {
    if (line[i] === "%" && (i === 0 || line[i - 1] !== "\\")) {
      return line.slice(0, i);
    }
    i++;
  }
  return line;
}

/**
 * Extract the set of packages already loaded via \usepackage in the preamble.
 */
function findLoadedPackages(preamble: string): Set<string> {
  const loaded = new Set<string>();
  // Match \usepackage[...]{pkg1,pkg2,...} or \usepackage{pkg1,pkg2,...}
  const re = /\\usepackage\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(preamble)) !== null) {
    for (const pkg of m[1].split(",")) {
      loaded.add(pkg.trim());
    }
  }
  return loaded;
}

/**
 * Scan a .tex source and inject missing \usepackage declarations into the
 * preamble of the build copy. Returns the (possibly modified) source.
 */
export function injectMissingPackagesInSource(source: string): string {
  const docClassMatch = source.match(/\\documentclass\b/);
  const beginDocMatch = source.match(/\\begin\s*\{document\}/);
  if (!docClassMatch || !beginDocMatch) {
    // Not a standard LaTeX document — skip
    return source;
  }

  const beginDocIndex = source.indexOf(beginDocMatch[0]);

  // Extract preamble (between \documentclass and \begin{document}), stripping comments
  const preambleRaw = source.slice(docClassMatch.index!, beginDocIndex);
  const preambleStripped = preambleRaw
    .split("\n")
    .map(stripComment)
    .join("\n");

  const loadedPackages = findLoadedPackages(preambleStripped);

  // Scan the full file (with comments stripped) for command usage
  const fullStripped = source
    .split("\n")
    .map(stripComment)
    .join("\n");

  const needed = new Set<string>();
  for (const [pattern, pkg] of PACKAGE_RULES) {
    if (loadedPackages.has(pkg)) continue;
    if (pattern.test(fullStripped)) {
      needed.add(pkg);
    }
  }

  if (needed.size === 0) {
    return source;
  }

  // amssymb loads amsmath implicitly, so if both are needed only inject amssymb
  // (amsmath is a dependency of amssymb in TeX Live)
  // Actually amssymb does NOT load amsmath — they are independent. Keep both.

  const injections = Array.from(needed)
    .sort()
    .map((pkg) => `\\usepackage{${pkg}}`)
    .join("\n");

  // Insert just before \begin{document}
  const before = source.slice(0, beginDocIndex);
  const after = source.slice(beginDocIndex);

  return `${before}${injections}\n${after}`;
}

/**
 * Scan the main .tex file in the build directory and inject missing packages
 * into the build copy. The original project files are never touched.
 */
export async function injectMissingPackages(
  buildDir: string,
  mainFile: string
): Promise<void> {
  const filePath = path.join(buildDir, mainFile);

  let source: string;
  try {
    source = await fs.readFile(filePath, "utf-8");
  } catch {
    // File doesn't exist or can't be read — nothing to do
    return;
  }

  const patched = injectMissingPackagesInSource(source);
  if (patched !== source) {
    await fs.writeFile(filePath, patched, "utf-8");
  }
}
