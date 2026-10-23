/**
 * Does a request match an active ban? — pure, so every rule is tested (ban-match.test.ts).
 *
 *   · the signed-in account                → banned
 *   · the device's own id                  → banned
 *   · the device fingerprint               → banned (survives clearing storage)
 *   · the network address, ONLY together with the same browser string → banned
 *
 * 🔴 Never the network address alone: many mobile users in one city leave through ONE carrier address
 * (carrier-grade NAT), so an address-only ban would lock out strangers who share it.
 */

export interface BanRow {
  user_id: string | null;
  device_id: string | null;
  fingerprint: string | null;
  ip: string | null;
  user_agent: string | null;
}

export interface BanIndex {
  users: Set<string>;
  devices: Set<string>;
  fingerprints: Set<string>;
  /** `${ip}|${userAgent}` */
  ipBrowsers: Set<string>;
}

export interface BanProbe {
  userId?: string | null;
  deviceId?: string | null;
  fingerprint?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export function matchBan(index: BanIndex, p: BanProbe): boolean {
  if (p.userId && index.users.has(p.userId)) return true;
  if (p.deviceId && index.devices.has(p.deviceId)) return true;
  if (p.fingerprint && index.fingerprints.has(p.fingerprint)) return true;
  if (p.ip && p.userAgent && index.ipBrowsers.has(`${p.ip}|${p.userAgent.slice(0, 512)}`)) return true;
  return false;
}
