// Whether the SDK was started in this process. Lets call-site wrappers (@Traced) be a plain
// pass-through when telemetry is off, rather than relying on no-op API objects.
let active = false;

export const isTelemetryActive = (): boolean => active;
export const setTelemetryActive = (value: boolean): void => {
  active = value;
};
