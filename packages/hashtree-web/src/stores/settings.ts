/**
 * Settings store - simplified version for hashtree-web
 */
import { create } from 'zustand'

export interface SettingsState {
  appearance: Record<string, unknown>
  content: Record<string, unknown>
  imgproxy: Record<string, unknown>
  notifications: Record<string, unknown>
  network: {
    negentropyEnabled: boolean
  }
  desktop: Record<string, unknown>
  debug: Record<string, unknown>
  legal: Record<string, unknown>
}

export const useSettingsStore = create<SettingsState>(() => ({
  appearance: {},
  content: {},
  imgproxy: {},
  notifications: {},
  network: {
    negentropyEnabled: false,
  },
  desktop: {},
  debug: {},
  legal: {},
}))
