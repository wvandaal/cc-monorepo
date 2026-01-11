import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKTREE_ROOT = join(__dirname, "..");
const TEMPLATE_DIR = join(WORKTREE_ROOT, ".template");
const PACKAGES_DIR = join(WORKTREE_ROOT, "packages");

function processTemplate(
  content: string,
  domain: string,
  packageName: string,
): string {
  return content
    .replace(/\{\{domain\}\}/g, domain)
    .replace(/\{\{package\}\}/g, packageName);
}

function createPackage(domain: string, packageName: string): void {
  const packageDir = join(PACKAGES_DIR, domain, packageName);

  // Check if package already exists
  if (existsSync(packageDir)) {
    console.error(`Error: Package already exists at ${packageDir}`);
    process.exit(1);
  }

  console.log(`Creating package @${domain}/${packageName}...`);

  // Create the domain directory if it doesn't exist
  const domainDir = join(PACKAGES_DIR, domain);
  if (!existsSync(domainDir)) {
    mkdirSync(domainDir, { recursive: true });
  }

  // Create package directory structure
  mkdirSync(join(packageDir, "src"), { recursive: true });

  // Copy and process template files
  const packageJsonTemplate = readFileSync(
    join(TEMPLATE_DIR, "package.json.tmpl"),
    "utf-8",
  );
  const tsconfigTemplate = readFileSync(
    join(TEMPLATE_DIR, "tsconfig.json.tmpl"),
    "utf-8",
  );
  const indexTemplate = readFileSync(
    join(TEMPLATE_DIR, "src", "index.ts"),
    "utf-8",
  );

  writeFileSync(
    join(packageDir, "package.json"),
    processTemplate(packageJsonTemplate, domain, packageName),
  );

  writeFileSync(
    join(packageDir, "tsconfig.json"),
    processTemplate(tsconfigTemplate, domain, packageName),
  );

  writeFileSync(
    join(packageDir, "src", "index.ts"),
    processTemplate(indexTemplate, domain, packageName),
  );

  console.log(`Package created at ${packageDir}`);

  // Sync references
  console.log("Syncing TypeScript references...");
  try {
    execSync("pnpm run sync-refs", { cwd: WORKTREE_ROOT, stdio: "inherit" });
  } catch {
    console.warn(
      "Warning: Failed to sync references. Run 'pnpm run sync-refs' manually.",
    );
  }

  // Install dependencies
  console.log("Installing dependencies...");
  try {
    execSync("pnpm install", { cwd: WORKTREE_ROOT, stdio: "inherit" });
  } catch (error) {
    console.error("Error: Failed to install dependencies.");
    console.error((error as Error).message);
    process.exit(1);
  }

  console.log(`\nPackage @${domain}/${packageName} created successfully!`);
  console.log("\nYou can now:");
  console.log(`  1. Add code to ${packageDir}/src/index.ts`);
  console.log(
    `  2. Add dependencies with: pnpm add <package> --filter @${domain}/${packageName}`,
  );
  console.log("  3. Build with: pnpm build");
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Usage: pnpm run create-package <domain> <package-name>");
    console.error("Example: pnpm run create-package utils datetime");
    console.error(
      "         Creates @utils/datetime package at packages/utils/datetime/",
    );
    process.exit(1);
  }

  const [domain, packageName] = args;

  // Validate names
  const validNameRegex = /^[a-z][a-z0-9-]*$/;
  if (!validNameRegex.test(domain)) {
    console.error(`Error: Invalid domain name '${domain}'`);
    console.error(
      "Domain names must start with a letter and contain only lowercase letters, numbers, and hyphens.",
    );
    process.exit(1);
  }

  if (!validNameRegex.test(packageName)) {
    console.error(`Error: Invalid package name '${packageName}'`);
    console.error(
      "Package names must start with a letter and contain only lowercase letters, numbers, and hyphens.",
    );
    process.exit(1);
  }

  createPackage(domain, packageName);
}

main();
