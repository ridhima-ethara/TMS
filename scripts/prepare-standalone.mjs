import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const buildDir = ".next-build";
const standaloneDir = join(buildDir, "standalone");

if (!existsSync(standaloneDir)) {
  throw new Error(`Standalone output was not found at ${standaloneDir}`);
}

const staticSource = join(buildDir, "static");
const staticTarget = join(standaloneDir, buildDir, "static");
mkdirSync(staticTarget, { recursive: true });
cpSync(staticSource, staticTarget, { recursive: true, force: true });

if (existsSync("public")) {
  cpSync("public", join(standaloneDir, "public"), {
    recursive: true,
    force: true,
  });
}

console.log("Prepared standalone static and public assets");
