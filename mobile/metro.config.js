const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const config = getDefaultConfig(__dirname)

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

// Keep Expo defaults and append workspace root for monorepo packages.
config.watchFolders = Array.from(new Set([...(config.watchFolders || []), workspaceRoot]))

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

module.exports = config
