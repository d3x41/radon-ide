import { EventEmitter } from "stream";
import _ from "lodash";
import { getAndroidSystemImages } from "../utilities/sdkmanager";
import {
  IosSimulatorDevice,
  SimulatorDeviceSet,
  createSimulator,
  listSimulators,
  renameIosSimulator,
  removeIosSimulator,
} from "./IosSimulatorDevice";
import { getAvailableIosRuntimes } from "../utilities/iosRuntimes";
import {
  AndroidEmulatorDevice,
  createEmulator,
  listEmulators,
  renameEmulator,
  removeEmulator,
} from "./AndroidEmulatorDevice";
import {
  DeviceInfo,
  DevicePlatform,
  DeviceManagerInterface,
  IOSRuntimeInfo,
  DeviceManagerEventMap,
  DeviceManagerEventListener,
  IOSDeviceTypeInfo,
  AndroidSystemImageInfo,
} from "../common/DeviceManager";
import { Logger } from "../Logger";
import { extensionContext } from "../utilities/extensionContext";
import { Platform } from "../utilities/platform";
import { getTelemetryReporter } from "../utilities/telemetry";
import { OutputChannelRegistry } from "../project/OutputChannelRegistry";
import { checkXcodeExists } from "../utilities/checkXcodeExists";

const DEVICE_LIST_CACHE_KEY = "device_list_cache";

export class DeviceAlreadyUsedError extends Error {}
export class DeviceManager implements DeviceManagerInterface {
  private eventEmitter = new EventEmitter();

  constructor(private readonly outputChannelRegistry: OutputChannelRegistry) {}

  public async addListener<K extends keyof DeviceManagerEventMap>(
    eventType: K,
    listener: DeviceManagerEventListener<K>
  ) {
    this.eventEmitter.addListener(eventType, listener);
  }

  public async removeListener<K extends keyof DeviceManagerEventMap>(
    eventType: K,
    listener: DeviceManagerEventListener<K>
  ) {
    this.eventEmitter.removeListener(eventType, listener);
  }

  public async acquireDevice(deviceInfo: DeviceInfo) {
    if (deviceInfo.platform === DevicePlatform.IOS) {
      if (Platform.OS !== "macos") {
        throw new Error("Invalid platform. Expected macos.");
      }

      const simulators = await listSimulators();
      const simulatorInfo = simulators.find((device) => device.id === deviceInfo.id);
      if (!simulatorInfo || simulatorInfo.platform !== DevicePlatform.IOS) {
        throw new Error(`Simulator ${deviceInfo.id} not found`);
      }
      const device = new IosSimulatorDevice(
        simulatorInfo.UDID,
        simulatorInfo,
        this.outputChannelRegistry
      );
      if (await device.acquire()) {
        return device;
      } else {
        device.dispose();
      }
    } else {
      const emulators = await listEmulators();
      const emulatorInfo = emulators.find((device) => device.id === deviceInfo.id);
      if (!emulatorInfo || emulatorInfo.platform !== DevicePlatform.Android) {
        throw new Error(`Emulator ${deviceInfo.id} not found`);
      }
      const device = new AndroidEmulatorDevice(
        emulatorInfo.avdId,
        emulatorInfo,
        this.outputChannelRegistry
      );
      if (await device.acquire()) {
        return device;
      } else {
        device.dispose();
      }
    }

    throw new DeviceAlreadyUsedError();
  }

  private loadDevicesPromise: Promise<DeviceInfo[]> | undefined;

  private async loadDevices(forceReload = false) {
    const previousDevices = extensionContext.globalState.get(DEVICE_LIST_CACHE_KEY) as
      | DeviceInfo[]
      | undefined;
    if (forceReload) {
      // Clear the cache when force reload is requested
      extensionContext.globalState.update(DEVICE_LIST_CACHE_KEY, undefined);
    }
    if (!this.loadDevicesPromise || forceReload) {
      this.loadDevicesPromise = this.loadDevicesInternal().then((devices) => {
        this.loadDevicesPromise = undefined;
        extensionContext.globalState.update(DEVICE_LIST_CACHE_KEY, devices);
        return devices;
      });
    }
    const devices = await this.loadDevicesPromise;
    if (!_.isEqual(previousDevices, devices)) {
      // Emit event only if the devices list has changed
      this.eventEmitter.emit("devicesChanged", devices);
    }
    return devices;
  }

  private async loadDevicesInternal() {
    const emulators = listEmulators().catch((e) => {
      Logger.error("Error fetching emulators", e);
      return [];
    });

    let shouldLoadSimulators = Platform.OS === "macos";

    if (shouldLoadSimulators && !(await checkXcodeExists())) {
      shouldLoadSimulators = false;
      Logger.debug("Couldn't list iOS simulators as XCode installation wasn't found");
    }

    const simulators = shouldLoadSimulators
      ? listSimulators().catch((e) => {
          Logger.error("Error fetching simulators", e);
          return [];
        })
      : Promise.resolve([]);
    const [androidDevices, iosDevices] = await Promise.all([emulators, simulators]);
    const devices = [...androidDevices, ...iosDevices];
    return devices;
  }

  public async listInstalledAndroidImages() {
    return getAndroidSystemImages();
  }

  public listInstalledIOSRuntimes() {
    return getAvailableIosRuntimes();
  }

  public async listAllDevices() {
    const devices = extensionContext.globalState.get(DEVICE_LIST_CACHE_KEY) as
      | DeviceInfo[]
      | undefined;
    if (devices) {
      // we still want to perform load here in case anything changes, just won't wait for it
      this.loadDevices();
      return devices;
    } else {
      return await this.loadDevices();
    }
  }

  public async createAndroidDevice(
    modelId: string,
    displayName: string,
    systemImage: AndroidSystemImageInfo
  ) {
    getTelemetryReporter().sendTelemetryEvent("device-manager:create-device", {
      platform: DevicePlatform.Android,
      systemName: String(systemImage.apiLevel),
    });

    const emulator = await createEmulator(modelId, displayName, systemImage);
    await this.loadDevices(true);
    return emulator;
  }

  public async createIOSDevice(
    deviceType: IOSDeviceTypeInfo,
    displayName: string,
    runtime: IOSRuntimeInfo
  ) {
    getTelemetryReporter().sendTelemetryEvent("device-manager:create-device", {
      platform: DevicePlatform.IOS,
      systemName: String(runtime.version),
    });

    const simulator = await createSimulator(
      deviceType.identifier,
      displayName,
      runtime,
      SimulatorDeviceSet.RN_IDE
    );
    await this.loadDevices(true);
    return simulator;
  }

  public async renameDevice(device: DeviceInfo, newDisplayName: string) {
    if (device.platform === DevicePlatform.IOS) {
      await renameIosSimulator(device.UDID, newDisplayName);
    }
    if (device.platform === DevicePlatform.Android) {
      await renameEmulator(device.avdId, newDisplayName);
    }
    await this.loadDevices();
  }

  public async removeDevice(device: DeviceInfo) {
    getTelemetryReporter().sendTelemetryEvent("device-manager:remove-device", {
      platform: device.platform,
      systemName: String(device.systemName),
    });

    if (device.platform === DevicePlatform.IOS) {
      await removeIosSimulator(device.UDID, SimulatorDeviceSet.RN_IDE);
    }
    if (device.platform === DevicePlatform.Android) {
      await removeEmulator(device.avdId);
    }
    await this.loadDevices();
    this.eventEmitter.emit("deviceRemoved", device);
  }
}
