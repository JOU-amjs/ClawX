/**
 * Path Utilities
 * Cross-platform path resolution helpers
 */
import { createRequire } from 'node:module';
import { join, resolve, dirname, isAbsolute as pathIsAbsolute } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'fs';

const require = createRequire(import.meta.url);

type ElectronAppLike = Pick<typeof import('electron').app, 'isPackaged' | 'getPath' | 'getAppPath'>;

export {
  quoteForCmd,
  needsWinShell,
  prepareWinSpawn,
  normalizeNodeRequirePathForNodeOptions,
  appendNodeRequireToNodeOptions,
} from './win-shell';

// ── Portable Mode ────────────────────────────────────────────────────────────

/** @internal exported for tests */
export { getPortableAppDir };

/**
 * Detect whether the app is running in portable mode.
 *
 * Portable mode is activated when EITHER:
 * 1. `CLAWX_PORTABLE=1` environment variable is set, OR
 * 2. A `portable.marker` file exists next to the executable (packaged builds)
 *    or in the project root (development).
 *
 * In portable mode the app keeps ALL data on the portable drive and never
 * writes to the host machine's user directories (no PATH changes, no shell
 * profile modifications, no login-item registration).
 */
export function isPortable(): boolean {
  if (process.env.CLAWX_PORTABLE === '1') return true;

  if (process.versions?.electron) {
    const app = require('electron') as typeof import('electron');
    const markerDir = getPortableAppDir(app.app);
    const markerPath = join(markerDir, 'portable.marker');
    if (existsSync(markerPath)) return true;
  }

  return false;
}

/**
 * Return the directory that contains (or would contain) `portable.marker`.
 * - Packaged: dirname of the executable.
 * - Dev:      project root.
 */
function getPortableAppDir(app: ElectronAppLike): string {
  if (app.isPackaged) {
    return dirname(process.execPath);
  }
  return resolve(join(__dirname, '../..'));
}

function getElectronApp() {
  if (process.versions?.electron) {
    return (require('electron') as typeof import('electron')).app;
  }

  const fallbackUserData = process.env.CLAWX_USER_DATA_DIR?.trim() || join(homedir(), '.clawx');
  const fallbackAppPath = process.cwd();
  const fallbackApp: ElectronAppLike = {
    isPackaged: false,
    getPath: (name) => {
      if (name === 'userData') return fallbackUserData;
      return fallbackUserData;
    },
    getAppPath: () => fallbackAppPath,
  };
  return fallbackApp;
}

/**
 * Resolve the application base directory.
 * - Packaged: dirname of the executable (install dir's parent).
 * - Development: project root (two levels up from dist-electron/main/).
 */
export function getAppDataBase(): string {
  const app = getElectronApp();
  if (app.isPackaged) {
    // Production: parent of the executable directory.
    // e.g. C:\Users\xxx\AppData\Local\Programs\ClawX\ClawX.exe → Programs
    // This ensures relative paths resolve to the install directory's parent.
    try {
      const exePath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
        || dirname(process.execPath);
      return dirname(exePath);
    } catch {
      return dirname(process.execPath);
    }
  }
  // Development: project root directory
  return resolve(join(__dirname, '../..'));
}

/**
 * Resolve a data directory path from an environment variable.
 * Supports absolute paths, ~-prefixed paths, and relative paths.
 * Relative paths are resolved against the app base directory.
 */
export function resolveDataDir(envValue: string | undefined, fallback: string): string {
  if (!envValue?.trim()) return fallback;
  const trimmed = envValue.trim();
  if (trimmed.startsWith('~')) {
    return trimmed.replace(/^~/, homedir());
  }
  if (pathIsAbsolute(trimmed)) return trimmed;
  return resolve(join(getAppDataBase(), trimmed));
}

/**
 * Expand ~ to home directory
 */
export function expandPath(path: string): string {
  if (path.startsWith('~')) {
    return path.replace('~', homedir());
  }
  return path;
}

/**
 * Get OpenClaw config directory.
 * Supports CLAWX_OPENCLAW_DIR environment variable for custom path.
 * Falls back to ~/.openclaw when not set.
 */
export function getOpenClawConfigDir(): string {
  return resolveDataDir(process.env.CLAWX_OPENCLAW_DIR, join(homedir(), '.openclaw'));
}

/**
 * Get OpenClaw skills directory
 */
export function getOpenClawSkillsDir(): string {
  return join(getOpenClawConfigDir(), 'skills');
}

/**
 * Get ClawX config directory.
 * Supports CLAWX_CONFIG_DIR environment variable for custom path.
 * Falls back to ~/.clawx when not set.
 * In portable mode, defaults to data/.clawx relative to the app directory.
 */
export function getClawXConfigDir(): string {
  if (process.env.CLAWX_CONFIG_DIR?.trim()) {
    return resolveDataDir(process.env.CLAWX_CONFIG_DIR, join(homedir(), '.clawx'));
  }
  if (isPortable()) {
    return resolveDataDir('data/.clawx', join(homedir(), '.clawx'));
  }
  return join(homedir(), '.clawx');
}

/**
 * Get ClawX logs directory
 */
export function getLogsDir(): string {
  return join(getElectronApp().getPath('userData'), 'logs');
}

/**
 * Get ClawX data directory
 */
export function getDataDir(): string {
  return getElectronApp().getPath('userData');
}

/**
 * Ensure directory exists
 */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get resources directory (for bundled assets)
 */
export function getResourcesDir(): string {
  if (getElectronApp().isPackaged) {
    return join(process.resourcesPath, 'resources');
  }
  return join(__dirname, '../../resources');
}

/**
 * Get preload script path
 */
export function getPreloadPath(): string {
  return join(__dirname, '../preload/index.js');
}

/**
 * Get OpenClaw package directory
 * - Production (packaged): from resources/openclaw (copied by electron-builder extraResources)
 * - Development: from node_modules/openclaw
 */
export function getOpenClawDir(): string {
  if (getElectronApp().isPackaged) {
    return join(process.resourcesPath, 'openclaw');
  }
  // Development: use node_modules/openclaw
  return join(__dirname, '../../node_modules/openclaw');
}

/**
 * Get OpenClaw package directory resolved to a real path.
 * Useful when consumers need deterministic module resolution under pnpm symlinks.
 */
export function getOpenClawResolvedDir(): string {
  const dir = getOpenClawDir();
  if (!existsSync(dir)) {
    return dir;
  }
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

/**
 * Get OpenClaw entry script path (openclaw.mjs)
 */
export function getOpenClawEntryPath(): string {
  return join(getOpenClawDir(), 'openclaw.mjs');
}

/**
 * Get ClawHub CLI entry script path (clawdhub.js)
 */
export function getClawHubCliEntryPath(): string {
  return join(getElectronApp().getAppPath(), 'node_modules', 'clawhub', 'bin', 'clawdhub.js');
}

/**
 * Get ClawHub CLI binary path (node_modules/.bin)
 */
export function getClawHubCliBinPath(): string {
  const binName = process.platform === 'win32' ? 'clawhub.cmd' : 'clawhub';
  return join(getElectronApp().getAppPath(), 'node_modules', '.bin', binName);
}

/**
 * Check if OpenClaw package exists
 */
export function isOpenClawPresent(): boolean {
  const dir = getOpenClawDir();
  const pkgJsonPath = join(dir, 'package.json');
  return existsSync(dir) && existsSync(pkgJsonPath);
}

/**
 * Check if OpenClaw is built (has dist folder)
 * For the npm package, this should always be true since npm publishes the built dist.
 */
export function isOpenClawBuilt(): boolean {
  const dir = getOpenClawDir();
  const distDir = join(dir, 'dist');
  const hasDist = existsSync(distDir);
  return hasDist;
}

/**
 * Get OpenClaw status for environment check
 */
export interface OpenClawStatus {
  packageExists: boolean;
  isBuilt: boolean;
  entryPath: string;
  dir: string;
  version?: string;
}

export function getOpenClawStatus(): OpenClawStatus {
  const dir = getOpenClawDir();
  let version: string | undefined;

  // Try to read version from package.json
  try {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      version = pkg.version;
    }
  } catch {
    // Ignore version read errors
  }

  const status: OpenClawStatus = {
    packageExists: isOpenClawPresent(),
    isBuilt: isOpenClawBuilt(),
    entryPath: getOpenClawEntryPath(),
    dir,
    version,
  };

  try {
    const { logger } = require('./logger') as typeof import('./logger');
    logger.info('OpenClaw status:', status);
  } catch {
    // Ignore logger bootstrap issues in non-Electron contexts such as unit tests.
  }
  return status;
}
