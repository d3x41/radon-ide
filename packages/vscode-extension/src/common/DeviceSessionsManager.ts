import { DeviceInfo } from "./DeviceManager";
import { DeviceId } from "./Project";

export type SelectDeviceOptions = {
  stopPreviousDevices?: boolean;
};

export type ReloadAction =
  | "autoReload" // automatic reload mode
  | "restartMetro"
  | "clearMetro" // clear metro cache, boot device, install app
  | "rebuild" // clean build, boot device, install app
  | "reboot" // reboots device, launch app
  | "reinstall" // force reinstall app
  | "restartProcess" // relaunch app
  | "reloadJs"; // refetch JS scripts from metro

export interface DeviceSessionsManagerInterface {
  reloadCurrentSession(type: ReloadAction): Promise<void>;
  startOrActivateSessionForDevice(
    deviceInfo: DeviceInfo,
    selectDeviceOptions?: SelectDeviceOptions
  ): Promise<void>;
  terminateSession(deviceId: DeviceId): Promise<void>;
}
