# Smart Proxy Extension

A Chrome extension for managing proxy settings easily and efficiently.

## Features

- Enable/disable proxy with a simple toggle
- Support for HTTP, HTTPS, SOCKS4, and SOCKS5 proxies
- Username and password authentication
- Customizable bypass list for specific domains
- Simple and user-friendly interface

## Installation for Development

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" by clicking the toggle in the top-right corner
4. Click "Load unpacked" and select the extension directory
5. The extension should now be installed and visible in your extensions list

## How to Use

1. Click on the extension icon in the Chrome toolbar
2. Toggle the switch to enable/disable the proxy
3. Configure your proxy settings:
   - Select the proxy type (HTTP, HTTPS, SOCKS4, SOCKS5)
   - Enter the server address and port
   - If required, enter your username and password
   - Add domains to the bypass list to exclude them from the proxy (one per line)
4. Click "Save Settings" to apply the changes

## Project Structure

- `manifest.json`: Extension configuration file
- `popup.html`: The popup UI that appears when clicking the extension icon
- `css/popup.css`: Styles for the popup interface
- `js/popup.js`: JavaScript for handling user interactions in the popup
- `background.js`: Service worker that manages proxy settings in the background
- `icons/`: Directory containing icon files for the extension

## Development Notes

- This extension uses Manifest V3, the latest extension manifest version for Chrome
- The background script runs as a service worker
- Proxy settings are stored using Chrome's Storage Sync API, allowing settings to sync across devices
- The extension uses Chrome's Proxy API to configure the browser's proxy settings

## Permissions Used

- `storage`: For saving user preferences
- `proxy`: For modifying Chrome's proxy settings
- `webRequest`: For handling web requests through the proxy
- `webRequestBlocking`: For blocking web requests if needed

## Building for Production

To package the extension for distribution:

1. Make sure all code is finalized and tested
2. Remove any development-only files or comments
3. Compress the extension directory into a ZIP file
4. If you plan to publish to the Chrome Web Store, visit the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
