import path from "path";
import fs from "fs";
import { createFingerprintAsync } from "@expo/fingerprint";
import { EventEmitter, Disposable } from "vscode";
import { Logger } from "../Logger";
import { extensionContext } from "../utilities/extensionContext";
import { DevicePlatform } from "../common/DeviceManager";
import { IOSBuildResult } from "./buildIOS";
import { AndroidBuildResult } from "./buildAndroid";
import { getLaunchConfiguration } from "../utilities/launchConfiguration";
import { runfingerprintCommand } from "./customBuild";
import { calculateMD5 } from "../utilities/common";
import { BuildResult } from "./BuildManager";
import { throttleAsync } from "../utilities/throttle";
import { watchProjectFiles } from "../utilities/watchProjectFiles";

const ANDROID_BUILD_CACHE_KEY = "android_build_cache";
const IOS_BUILD_CACHE_KEY = "ios_build_cache";

const FINGERPRINT_THROTTLE_MS = 10 * 1000; // 10 seconds

const IGNORE_PATHS = [
  path.join("android", ".gradle/**/*"),
  path.join("android", "build/**/*"),
  path.join("android", "app", "build/**/*"),
  path.join("ios", "build/**/*"),
  path.join("ios", "DerivedData/**/*"),
  "**/node_modules/**/android/.cxx/**/*",
  "**/node_modules/**/.gradle/**/*",
  "**/node_modules/**/android/build/intermediates/cxx/**/*",
];

export type BuildCacheInfo = {
  fingerprint: string;
  buildHash: string;
  buildResult: AndroidBuildResult | IOSBuildResult;
};

function makeCacheKey(platform: DevicePlatform, appRoot: string) {
  const keyPrefix =
    platform === DevicePlatform.Android ? ANDROID_BUILD_CACHE_KEY : IOS_BUILD_CACHE_KEY;
  return `${keyPrefix}:${appRoot}`;
}

export class BuildCache implements Disposable {
  private workspaceChangeListener: Disposable;
  private cacheStaleEventEmitter = new EventEmitter<DevicePlatform>();
  public readonly onCacheStale = this.cacheStaleEventEmitter.event;

  constructor(private readonly appRootFolder: string) {
    this.workspaceChangeListener = watchProjectFiles(this.checkIfFingerprintsChanged);
  }

  dispose() {
    this.workspaceChangeListener.dispose();
    this.cacheStaleEventEmitter.dispose();
  }

  /**
   * Passed fingerprint should be calculated at the time build is started.
   */
  public async storeBuild(buildFingerprint: string, build: BuildResult) {
    const appPath = await getAppHash(getAppPath(build));
    await extensionContext.globalState.update(makeCacheKey(build.platform, this.appRootFolder), {
      fingerprint: buildFingerprint,
      buildHash: appPath,
      buildResult: build,
    });
  }

  public async clearCache(platform: DevicePlatform) {
    await extensionContext.globalState.update(
      makeCacheKey(platform, this.appRootFolder),
      undefined
    );
  }

  public async getBuild(currentFingerprint: string, platform: DevicePlatform) {
    const cache = extensionContext.globalState.get<BuildCacheInfo>(
      makeCacheKey(platform, this.appRootFolder)
    );
    if (!cache) {
      Logger.debug("No cached build found.");
      return undefined;
    }

    const fingerprintsMatch = cache.fingerprint === currentFingerprint;
    if (!fingerprintsMatch) {
      Logger.info(
        `Fingerprint mismatch, cannot use cached build. Old: '${cache.fingerprint}', new: '${currentFingerprint}'.`
      );
      return undefined;
    }

    const build = cache.buildResult;
    const appPath = getAppPath(build);
    try {
      const builtAppExists = fs.existsSync(appPath);
      if (!builtAppExists) {
        Logger.info("Couldn't use cached build. App artifact not found.");
        return undefined;
      }

      const appHash = await getAppHash(appPath);
      const hashesMatch = appHash === cache.buildHash;
      if (hashesMatch) {
        Logger.info("Using cached build.");
        return build;
      }
    } catch (e) {
      // we only log the error and ignore it to allow new build to start
      Logger.error("Error while attempting to load cached build: ", e);
      return undefined;
    }
  }

  public async isCacheStale(platform: DevicePlatform) {
    const currentFingerprint = await this.calculateFingerprint(platform);
    const { fingerprint } =
      extensionContext.globalState.get<BuildCacheInfo>(
        makeCacheKey(platform, this.appRootFolder)
      ) ?? {};

    return currentFingerprint !== fingerprint;
  }

  public async calculateFingerprint(platform: DevicePlatform) {
    Logger.debug("Calculating fingerprint");
    const customFingerprint = await this.calculateCustomFingerprint(platform);

    if (customFingerprint) {
      Logger.debug("Using custom fingerprint", customFingerprint);
      return customFingerprint;
    }

    const fingerprint = await createFingerprintAsync(this.appRootFolder, {
      ignorePaths: IGNORE_PATHS,
    });
    Logger.debug("App folder fingerprint", fingerprint.hash);
    return fingerprint.hash;
  }

  private async calculateCustomFingerprint(platform: DevicePlatform) {
    const { customBuild, env } = getLaunchConfiguration();
    const configPlatform = (
      {
        [DevicePlatform.Android]: "android",
        [DevicePlatform.IOS]: "ios",
      } as const
    )[platform];
    const fingerprintCommand = customBuild?.[configPlatform]?.fingerprintCommand;

    if (!fingerprintCommand) {
      return undefined;
    }

    Logger.debug(`Using custom fingerprint script '${fingerprintCommand}'`);
    const fingerprint = await runfingerprintCommand(fingerprintCommand, env, this.appRootFolder);

    if (!fingerprint) {
      throw new Error("Failed to generate application fingerprint using custom script.");
    }

    Logger.debug("Application fingerprint", fingerprint);
    return fingerprint;
  }

  private checkIfFingerprintsChanged = throttleAsync(async () => {
    await Promise.all(
      [DevicePlatform.Android, DevicePlatform.IOS].map(async (platform) => {
        const cacheKey = makeCacheKey(platform, this.appRootFolder);
        const hasCachedBuild = extensionContext.globalState.get<BuildCacheInfo>(cacheKey);
        if (hasCachedBuild) {
          const isCacheStale = await this.isCacheStale(platform);

          if (isCacheStale) {
            this.cacheStaleEventEmitter.fire(platform);
            await this.clearCache(platform);
          }
        }
      })
    );
  }, FINGERPRINT_THROTTLE_MS);
}

function getAppPath(build: BuildResult) {
  return build.platform === DevicePlatform.Android ? build.apkPath : build.appPath;
}

async function getAppHash(appPath: string) {
  return (await calculateMD5(appPath)).digest("hex");
}

export async function migrateOldBuildCachesToNewStorage(appRoot: string) {
  try {
    for (const platform of [DevicePlatform.Android, DevicePlatform.IOS]) {
      const oldKey =
        platform === DevicePlatform.Android ? ANDROID_BUILD_CACHE_KEY : IOS_BUILD_CACHE_KEY;
      const cache = extensionContext.workspaceState.get<BuildCacheInfo>(oldKey);
      if (cache) {
        await extensionContext.globalState.update(makeCacheKey(platform, appRoot), cache);
        await extensionContext.workspaceState.update(oldKey, undefined);
      }
    }
  } catch (e) {
    // we ignore all potential errors in this phase as it isn't critical and it is
    // better to not block the extension from starting in case of any issues when
    // migrating the caches
  }
}
