export interface ManufacturerRef {
  abbr: string
  name: string
  aliases: string[]
}

export interface FinishRef {
  us_code: string
  bhma_code?: string
  name: string
}

export interface CategoryRef {
  gordon_symbol: string
  category: string
  subcategory?: string
}

export interface ElectrifiedDeviceRef {
  device_type: string
  voltage?: string[]
  fail_modes?: string[]
  keywords: string[]
}

export interface WiringConfigRef {
  name: string
  device_types: string[]
  wire_count?: number
}

export interface HardwareSetTemplate {
  template_id: string
  keywords: string[]
  defaults: Record<string, string>
}

export interface ReferencePack {
  version: string
  updated_at?: string
  changelog?: string[]
  manufacturers: ManufacturerRef[]
  finishes: FinishRef[]
  categories: CategoryRef[]
  electrified_devices: ElectrifiedDeviceRef[]
  wiring_configs: WiringConfigRef[]
  hardware_sets: HardwareSetTemplate[]
}