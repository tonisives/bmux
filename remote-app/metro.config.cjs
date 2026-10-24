let { getDefaultConfig } = require('expo/metro-config')
let path = require('node:path')
let config = getDefaultConfig(__dirname)
config.watchFolders = [path.resolve(__dirname, '..')]
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules'), path.resolve(__dirname, '../node_modules')]
config.maxWorkers = 4
module.exports = config
