import { DeviceRotation } from "../../common/Project";

type NormalizedFrameRect = {
  width: number;
  height: number;
  x: number;
  y: number;
};

type NormalizedCoordinates = {
  x: number;
  y: number;
};

type OrientationPredicates = {
  actualPortaitAppLeft: boolean;
  actualPortaitAppRight: boolean;
  actualUpsideDownAppPortrait: boolean;
  actualUpsideDownAppLeft: boolean;
  actualUpsideDownAppRight: boolean;
  actualLeftAppPortrait: boolean;
  actualRightAppPortrait: boolean;
};

function getOrientationPredicates(
  appOrientation: DeviceRotation,
  deviceOrientation: DeviceRotation
): OrientationPredicates {
  const actualPortaitAppLeft =
    deviceOrientation === DeviceRotation.Portrait &&
    appOrientation === DeviceRotation.LandscapeLeft;

  const actualPortaitAppRight =
    deviceOrientation === DeviceRotation.Portrait &&
    appOrientation === DeviceRotation.LandscapeRight;
  const actualUpsideDownAppPortrait =
    deviceOrientation === DeviceRotation.PortraitUpsideDown &&
    appOrientation === DeviceRotation.Portrait;
  const actualUpsideDownAppLeft =
    deviceOrientation === DeviceRotation.PortraitUpsideDown &&
    appOrientation === DeviceRotation.LandscapeLeft;
  const actualUpsideDownAppRight =
    deviceOrientation === DeviceRotation.PortraitUpsideDown &&
    appOrientation === DeviceRotation.LandscapeRight;
  const actualLeftAppPortrait =
    deviceOrientation === DeviceRotation.LandscapeLeft &&
    appOrientation === DeviceRotation.Portrait;
  const actualRightAppPortrait =
    deviceOrientation === DeviceRotation.LandscapeRight &&
    appOrientation === DeviceRotation.Portrait;

  return {
    actualPortaitAppLeft,
    actualPortaitAppRight,
    actualUpsideDownAppPortrait,
    actualUpsideDownAppLeft,
    actualUpsideDownAppRight,
    actualLeftAppPortrait,
    actualRightAppPortrait,
  };
}

/**
 * Transform coordinates and rects from app's coordinate system to preview's coordinate system.
 * @param appOrientation - Current orientation of the app.
 * @param deviceOrientation - Current orientation of the device.
 * @param frameRect - Coordinates and frame rects in app coordinate system.
 * @returns Coordinates and frame rects in preview coordinate system.
 *  The transform is needed to account of change of origin point after both - the device preview rotation
 *  and app orientation - change, synchronizing the app's coordinate system with the preview's coordinate system.
 * */
export function appToPreviewCoordinates(
  appOrientation: DeviceRotation | undefined,
  deviceOrientation: DeviceRotation,
  frameRect: NormalizedFrameRect
): NormalizedFrameRect {
  if (!appOrientation) {
    // if the app orientation is undefined, we assume that
    // the app's orientation is the same as the device's rotation
    return frameRect;
  }

  let newX = frameRect.x;
  let newY = frameRect.y;
  let newWidth = frameRect.width;
  let newHeight = frameRect.height;

  const {
    actualPortaitAppLeft,
    actualPortaitAppRight,
    actualUpsideDownAppPortrait,
    actualUpsideDownAppLeft,
    actualUpsideDownAppRight,
    actualLeftAppPortrait,
    actualRightAppPortrait,
  } = getOrientationPredicates(appOrientation, deviceOrientation);

  if (actualPortaitAppRight || actualUpsideDownAppLeft) {
    // if the screen is in landscape mode, we need to swap width and height
    newX = newY;
    newY = 1 - frameRect.x - frameRect.width;
    newWidth = newHeight;
    newHeight = frameRect.width;
  }

  if (actualPortaitAppLeft || actualUpsideDownAppRight) {
    newX = 1 - newY - frameRect.height;
    newY = frameRect.x;
    newWidth = newHeight;
    newHeight = frameRect.width;
  }

  if (actualUpsideDownAppPortrait) {
    newX = 1 - frameRect.x - frameRect.width;
    newY = 1 - frameRect.y - frameRect.height;
    newWidth = frameRect.width;
    newHeight = frameRect.height;
  }

  if (actualLeftAppPortrait) {
    newX = newY;
    newY = 1 - frameRect.x - frameRect.width;
    newWidth = newHeight;
    newHeight = frameRect.width;
  }

  if (actualRightAppPortrait) {
    newX = 1 - newY - frameRect.height;
    newY = frameRect.x;
    newWidth = newHeight;
    newHeight = frameRect.width;
  }

  // implicitly handles isLandscape &&  deviceOrientation === DeviceRotation.LandscapeLeft ||
  //              isLandscape && deviceOrientation === DeviceRotation.LandscapeRight
  return {
    x: newX,
    y: newY,
    width: newWidth,
    height: newHeight,
  };
}

/**
 * Transform coordinates from preview's coordinate system to app's coordinate system.
 * @param appOrientation - Current orientation of the app.
 * @param deviceOrientation - Current orientation of the device.
 * @param coords - x,y coordinates in preview coordinate system.
 * @returns x,y coordinates in app coordinate system.
 *  The transform is needed to account of change of origin point after both - the device preview rotation
 *  and app orientation - change, synchronizing the preview's coordinate system with the app's coordinate system.
 * */
export function previewToAppCoordinates(
  appOrientation: DeviceRotation | undefined,
  deviceOrientation: DeviceRotation,
  coords: NormalizedCoordinates
): NormalizedCoordinates {
  if (!appOrientation) {
    // if the app orientation is undefined, we assume that
    // the app's orientation is the same as the device's rotation
    return coords;
  }

  const { x, y } = coords;
  let newX = x;
  let newY = y;

  const {
    actualPortaitAppLeft,
    actualPortaitAppRight,
    actualUpsideDownAppPortrait,
    actualUpsideDownAppLeft,
    actualUpsideDownAppRight,
    actualLeftAppPortrait,
    actualRightAppPortrait,
  } = getOrientationPredicates(appOrientation, deviceOrientation);

  if (actualPortaitAppRight || actualUpsideDownAppLeft) {
    newX = 1 - coords.y;
    newY = coords.x;
  }

  if (actualPortaitAppLeft || actualUpsideDownAppRight) {
    newX = coords.y;
    newY = 1 - coords.x;
  }

  if (actualUpsideDownAppPortrait) {
    newX = 1 - coords.x;
    newY = 1 - coords.y;
  }

  if (actualLeftAppPortrait) {
    newX = 1 - coords.y;
    newY = coords.x;
  }

  if (actualRightAppPortrait) {
    newX = coords.y;
    newY = 1 - coords.x;
  }

  return { x: newX, y: newY };
}
