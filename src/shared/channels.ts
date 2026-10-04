export const CHANNELS = {
  chooseWorld: 'mapper:choose-world',
  listMaps: 'mapper:list-maps',
  loadMap: 'mapper:load-map',
  prepareTiles: 'mapper:prepare-tiles',
  readFeature: 'mapper:read-feature',
  saveFeature: 'mapper:save-feature',
  recoverFeature: 'mapper:recover-feature',
  flushSaves: 'mapper:flush-saves',
  finishClose: 'mapper:finish-close',
  tileProgress: 'mapper:tile-progress',
  closeRequested: 'mapper:close-requested',
} as const

export const RESOURCE_SCHEME = 'mapper-resource'
