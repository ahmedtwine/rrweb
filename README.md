## Development
1. Run `yarn install` in the root to install required dependencies for all sub-packages (note: `npm install` is _not_ recommended).
2. Download Just: `brew install just`
3. Run `just dev-web-extension` to start the development server.
4. Run `just build-web-extension` to build the web extension. The output will be in `packages/web-extension/dist`. Load the unpacked extension in Chrome.
