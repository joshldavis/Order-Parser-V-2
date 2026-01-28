import { ReferencePack } from "../referencePack.schema"

export class ReferenceService {
  constructor(private ref: ReferencePack) {}

  normalizeManufacturer(text: string) {
    if (!text) return undefined;
    const t = text.toLowerCase()
    return this.ref.manufacturers.find(m =>
      [m.abbr, m.name, ...m.aliases]
        .some(a => t.includes(a.toLowerCase()))
    )
  }

  normalizeFinish(text: string) {
    if (!text) return undefined;
    const t = text.toUpperCase()
    return this.ref.finishes.find(f =>
      t.includes(f.us_code) || (f.bhma_code && t.includes(f.bhma_code))
    )
  }

  detectCategory(text: string) {
    if (!text) return undefined;
    const t = text.toLowerCase()
    return this.ref.categories.find(c =>
      t.includes(c.gordon_symbol.toLowerCase())
    )
  }

  detectElectrifiedDevice(text: string) {
    if (!text) return undefined;
    const t = text.toLowerCase()
    return this.ref.electrified_devices.find(d =>
      d.keywords.some(k => t.includes(k.toLowerCase()))
    )
  }

  detectWiring(deviceType?: string) {
    if (!deviceType) return undefined
    return this.ref.wiring_configs.find(w =>
      w.device_types.includes(deviceType)
    )
  }

  detectHardwareSet(text: string) {
    if (!text) return undefined;
    const t = text.toLowerCase()
    return this.ref.hardware_sets.find(s =>
      s.keywords.some(k => t.includes(k.toLowerCase()))
    )
  }
}
