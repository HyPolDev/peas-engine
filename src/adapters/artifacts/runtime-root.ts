import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function defaultPeasRuntimeRoot(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === "win32") {
    const local = environment["LOCALAPPDATA"];
    if (local === undefined || local === "") throw new Error("LOCALAPPDATA is required on Windows");
    return resolve(local, "peas-engine");
  }
  if (platform === "linux") {
    const xdg = environment["XDG_DATA_HOME"];
    return resolve(
      xdg === undefined || xdg === "" ? join(homedir(), ".local", "share") : xdg,
      "peas-engine",
    );
  }
  throw new Error(`No default PEAS runtime root for ${platform}; configure it explicitly`);
}
