import { BuildType } from "./BuildConfig";
import { DeviceInfo, DevicePlatform } from "./DeviceManager";
import { LaunchConfiguration } from "./LaunchConfig";
import { Output } from "./OutputChannel";

export type Locale = string;

export type CameraSource = "emulated" | "none" | "webcam0";
export type FrontCameraSource = CameraSource;
export type BackCameraSource = CameraSource | "virtualscene";

export interface CameraSettings {
  back: BackCameraSource;
  front: FrontCameraSource;
}

export type DeviceSettings = {
  appearance: "light" | "dark";
  contentSize: "xsmall" | "small" | "normal" | "large" | "xlarge" | "xxlarge" | "xxxlarge";
  location: {
    latitude: number;
    longitude: number;
    isDisabled: boolean;
  };
  hasEnrolledBiometrics: boolean;
  locale: Locale;
  replaysEnabled: boolean;
  showTouches: boolean;
  camera?: CameraSettings;
};

export type ToolState = {
  enabled: boolean;
  panelAvailable: boolean;
  label: string;
};

export type ToolsState = {
  [key: string]: ToolState;
};

export type BuildErrorDescriptor = {
  kind: "build";
  message: string;
  platform: DevicePlatform;
  buildType: BuildType | null;
};

export type DeviceErrorDescriptor = {
  kind: "device";
  message: string;
};

export type FatalErrorDescriptor = BuildErrorDescriptor | DeviceErrorDescriptor;

export type ProfilingState = "stopped" | "profiling" | "saving";

export type NavigationHistoryItem = {
  displayName: string;
  id: string;
};

export type NavigationRoute = {
  path: string;
  filePath: string;
  children: NavigationRoute[];
  dynamic: { name: string; deep: boolean; notFound?: boolean }[] | null;
  type: string;
};

export type DeviceSessionStatus = "starting" | "running" | "fatalError";

type DeviceSessionStateCommon = {
  deviceInfo: DeviceInfo;
  previewURL: string | undefined;
  profilingReactState: ProfilingState;
  profilingCPUState: ProfilingState;
  navigationHistory: NavigationHistoryItem[];
  navigationRouteList: NavigationRoute[];
  toolsState: ToolsState;
  isDebuggerPaused: boolean;
  logCounter: number;
  hasStaleBuildCache: boolean;
  isRecordingScreen: boolean;
};

export type DeviceSessionStateStarting = DeviceSessionStateCommon & {
  status: "starting";
  startupMessage: StartupMessage | undefined;
  stageProgress: number | undefined;
};

export type BundleErrorDescriptor = {
  kind: "bundle";
  message: string;
};

export type DeviceSessionStateRunning = DeviceSessionStateCommon & {
  status: "running";
  isRefreshing: boolean;
  bundleError: BundleErrorDescriptor | undefined;
  appOrientation: DeviceRotation | undefined;
};

export type DeviceSessionStateFatalError = DeviceSessionStateCommon & {
  status: "fatalError";
  error: FatalErrorDescriptor;
};

export type DeviceSessionState =
  | DeviceSessionStateStarting
  | DeviceSessionStateRunning
  | DeviceSessionStateFatalError;

export type DeviceId = DeviceInfo["id"];

export interface DeviceSessionsManagerState {
  selectedSessionId: DeviceId | null;
  deviceSessions: Record<DeviceId, DeviceSessionState>;
}

export type ConnectState = {
  enabled: boolean;
  connected: boolean;
};

export type ProjectState = {
  initialized: boolean;
  appRootPath: string | undefined;
  previewZoom: ZoomLevelType | undefined; // Preview specific. Consider extracting to different location if we store more preview state
  selectedLaunchConfiguration: LaunchConfiguration;
  customLaunchConfigurations: LaunchConfiguration[];
  connectState: ConnectState;
} & DeviceSessionsManagerState;

export type ZoomLevelType = number | "Fit";

export type AppPermissionType = "all" | "location" | "photos" | "contacts" | "calendar";

export type DeviceButtonType = "home" | "back" | "appSwitch" | "volumeUp" | "volumeDown" | "power";

export enum DeviceRotation {
  Portrait = "Portrait",
  PortraitUpsideDown = "PortraitUpsideDown",
  LandscapeLeft = "LandscapeLeft",
  LandscapeRight = "LandscapeRight",
}

export enum DeviceRotationDirection {
  Clockwise = -1,
  Anticlockwise = 1,
}

export type AppOrientation = DeviceRotation | "Landscape";

export function isOfEnumDeviceRotation(value: any): value is DeviceRotation {
  return Object.values(DeviceRotation).includes(value);
}

// important: order of values in this enum matters
export enum StartupMessage {
  InitializingDevice = "Initializing device",
  StartingPackager = "Starting packager",
  BootingDevice = "Booting device",
  Building = "Building",
  Installing = "Installing",
  Launching = "Launching",
  WaitingForAppToLoad = "Waiting for app to load",
  AttachingDebugger = "Attaching debugger",
  Restarting = "Restarting",
}

export const StartupStageWeight = [
  { StartupMessage: StartupMessage.InitializingDevice, weight: 1 },
  { StartupMessage: StartupMessage.StartingPackager, weight: 1 },
  { StartupMessage: StartupMessage.BootingDevice, weight: 2 },
  { StartupMessage: StartupMessage.Building, weight: 7 },
  { StartupMessage: StartupMessage.Installing, weight: 1 },
  { StartupMessage: StartupMessage.Launching, weight: 1 },
  { StartupMessage: StartupMessage.WaitingForAppToLoad, weight: 6 },
  { StartupMessage: StartupMessage.AttachingDebugger, weight: 1 },
];

export type Frame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type InspectDataStackItem = {
  componentName: string;
  hide: boolean;
  source: {
    fileName: string;
    line0Based: number;
    column0Based: number;
  };
  frame: Frame;
};

export type InspectStackData = {
  requestLocation: { x: number; y: number };
  stack: InspectDataStackItem[];
};

export type InspectData = {
  stack: InspectDataStackItem[] | undefined;
  frame?: Frame;
};

export type TouchPoint = {
  xRatio: number;
  yRatio: number;
};

export enum ActivateDeviceResult {
  succeeded,
  notEnoughSeats,
  keyVerificationFailed,
  unableToVerify,
  connectionFailed,
}

export interface ProjectEventMap {
  projectStateChanged: ProjectState;
  deviceSettingsChanged: DeviceSettings;
  licenseActivationChanged: boolean;
  replayDataCreated: MultimediaData;
}

export interface ProjectEventListener<T> {
  (event: T): void;
}

export type MultimediaData = {
  url: string;
  tempFileLocation: string;
  fileName: string;
};

export interface ProjectInterface {
  getProjectState(): Promise<ProjectState>;
  renameDevice(deviceInfo: DeviceInfo, newDisplayName: string): Promise<void>;
  updatePreviewZoomLevel(zoom: ZoomLevelType): Promise<void>;

  /**
   * Creates a new launch configuration or updates an existing one.
   *
   * If the `oldLaunchConfiguration` matches the currently selected launch configuration,
   * the newly created or updated configuration will be selected.
   *
   * @param newLaunchConfiguration - The options for the new or updated launch configuration. If `undefined`, the existing configuration will be removed.
   * @param oldLaunchConfiguration - (Optional) The existing launch configuration to update.
   * @returns A promise that resolves when the operation is complete.
   */
  createOrUpdateLaunchConfiguration(
    newLaunchConfiguration: LaunchConfiguration | undefined,
    oldLaunchConfiguration?: LaunchConfiguration
  ): Promise<void>;
  selectLaunchConfiguration(launchConfig: LaunchConfiguration): Promise<void>;

  runDependencyChecks(): Promise<void>;

  getDeviceSettings(): Promise<DeviceSettings>;
  updateDeviceSettings(deviceSettings: DeviceSettings): Promise<void>;
  runCommand(command: string): Promise<void>;

  updateToolEnabledState(toolName: keyof ToolsState, enabled: boolean): Promise<void>;
  openTool(toolName: keyof ToolsState): Promise<void>;

  enableRadonConnect(): Promise<void>;
  disableRadonConnect(): Promise<void>;

  resumeDebugger(): Promise<void>;
  stepOverDebugger(): Promise<void>;
  focusOutput(channel: Output): Promise<void>;
  focusDebugConsole(): Promise<void>;
  openNavigation(navigationItemID: string): Promise<void>;
  navigateBack(): Promise<void>;
  navigateHome(): Promise<void>;
  removeNavigationHistoryEntry(id: string): Promise<void>;
  openDevMenu(): Promise<void>;

  activateLicense(activationKey: string): Promise<ActivateDeviceResult>;
  hasActiveLicense(): Promise<boolean>;

  resetAppPermissions(permissionType: AppPermissionType): Promise<void>;

  getDeepLinksHistory(): Promise<string[]>;
  openDeepLink(link: string, terminateApp: boolean): Promise<void>;

  startRecording(): void;
  captureAndStopRecording(): void;
  captureReplay(): void;
  captureScreenshot(): void;

  startProfilingCPU(): void;
  stopProfilingCPU(): void;

  startProfilingReact(): void;
  stopProfilingReact(): void;

  dispatchTouches(touches: Array<TouchPoint>, type: "Up" | "Move" | "Down"): void;
  dispatchKeyPress(keyCode: number, direction: "Up" | "Down"): void;
  dispatchButton(buttonType: DeviceButtonType, direction: "Up" | "Down"): void;
  dispatchWheel(point: TouchPoint, deltaX: number, deltaY: number): void;
  dispatchPaste(text: string): Promise<void>;
  dispatchCopy(): Promise<void>;

  inspectElementAt(
    xRatio: number,
    yRatio: number,
    requestStack: boolean,
    callback: (inspectData: InspectData) => void
  ): Promise<void>;

  addListener<K extends keyof ProjectEventMap>(
    eventType: K,
    listener: ProjectEventListener<ProjectEventMap[K]>
  ): Promise<void>;
  removeListener<K extends keyof ProjectEventMap>(
    eventType: K,
    listener: ProjectEventListener<ProjectEventMap[K]>
  ): Promise<void>;
}
