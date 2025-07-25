import path from "path";
import fs from "fs";
import { ExecaChildProcess, ExecaError } from "execa";
import { getAppCachesDir, getOldAppCachesDir } from "../utilities/common";
import { DeviceBase } from "./DeviceBase";
import { Preview } from "./preview";
import { Logger } from "../Logger";
import { exec, lineReader } from "../utilities/subprocess";
import { getAvailableIosRuntimes } from "../utilities/iosRuntimes";
import { IOSDeviceInfo, IOSRuntimeInfo, DevicePlatform, DeviceInfo } from "../common/DeviceManager";
import { BuildResult } from "../builders/BuildManager";
import { AppPermissionType, DeviceSettings, Locale } from "../common/Project";
import { EXPO_GO_BUNDLE_ID, fetchExpoLaunchDeeplink } from "../builders/expoGo";
import { IOSBuildResult } from "../builders/buildIOS";
import { OutputChannelRegistry } from "../project/OutputChannelRegistry";
import { Output } from "../common/OutputChannel";

interface SimulatorInfo {
  availability?: string;
  state?: string;
  isAvailable?: boolean;
  name: string;
  udid: string;
  version?: string;
  displayName: string;
  availabilityError?: string;
  type?: "simulator" | "device" | "catalyst";
  booted?: boolean;
  lastBootedAt?: string;
  deviceTypeIdentifier: string;
}

interface SimulatorData {
  devices: { [runtimeID: string]: SimulatorInfo[] };
}

type PrivacyServiceName =
  | "all"
  | "calendar"
  | "contacts-limited"
  | "contacts"
  | "location"
  | "location-always"
  | "photos-add"
  | "photos"
  | "media-library"
  | "microphone"
  | "motion"
  | "reminders"
  | "siri";

export class IosSimulatorDevice extends DeviceBase {
  private runningAppProcess: ExecaChildProcess | undefined;

  constructor(
    private readonly deviceUDID: string,
    private readonly _deviceInfo: DeviceInfo,
    private readonly outputChannelRegistry: OutputChannelRegistry
  ) {
    super();
  }

  public get platform(): DevicePlatform {
    return DevicePlatform.IOS;
  }

  public get deviceInfo() {
    return this._deviceInfo;
  }

  public get lockFilePath(): string {
    const deviceSetLocation = getDeviceSetLocation(this.deviceUDID);
    const pidFile = path.join(deviceSetLocation, this.deviceUDID, "lock.pid");
    return pidFile;
  }

  private get nativeLogsOutputChannel() {
    return this.outputChannelRegistry.getOrCreateOutputChannel(Output.IosDevice);
  }

  public dispose() {
    super.dispose();
    this.runningAppProcess?.cancel();
    return exec("xcrun", [
      "simctl",
      "--set",
      getOrCreateDeviceSet(this.deviceUDID),
      "shutdown",
      this.deviceUDID,
    ]);
  }

  public async reboot() {
    super.reboot();
    this.runningAppProcess?.cancel();
    await exec("xcrun", [
      "simctl",
      "--set",
      getOrCreateDeviceSet(this.deviceUDID),
      "shutdown",
      this.deviceUDID,
    ]);

    await this.internalBootDevice();
  }

  public setUpKeyboard() {
    this.preview?.setUpKeyboard();
  }

  private async internalBootDevice() {
    const deviceSetLocation = getOrCreateDeviceSet(this.deviceUDID);
    try {
      await exec("xcrun", ["simctl", "--set", deviceSetLocation, "boot", this.deviceUDID], {
        allowNonZeroExit: true,
      });
    } catch (e) {
      const isAlreadyBooted = (e as ExecaError).stderr?.includes("current state: Booted");
      if (isAlreadyBooted) {
        Logger.debug("Device already booted");
      } else {
        throw e;
      }
    }
  }

  async bootDevice() {
    if (await this.shouldUpdateLocale(this.deviceSettings.locale)) {
      await this.changeLocale(this.deviceSettings.locale);
    }

    await this.internalBootDevice();

    await this.changeSettings(this.deviceSettings);
  }

  private async shouldUpdateLocale(locale: Locale): Promise<boolean> {
    const deviceSetLocation = getOrCreateDeviceSet(this.deviceUDID);
    const deviceLocale = await exec("/usr/libexec/PlistBuddy", [
      "-c",
      `print :AppleLocale`,
      path.join(
        deviceSetLocation,
        this.deviceUDID,
        "data",
        "Library",
        "Preferences",
        ".GlobalPreferences.plist"
      ),
    ]);
    if (deviceLocale.stdout === locale) {
      return false;
    }
    return true;
  }

  async changeSettings(settings: DeviceSettings): Promise<boolean> {
    let shouldRestart = false;
    const deviceSetLocation = getOrCreateDeviceSet(this.deviceUDID);

    if (await this.shouldUpdateLocale(settings.locale)) {
      shouldRestart = true;
      this.changeLocale(settings.locale);
    }

    await exec("xcrun", [
      "simctl",
      "--set",
      deviceSetLocation,
      "ui",
      this.deviceUDID,
      "appearance",
      settings.appearance,
    ]);
    await exec("xcrun", [
      "simctl",
      "--set",
      deviceSetLocation,
      "ui",
      this.deviceUDID,
      "content_size",
      convertToSimctlSize(settings.contentSize),
    ]);
    if (settings.location.isDisabled) {
      await exec("xcrun", [
        "simctl",
        "--set",
        deviceSetLocation,
        "location",
        this.deviceUDID,
        "clear",
      ]);
    } else {
      await exec("xcrun", [
        "simctl",
        "--set",
        deviceSetLocation,
        "location",
        this.deviceUDID,
        "set",
        `${settings.location.latitude.toString()},${settings.location.longitude.toString()}`,
      ]);
    }
    await exec("xcrun", [
      "simctl",
      "--set",
      deviceSetLocation,
      "spawn",
      this.deviceUDID,
      "notifyutil",
      "-s",
      "com.apple.BiometricKit.enrollmentChanged",
      settings.hasEnrolledBiometrics ? "1" : "0",
    ]);
    await exec("xcrun", [
      "simctl",
      "--set",
      deviceSetLocation,
      "spawn",
      this.deviceUDID,
      "notifyutil",
      "-p",
      "com.apple.BiometricKit.enrollmentChanged",
    ]);

    return shouldRestart;
  }

  async sendBiometricAuthorization(isMatch: boolean) {
    const deviceSetLocation = getOrCreateDeviceSet(this.deviceUDID);
    await exec("xcrun", [
      "simctl",
      "--set",
      deviceSetLocation,
      "spawn",
      this.deviceUDID,
      "notifyutil",
      "-p",
      isMatch
        ? "com.apple.BiometricKit_Sim.fingerTouch.match"
        : "com.apple.BiometricKit_Sim.fingerTouch.nomatch",
    ]);
  }

  public async sendClipboard(text: string) {
    const deviceSetLocation = getOrCreateDeviceSet(this.deviceUDID);
    await exec("xcrun", ["simctl", "--set", deviceSetLocation, "pbcopy", this.deviceUDID], {
      input: text,
    });
  }

  public async getClipboard() {
    const deviceSetLocation = getOrCreateDeviceSet(this.deviceUDID);
    const { stdout } = await exec("xcrun", [
      "simctl",
      "--set",
      deviceSetLocation,
      "pbpaste",
      this.deviceUDID,
    ]);

    return stdout;
  }

  private async changeLocale(newLocale: Locale): Promise<boolean> {
    const deviceSetLocation = getOrCreateDeviceSet(this.deviceUDID);
    const languageCode = newLocale.match(/([^_-]*)/)![1];
    await exec("/usr/libexec/PlistBuddy", [
      "-c",
      `set :AppleLanguages:0 ${languageCode}`,
      "-c",
      `set :AppleLocale ${newLocale}`,
      path.join(
        deviceSetLocation,
        this.deviceUDID,
        "data",
        "Library",
        "Preferences",
        ".GlobalPreferences.plist"
      ),
    ]);
    return true;
  }

  async configureMetroPort(bundleID: string, metroPort: number) {
    const deviceSetLocation = getOrCreateDeviceSet(this.deviceUDID);
    const { stdout: appDataLocation } = await exec("xcrun", [
      "simctl",
      "--set",
      deviceSetLocation,
      "get_app_container",
      this.deviceUDID,
      bundleID,
      "data",
    ]);
    const userDefaultsLocation = path.join(
      appDataLocation,
      "Library",
      "Preferences",
      `${bundleID}.plist`
    );
    Logger.debug(`Defaults location ${userDefaultsLocation}`);
    try {
      await exec(
        "/usr/libexec/PlistBuddy",
        [
          "-c",
          "Delete :RCT_jsLocation",
          "-c",
          `Add :RCT_jsLocation string localhost:${metroPort}`,
          userDefaultsLocation,
        ],
        { allowNonZeroExit: true }
      );
    } catch (e) {
      // Delete command fails if the key doesn't exists, but later commands run regardless,
      // despite that process exits with non-zero code. We can ignore this error.
    }
  }

  async terminateApp(bundleID: string) {
    const deviceSetLocation = getOrCreateDeviceSet(this.deviceUDID);

    // Terminate the app if it's running:
    try {
      await exec(
        "xcrun",
        ["simctl", "--set", deviceSetLocation, "terminate", this.deviceUDID, bundleID],
        { allowNonZeroExit: true }
      );
    } catch (e) {
      // terminate will exit with non-zero code when the app wasn't running. we ignore this error
    }
  }

  /**
   * This function terminates any running applications. Might be useful when you launch a new application
   * before terminating the previous one.
   */
  async terminateAnyRunningApplications() {
    const deviceSetLocation = getOrCreateDeviceSet(this.deviceUDID);
    const { stdout } = await exec("xcrun", [
      "simctl",
      "--set",
      deviceSetLocation,
      "listapps",
      this.deviceUDID,
    ]);

    const regex = /ApplicationType = User;\s*[^{}]*?\bCFBundleIdentifier = "([^"]+)/g;

    const matches = [];
    let match;
    while ((match = regex.exec(stdout)) !== null) {
      matches.push(match[1]);
    }

    await Promise.all(matches.map(async (e) => await this.terminateApp(e)));
  }

  async launchWithBuild(build: IOSBuildResult, launchArguments: string[]) {
    const deviceSetLocation = getOrCreateDeviceSet(this.deviceUDID);

    await this.terminateAnyRunningApplications();

    if (this.runningAppProcess) {
      this.runningAppProcess.kill(9);
    }

    this.nativeLogsOutputChannel.clear();

    const launchAppArgs = [
      "simctl",
      "--set",
      deviceSetLocation,
      "launch",
      "--console",
      "--terminate-running-process",
      this.deviceUDID,
      build.bundleID,
      ...launchArguments,
    ];

    this.runningAppProcess = exec("xcrun", launchAppArgs);

    lineReader(this.runningAppProcess).onLineRead((line) =>
      this.nativeLogsOutputChannel?.appendLine(line)
    );
  }

  async launchWithExpoDeeplink(bundleID: string, expoDeeplink: string) {
    // For Expo dev-client and Expo Go setup, we use deeplink to launch the app. For this approach to work we do the following:
    // 1. Add the deeplink to the scheme approval list via defaults
    // 2. Terminate any app if it's running
    // 3. Open the deeplink
    const deviceSetLocation = getOrCreateDeviceSet(this.deviceUDID);

    // Add the deeplink to the scheme approval list:
    const schema = new URL(expoDeeplink).protocol.slice(0, -1);
    await exec("xcrun", [
      "simctl",
      "--set",
      deviceSetLocation,
      "spawn",
      this.deviceUDID,
      "defaults",
      "write",
      "com.apple.launchservices.schemeapproval",
      `com.apple.CoreSimulator.CoreSimulatorBridge-->${schema}`,
      "-string",
      bundleID,
    ]);

    await this.terminateAnyRunningApplications();

    // Use openurl to open the deeplink:
    await exec("xcrun", [
      "simctl",
      "--set",
      deviceSetLocation,
      "openurl",
      this.deviceUDID,
      expoDeeplink,
      // TODO: disableOnboarding param causes error while launching
      // + "&disableOnboarding=1", // disable onboarding dialog via deeplink query param
    ]);
  }

  async launchApp(
    build: IOSBuildResult,
    metroPort: number,
    _devtoolsPort: number,
    launchArguments: string[]
  ) {
    if (build.platform !== DevicePlatform.IOS) {
      throw new Error("Invalid platform");
    }
    const deepLinkChoice = build.bundleID === EXPO_GO_BUNDLE_ID ? "expo-go" : "expo-dev-client";
    const expoDeeplink = await fetchExpoLaunchDeeplink(metroPort, "ios", deepLinkChoice);
    if (expoDeeplink) {
      this.launchWithExpoDeeplink(build.bundleID, expoDeeplink);
    } else {
      await this.configureMetroPort(build.bundleID, metroPort);
      await this.launchWithBuild(build, launchArguments);
    }
  }

  async installApp(build: BuildResult, forceReinstall: boolean) {
    if (build.platform !== DevicePlatform.IOS) {
      throw new Error("Invalid platform");
    }
    const deviceSetLocation = getOrCreateDeviceSet(this.deviceUDID);
    if (forceReinstall) {
      try {
        await exec(
          "xcrun",
          ["simctl", "--set", deviceSetLocation, "uninstall", this.deviceUDID, build.bundleID],
          { allowNonZeroExit: true }
        );
      } catch (e) {
        Logger.error("Error while uninstalling will be ignored", e);
      }
    }
    await exec("xcrun", [
      "simctl",
      "--set",
      deviceSetLocation,
      "install",
      this.deviceUDID,
      build.appPath,
    ]);
  }

  async resetAppPermissions(appPermission: AppPermissionType, build: BuildResult) {
    if (build.platform !== DevicePlatform.IOS) {
      throw new Error("Invalid platform");
    }
    const privacyServiceName: PrivacyServiceName = appPermission;
    await exec("xcrun", [
      "simctl",
      "--set",
      getOrCreateDeviceSet(this.deviceUDID),
      "privacy",
      this.deviceUDID,
      "reset",
      privacyServiceName,
      build.bundleID,
    ]);
    return false;
  }

  async sendDeepLink(link: string, build: BuildResult) {
    if (build.platform !== DevicePlatform.IOS) {
      throw new Error("Invalid platform");
    }

    await exec("xcrun", [
      "simctl",
      "--set",
      getOrCreateDeviceSet(this.deviceUDID),
      "openurl",
      this.deviceUDID,
      link,
    ]);
  }

  makePreview(): Preview {
    return new Preview([
      "ios",
      "--id",
      this.deviceUDID,
      "--device-set",
      getOrCreateDeviceSet(this.deviceUDID),
    ]);
  }
}

export async function getNewestAvailableIosRuntime() {
  const runtimesData = await getAvailableIosRuntimes();

  // sort available runtimes by version
  runtimesData.sort((a, b) => (a.version.localeCompare(b.version) ? -1 : 1));

  // pick the newest runtime
  return runtimesData[0];
}

export async function removeIosRuntimes(runtimeIDs: string[]) {
  const removalPromises = runtimeIDs.map((runtimeID) => {
    return exec("xcrun", ["simctl", "runtime", "delete", runtimeID], {});
  });
  return Promise.all(removalPromises);
}

export async function renameIosSimulator(udid: string | undefined, newDisplayName: string) {
  if (!udid) {
    return;
  }

  return await exec("xcrun", [
    "simctl",
    "--set",
    getOrCreateDeviceSet(udid),
    "rename",
    udid,
    newDisplayName,
  ]);
}

export async function removeIosSimulator(udid: string | undefined, location: SimulatorDeviceSet) {
  if (!udid) {
    return;
  }

  let deviceSetArgs: string[] = [];
  if (location === SimulatorDeviceSet.RN_IDE) {
    const setDirectory = getOrCreateDeviceSet(udid);
    deviceSetArgs = ["--set", setDirectory];
  }

  return exec("xcrun", ["simctl", ...deviceSetArgs, "delete", udid]);
}

async function listSimulatorsForLocation(location?: string) {
  let deviceSetArgs: string[] = [];
  if (location) {
    deviceSetArgs = ["--set", location];
  }
  try {
    const { stdout } = await exec(
      "xcrun",
      ["simctl", ...deviceSetArgs, "list", "devices", "--json"],
      { allowNonZeroExit: true }
    );
    const parsedData: SimulatorData = JSON.parse(stdout);

    const { devices: devicesPerRuntime } = parsedData;

    return Object.entries(devicesPerRuntime);
  } catch (e) {
    // ignore errors because some locations might not exist
  }
  return [];
}

export async function listSimulators(
  location: SimulatorDeviceSet = SimulatorDeviceSet.RN_IDE
): Promise<IOSDeviceInfo[]> {
  let devicesPerRuntime;
  if (location === SimulatorDeviceSet.RN_IDE) {
    const deviceSetLocation = getOrCreateDeviceSet();

    devicesPerRuntime = await listSimulatorsForLocation(deviceSetLocation);

    const oldDeviceSetLocation = getOldDeviceSetLocation();
    const oldDevicesPerRuntime = await listSimulatorsForLocation(oldDeviceSetLocation);

    devicesPerRuntime = devicesPerRuntime.concat(oldDevicesPerRuntime);
  } else {
    devicesPerRuntime = await listSimulatorsForLocation();
  }

  const runtimes = await getAvailableIosRuntimes();

  const simulators = devicesPerRuntime
    .map(([runtimeID, devices]) => {
      const runtime = runtimes.find((item) => item.identifier === runtimeID);

      return devices.map((device) => {
        return {
          id: `ios-${device.udid}`,
          platform: DevicePlatform.IOS as const,
          UDID: device.udid,
          modelId: device.deviceTypeIdentifier,
          systemName: runtime?.name ?? "Unknown",
          displayName: device.name,
          available: device.isAvailable ?? false,
          runtimeInfo: runtime!,
        };
      });
    })
    .flat();
  return simulators;
}

export enum SimulatorDeviceSet {
  Default,
  RN_IDE,
}

export async function createSimulator(
  modelId: string,
  displayName: string,
  runtime: IOSRuntimeInfo,
  deviceSet: SimulatorDeviceSet
) {
  Logger.debug(`Create simulator ${modelId} with runtime ${runtime.identifier}`);

  let locationArgs: string[] = [];
  if (deviceSet === SimulatorDeviceSet.RN_IDE) {
    const deviceSetLocation = getOrCreateDeviceSet();
    locationArgs = ["--set", deviceSetLocation];
  }

  // create new simulator with selected runtime
  const { stdout: UDID } = await exec("xcrun", [
    "simctl",
    ...locationArgs,
    "create",
    displayName,
    modelId,
    runtime.identifier,
  ]);

  return {
    id: `ios-${UDID}`,
    platform: DevicePlatform.IOS,
    UDID,
    modelId: modelId,
    systemName: runtime.name,
    displayName: displayName,
    available: true, // assuming if create command went through, it's available
    runtimeInfo: runtime,
  } as IOSDeviceInfo;
}

function getDeviceSetLocation(deviceUDID?: string) {
  const appCachesDir = getAppCachesDir();
  const deviceSetLocation = path.join(appCachesDir, "Devices", "iOS");
  if (!deviceUDID) {
    return deviceSetLocation;
  }
  const oldDeviceSetLocation = getOldDeviceSetLocation();
  if (!fs.existsSync(oldDeviceSetLocation)) {
    return deviceSetLocation;
  }
  const devices = fs.readdirSync(oldDeviceSetLocation);
  if (devices.includes(deviceUDID)) {
    return oldDeviceSetLocation;
  }
  return deviceSetLocation;
}

function getOldDeviceSetLocation() {
  const oldAppCachesDir = getOldAppCachesDir();
  return path.join(oldAppCachesDir, "Devices", "iOS");
}

function getOrCreateDeviceSet(deviceUDID?: string) {
  let deviceSetLocation = getDeviceSetLocation(deviceUDID);
  if (!fs.existsSync(deviceSetLocation)) {
    fs.mkdirSync(deviceSetLocation, { recursive: true });
  }

  return deviceSetLocation;
}

function convertToSimctlSize(size: DeviceSettings["contentSize"]): string {
  switch (size) {
    case "xsmall":
      return "extra-small";
    case "small":
      return "small";
    case "normal":
      return "medium";
    case "large":
      return "large";
    case "xlarge":
      return "extra-large";
    case "xxlarge":
      return "extra-extra-large";
    case "xxxlarge":
      return "extra-extra-extra-large";
  }
}
