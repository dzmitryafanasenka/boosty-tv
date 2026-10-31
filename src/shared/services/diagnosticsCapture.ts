import type { KeyValueStore } from '../platform/keyValueStore';
import { createDevicePreference, type DevicePreference } from '../storage/devicePreference';
import { logFileSink, type LogFileSink } from './logFileSink';
import { logger as appLogger, type Logger } from './logger';

/**
 * «Запись логов» (Story 8.3): a device preference (`createDevicePreference`),
 * default off, one KeyValueStore key holding `on` or `off`. It is not
 * registered with AccountScope: the toggle survives sign-out (the file
 * itself does not). Every value memory takes is applied to the sink: on
 * enables it, off disables it and deletes the file (a failed delete is
 * logged).
 */
export const DIAGNOSTICS_CAPTURE_KEY = 'diagnostics.capture.v1';

export type DiagnosticsCapture = DevicePreference<boolean> & {
  /** «Очистить логи»: the ring and the file. Resolves false when the file was not cleared. */
  clearLogs(): Promise<boolean>;
};

export type DiagnosticsCaptureOptions = {
  /** Defaults to the app's device store (`setDevicePreferenceKeyValueStore`). */
  kv?: () => KeyValueStore;
  logger?: Logger;
};

export function createDiagnosticsCapture(
  sink: LogFileSink,
  { kv, logger = appLogger }: DiagnosticsCaptureOptions = {},
): DiagnosticsCapture {
  const preference = createDevicePreference<boolean>({
    key: DIAGNOSTICS_CAPTURE_KEY,
    // Anything but `on` is off.
    parse: raw => raw === 'on',
    serialize: on => (on ? 'on' : 'off'),
    fallback: false,
    scope: 'diagnostics',
    label: 'capture preference',
    kv,
    logger,
    onValue: on => {
      if (on) {
        sink.enable();
      } else {
        sink.disable().catch(() => logger.warn('diagnostics', 'log file not cleared'));
      }
    },
  });
  return {
    fallback: preference.fallback,
    peek: preference.peek,
    read: preference.read,
    write: preference.write,
    forget: preference.forget,
    clearLogs() {
      return sink.clear().then(
        () => true,
        () => {
          logger.warn('diagnostics', 'log file not cleared');
          return false;
        },
      );
    },
  };
}

/** The app's «Запись логов» toggle, driving `logFileSink` (the device store, `setDevicePreferenceKeyValueStore`). */
export const diagnosticsCapture: DiagnosticsCapture = createDiagnosticsCapture(logFileSink);
