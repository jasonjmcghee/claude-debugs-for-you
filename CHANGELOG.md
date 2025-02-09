# Change Log

All notable changes to the "claude-debugs-for-you" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.4]

### Major Changes
- Replaced raw TCP server with HTTP/SSE server for improved reliability and standards compliance
- Consolidated server functionality into a single unified instance
- Added proper session management and message routing
- Implemented CORS handling and health check endpoints
- Added status bar integration with server status and SSE address
- Added command to copy SSE address to clipboard
- Improved error handling and logging through dedicated output channel
- Migrated build system to Vite for better module handling and debugging support
- Added automatic server startup on extension activation

### Developer Experience
- Enhanced debugging support with preserved variable names and source maps
- Improved error messages and logging
- Added proper cleanup on extension deactivation
- Updated TypeScript configuration for better module resolution

## [0.0.3]

- Change built mcp server to be CJS instead of ESM by @jasonjmcghee in #4
- Adds Windows compatibility by fixing a bug by @dkattan in #3, fixing #2

## [0.0.2]

- Adds ability to configure the port of the MCP Server

## [0.0.1]

- Initial release (built initial prototype in hackathon)
- Added support for conditional breakpoints
- Added support for automatically opening the file for debug
- Restructured to work well with .visx and to be language agnostic