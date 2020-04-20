# electron-builder-notarize-pkg [![Build Status](https://travis-ci.com/karaggeorge/electron-builder-notarize-pkg.svg?branch=master)](https://travis-ci.com/karaggeorge/electron-builder-notarize-pkg)

> Notarize Electron applications using electron-builder

This package is meant to be used along side [electron-builder](https://github.com/electron-userland/electron-builder) and [electron-builder-notarize](https://github.com/karaggeorge/electron-builder-notarize)

## Install

```
# npm
npm i electron-builder-notarize-pkg --save-dev

# yarn
yarn add electron-builder-notarize-pkg --dev
```

## Usage

In your electron-builder config:

```json
{
	...
  "afterAllArtifactBuild": "electron-builder-notarize-pkg",
}
```

You will also need to authenticate yourself, either with your Apple ID or using an API key. This is done by setting the corresponding environment variables.

### Apple ID

- `APPLE_ID`: The username of your Apple developer account.
- `APPLE_ID_PASSWORD`: An app-specific password. You can create one at [appleid.apple.com](https://appleid.apple.com).

### API Key

- `API_KEY_ID`: The ID of your App Store Connect API key, which can be generated [here](https://appstoreconnect.apple.com/access/api).
- `API_KEY_ISSUER_ID`: The issuer ID of your API key, which can be looked up on the same site.

You will also need the API key `.p8` file at the correct location on your file system. See [`electron-notarize`](https://github.com/electron/electron-notarize)'s docs for details on this setup.

### Multiple Teams

If your developer account is a member of multiple teams or organizations, you might see an error. In this case, you need to provide your [Team Short Name](https://github.com/electron/electron-notarize#notes-on-your-team-short-name) as an environment variable:

```sh
export TEAM_SHORT_NAME=XXXXXXXXX
```

### Product Sign Certificate Name

You will need to provide your certificate name for the signing.

You can find the name of your certificates in Keychain Access. Be careful to use the "Installer" certificate, not the "Application Certificate"

```sh
export PSC_NAME='Developer ID Installer: NAME (1234ABCDEFG)'
```

## Credits

This package is inspired by this [wiki](https://github.com/Wicklets/wick-editor/wiki/Building-Desktop-Editors-for-Release#part-4-signing-and-notarizing-installers-for-macos)

## License

MIT
