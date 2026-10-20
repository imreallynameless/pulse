export interface Reading { bpm: number; measuredAt: number }
export interface Tokens { access_token: string; refresh_token?: string; expiresAt: number; expires_in?: number }
export interface TokenResponse { access_token?: string; refresh_token?: string; expires_in?: number }
export interface HeartRatePage {
  dataPoints?: Array<{heartRate?: {beatsPerMinute?: string | number; sampleTime?: {physicalTime?: string}}; dataSource?: {platform?: string}}>;
  nextPageToken?: string;
}
export interface CloudSnapshot { feed?: string; sharing?: boolean; latest?: Reading | null; checkedAt?: number | null; error?: boolean }
export interface PublicSnapshot { status: 'waiting' | 'paused' | 'latest'; reading: Reading | null; serverTime: number }
