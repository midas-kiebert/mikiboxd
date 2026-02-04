// mobile/metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Point to the workspace root so Metro can find the shared package
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

// Watch the entire monorepo
config.watchFolders = [workspaceRoot];

// Let Metro know where to find node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
