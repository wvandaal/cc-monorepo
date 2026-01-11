import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKTREE_ROOT = join(__dirname, "..");
const PACKAGES_DIR = join(WORKTREE_ROOT, "packages");
const ROOT_TSCONFIG = join(WORKTREE_ROOT, "tsconfig.json");
const PACKAGES_TSCONFIG = join(PACKAGES_DIR, "tsconfig.json");

interface PackageJson {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface TsConfig {
  extends?: string;
  compilerOptions?: Record<string, unknown>;
  files?: string[];
  include?: string[];
  exclude?: string[];
  references?: Array<{ path: string }>;
}

interface PackageInfo {
  name: string;
  path: string;
  packageJson: PackageJson;
  dependencies: string[];
}

function findPackages(): PackageInfo[] {
  const packages: PackageInfo[] = [];

  if (!existsSync(PACKAGES_DIR)) {
    return packages;
  }

  // Iterate over domain directories
  const domains = readdirSync(PACKAGES_DIR).filter((item) => {
    const itemPath = join(PACKAGES_DIR, item);
    return (
      statSync(itemPath).isDirectory() &&
      item !== "node_modules" &&
      !item.startsWith(".")
    );
  });

  for (const domain of domains) {
    const domainPath = join(PACKAGES_DIR, domain);

    // Iterate over package directories within each domain
    const pkgs = readdirSync(domainPath).filter((item) => {
      const itemPath = join(domainPath, item);
      return statSync(itemPath).isDirectory() && item !== "node_modules";
    });

    for (const pkg of pkgs) {
      const pkgPath = join(domainPath, pkg);
      const packageJsonPath = join(pkgPath, "package.json");

      if (existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(
            readFileSync(packageJsonPath, "utf-8"),
          ) as PackageJson;

          // Collect all workspace dependencies
          const allDeps = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies,
            ...packageJson.peerDependencies,
          };

          // Filter for workspace: dependencies (our internal packages)
          const workspaceDeps = Object.entries(allDeps)
            .filter(([, version]) => version.startsWith("workspace:"))
            .map(([name]) => name);

          packages.push({
            name: packageJson.name,
            path: pkgPath,
            packageJson,
            dependencies: workspaceDeps,
          });
        } catch (error) {
          console.warn(
            `Warning: Failed to parse ${packageJsonPath}: ${(error as Error).message}`,
          );
        }
      }
    }
  }

  return packages;
}

function detectCycles(packages: PackageInfo[]): string[][] {
  const cycles: string[][] = [];
  const packageMap = new Map(packages.map((p) => [p.name, p]));

  function dfs(current: string, visited: Set<string>, path: string[]): void {
    if (path.includes(current)) {
      const cycleStart = path.indexOf(current);
      cycles.push([...path.slice(cycleStart), current]);
      return;
    }

    if (visited.has(current)) {
      return;
    }

    visited.add(current);
    path.push(current);

    const pkg = packageMap.get(current);
    if (pkg) {
      for (const dep of pkg.dependencies) {
        if (packageMap.has(dep)) {
          dfs(dep, visited, [...path]);
        }
      }
    }

    path.pop();
  }

  for (const pkg of packages) {
    dfs(pkg.name, new Set(), []);
  }

  // Deduplicate cycles (same cycle can be detected starting from different nodes)
  const uniqueCycles: string[][] = [];
  const seen = new Set<string>();

  for (const cycle of cycles) {
    const normalized = [...cycle].sort().join(" -> ");
    if (!seen.has(normalized)) {
      seen.add(normalized);
      uniqueCycles.push(cycle);
    }
  }

  return uniqueCycles;
}

function updatePackageReferences(packages: PackageInfo[]): void {
  const packageMap = new Map(packages.map((p) => [p.name, p]));

  for (const pkg of packages) {
    const tsconfigPath = join(pkg.path, "tsconfig.json");

    if (!existsSync(tsconfigPath)) {
      console.warn(`Warning: No tsconfig.json found at ${tsconfigPath}`);
      continue;
    }

    try {
      const tsconfig = JSON.parse(
        readFileSync(tsconfigPath, "utf-8"),
      ) as TsConfig;

      // Build references from dependencies
      const references: Array<{ path: string }> = [];

      for (const depName of pkg.dependencies) {
        const dep = packageMap.get(depName);
        if (dep) {
          const relativePath = relative(pkg.path, dep.path);
          references.push({ path: relativePath });
        }
      }

      // Sort references for consistent output
      references.sort((a, b) => a.path.localeCompare(b.path));

      // Update tsconfig
      tsconfig.references = references;

      writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
      console.log(`Updated ${pkg.name}: ${references.length} reference(s)`);
    } catch (error) {
      console.warn(
        `Warning: Failed to update ${tsconfigPath}: ${(error as Error).message}`,
      );
    }
  }
}

function updateRootTsconfig(packages: PackageInfo[]): void {
  // Update root tsconfig.json
  if (existsSync(ROOT_TSCONFIG)) {
    try {
      const tsconfig = JSON.parse(
        readFileSync(ROOT_TSCONFIG, "utf-8"),
      ) as TsConfig;

      const references = packages.map((pkg) => ({
        path: relative(WORKTREE_ROOT, pkg.path),
      }));

      references.sort((a, b) => a.path.localeCompare(b.path));
      tsconfig.references = references;

      writeFileSync(ROOT_TSCONFIG, `${JSON.stringify(tsconfig, null, 2)}\n`);
      console.log(
        `Updated root tsconfig.json: ${references.length} reference(s)`,
      );
    } catch (error) {
      console.warn(
        `Warning: Failed to update root tsconfig.json: ${(error as Error).message}`,
      );
    }
  }

  // Update packages/tsconfig.json (bridge)
  if (existsSync(PACKAGES_TSCONFIG)) {
    try {
      const tsconfig = JSON.parse(
        readFileSync(PACKAGES_TSCONFIG, "utf-8"),
      ) as TsConfig;

      const references = packages.map((pkg) => ({
        path: relative(PACKAGES_DIR, pkg.path),
      }));

      references.sort((a, b) => a.path.localeCompare(b.path));
      tsconfig.references = references;

      writeFileSync(
        PACKAGES_TSCONFIG,
        `${JSON.stringify(tsconfig, null, 2)}\n`,
      );
      console.log(
        `Updated packages/tsconfig.json: ${references.length} reference(s)`,
      );
    } catch (error) {
      console.warn(
        `Warning: Failed to update packages/tsconfig.json: ${(error as Error).message}`,
      );
    }
  }
}

function main(): void {
  console.log("=== Syncing TypeScript references ===\n");

  // Find all packages
  const packages = findPackages();
  console.log(`Found ${packages.length} package(s)\n`);

  if (packages.length === 0) {
    console.log("No packages found. Nothing to sync.");
    return;
  }

  // Check for cycles
  const cycles = detectCycles(packages);
  if (cycles.length > 0) {
    console.error("Error: Circular dependencies detected!");
    for (const cycle of cycles) {
      console.error(`  ${cycle.join(" -> ")}`);
    }
    process.exit(1);
  }

  // Update package references
  console.log("Updating package references...");
  updatePackageReferences(packages);

  // Update root tsconfig
  console.log("\nUpdating root tsconfig files...");
  updateRootTsconfig(packages);

  console.log("\n=== Sync complete! ===");
}

main();
