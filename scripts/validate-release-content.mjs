import fs from "node:fs";
import path from "node:path";

const SUPPORTED_LOCALES = ["zh-cn", "en", "ja-jp", "zh-tw"];
const DEFAULT_LOCALE = "zh-cn";

const strictLocales =
  process.argv.includes("--strict-locales") ||
  process.env.RELEASE_STRICT_LOCALES === "1";

const rootDir = process.cwd();
const changelogPath = path.join(rootDir, "public", "changelog.json");
const blogContentDir = path.join(rootDir, "blog", "src", "content", "blog");

function normalizeVersion(version) {
  if (version === null || version === undefined) return "";
  return String(version).trim().replace(/^v/i, "");
}

function parseVersionParts(version) {
  const normalized = normalizeVersion(version);
  if (!normalized) return [0];
  return normalized.split(".").map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isNaN(value) ? 0 : value;
  });
}

function compareVersions(a, b) {
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);
  const maxLen = Math.max(left.length, right.length);
  for (let i = 0; i < maxLen; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractFrontmatterVersion(sourceText) {
  const frontmatterMatch = sourceText.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch) return "";
  const versionMatch = frontmatterMatch[1].match(
    /^version:\s*["']?([^"'#\r\n]+)["']?/m,
  );
  return normalizeVersion(versionMatch?.[1] ?? "");
}

function expectedBlogPath(version, locale) {
  return `blog/src/content/blog/${locale}/v${version}.mdx`;
}

function printIssues(title, issues) {
  if (issues.length === 0) return;
  console.error(`\n${title}`);
  issues.forEach((msg, idx) => {
    console.error(`  ${idx + 1}. ${msg}`);
  });
}

function main() {
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(changelogPath)) {
    console.error(`[release-check] Missing file: ${changelogPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(blogContentDir)) {
    console.error(`[release-check] Missing directory: ${blogContentDir}`);
    process.exit(1);
  }

  const changelog = JSON.parse(fs.readFileSync(changelogPath, "utf8"));
  const logs = Array.isArray(changelog.logs) ? changelog.logs : [];
  if (logs.length === 0) {
    errors.push("`public/changelog.json` has no `logs` entries.");
  }

  const currentVersion =
    normalizeVersion(process.env.RELEASE_ENFORCE_FROM) ||
    normalizeVersion(changelog?.meta?.currentVersion) ||
    normalizeVersion(logs[0]?.version);

  if (!currentVersion) {
    errors.push(
      "Cannot determine `enforceFromVersion`. Set `meta.currentVersion` or `RELEASE_ENFORCE_FROM`.",
    );
  }

  const changelogVersions = [];
  const changelogSeen = new Set();
  for (const log of logs) {
    const version = normalizeVersion(log?.version);
    if (!version) {
      errors.push(`Found changelog item with empty version: ${JSON.stringify(log)}`);
      continue;
    }
    if (changelogSeen.has(version)) {
      errors.push(`Duplicate changelog version: v${version}`);
    }
    changelogSeen.add(version);
    changelogVersions.push(version);
  }

  const blogFiles = walkFiles(blogContentDir).filter((filePath) =>
    /(^|[/\\])v[0-9]+(?:\.[0-9]+)*\.mdx$/i.test(filePath),
  );

  const blogVersionLocaleMap = new Map();
  const blogVersionAllLocales = new Map();
  for (const filePath of blogFiles) {
    const relative = path.relative(blogContentDir, filePath).replace(/\\/g, "/");
    const segments = relative.split("/");
    const locale = segments[0]?.toLowerCase();
    const fileName = segments[segments.length - 1];
    const fileVersion = normalizeVersion(fileName.replace(/\.mdx$/i, ""));

    if (!SUPPORTED_LOCALES.includes(locale)) {
      warnings.push(`Skip unknown locale file: ${relative}`);
      continue;
    }

    const versionLocaleKey = `${fileVersion}::${locale}`;
    if (blogVersionLocaleMap.has(versionLocaleKey)) {
      errors.push(
        `Duplicate blog page for version v${fileVersion} locale ${locale}: ${relative} and ${blogVersionLocaleMap.get(versionLocaleKey)}`,
      );
    } else {
      blogVersionLocaleMap.set(versionLocaleKey, relative);
    }

    if (!blogVersionAllLocales.has(fileVersion)) {
      blogVersionAllLocales.set(fileVersion, new Set());
    }
    blogVersionAllLocales.get(fileVersion).add(locale);

    const content = fs.readFileSync(filePath, "utf8");
    const frontmatterVersion = extractFrontmatterVersion(content);
    if (!frontmatterVersion) {
      errors.push(`Missing frontmatter version in blog page: ${relative}`);
    } else if (frontmatterVersion !== fileVersion) {
      errors.push(
        `Frontmatter version mismatch in ${relative}: file is v${fileVersion}, frontmatter is v${frontmatterVersion}`,
      );
    }
  }

  if (currentVersion) {
    for (const version of changelogVersions) {
      if (compareVersions(version, currentVersion) < 0) {
        continue;
      }

      const locales = blogVersionAllLocales.get(version) ?? new Set();
      if (!locales.has(DEFAULT_LOCALE)) {
        errors.push(
          `Missing required blog page for changelog version v${version} in locale ${DEFAULT_LOCALE} (expected: ${expectedBlogPath(version, DEFAULT_LOCALE)})`,
        );
      }

      const missingExtraLocales = SUPPORTED_LOCALES.filter(
        (loc) => loc !== DEFAULT_LOCALE && !locales.has(loc),
      );
      if (missingExtraLocales.length > 0) {
        const missingLocaleDetails = missingExtraLocales
          .map((loc) => `${loc} (expected: ${expectedBlogPath(version, loc)})`)
          .join(", ");
        const message = `Changelog version v${version} is missing localized blog pages: ${missingLocaleDetails}`;
        if (strictLocales) {
          errors.push(message);
        } else {
          warnings.push(message);
        }
      }
    }
  }

  printIssues("[release-check] Warnings", warnings);
  printIssues("[release-check] Errors", errors);

  if (errors.length > 0) {
    console.error("\n[release-check] FAILED");
    process.exit(1);
  }

  console.log(
    `[release-check] OK | enforceFrom=v${currentVersion} | changelogVersions=${changelogVersions.length} | blogVersionPages=${blogFiles.length} | strictLocales=${strictLocales ? "on" : "off"}`,
  );
}

main();
