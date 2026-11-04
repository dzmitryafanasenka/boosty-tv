import { Platform } from 'react-native';

/**
 * The device text for a bug report (Story 15.1): «<manufacturer> <model>,
 * Android <release>» from `Platform.constants` (Android's
 * PlatformConstants: `Manufacturer`, `Model`, `Release`). No new native
 * module. Not account data, but it is never logged.
 */

type DeviceConstants = Record<string, unknown>;

function field(constants: DeviceConstants, key: string): string | null {
  const value = constants[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** The model starts with the manufacturer as a whole word («LG OLED», not «LGenius»). */
function namesManufacturer(model: string, manufacturer: string): boolean {
  const lower = model.toLowerCase();
  const prefix = manufacturer.toLowerCase();
  if (!lower.startsWith(prefix)) {
    return false;
  }
  const next = lower.charAt(prefix.length);
  return next === '' || next === ' ' || next === '-' || next === '_';
}

/**
 * «Google Chromecast, Android 14». A model that already starts with the
 * manufacturer is not repeated. Unknown parts are left out; null when
 * nothing is known. `constants` is for tests.
 */
export function getDeviceDescription(
  constants: DeviceConstants | undefined = Platform.constants as unknown as DeviceConstants | undefined,
): string | null {
  if (!constants || typeof constants !== 'object') {
    return null;
  }
  const manufacturer = field(constants, 'Manufacturer');
  const model = field(constants, 'Model');
  const release = field(constants, 'Release');
  let device: string | null;
  if (manufacturer && model) {
    device = namesManufacturer(model, manufacturer) ? model : `${manufacturer} ${model}`;
  } else {
    device = model ?? manufacturer;
  }
  const android = release ? `Android ${release}` : null;
  const parts = [device, android].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(', ') : null;
}
