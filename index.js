const execa = require('execa');
const path = require('path');
const fs = require('fs');
const delay = require('delay');
const util = require('builder-util');

/**
 * Validates and returns authentication-related environment variables
 * @return {{appleApiIssuer: string, appleIdPassword: string, appleApiKey: string, appleId: string}}
 * Environment variable values
 */
const getAuthInfo = () => {
  const {
    APPLE_ID: appleId,
    APPLE_ID_PASSWORD: appleIdPassword,
    API_KEY_ID: appleApiKey,
    API_KEY_ISSUER_ID: appleApiIssuer,
    TEAM_SHORT_NAME: teamShortName,
    PSC_NAME: productSignCertificateName
  } = process.env;

  if (!productSignCertificateName) {
    throw new Error(
      'PSC_NAME is required for product signing.'
    );
  }

  if (!appleId && !appleIdPassword && !appleApiKey && !appleApiIssuer) {
    throw new Error(
      'Authentication environment variables for notarization are missing. Either APPLE_ID and ' +
      'APPLE_ID_PASSWORD, or API_KEY_ID and API_KEY_ISSUER_ID must be defined.'
    );
  }

  if ((appleId || appleIdPassword) && (appleApiKey || appleApiIssuer)) {
    throw new Error(
      'Should only provide either Apple ID or API key environment variables.'
    );
  }

  if ((appleId && !appleIdPassword) || (!appleId && appleIdPassword)) {
    throw new Error(
      'One of APPLE_ID and APPLE_ID_PASSWORD environment variables is missing for notarization.'
    );
  }

  if ((appleApiKey && !appleApiIssuer) || (!appleApiKey && appleApiIssuer)) {
    throw new Error(
      'One of API_KEY_ID and API_KEY_ISSUER_ID environment variables is missing for notarization.'
    );
  }

  return {
    appleId,
    appleIdPassword,
    appleApiKey,
    appleApiIssuer,
    teamShortName,
    productSignCertificateName
  };
};

const isEnvTrue = value => {
  // eslint-disable-next-line no-eq-null, eqeqeq
  if (value != null) {
    value = value.trim();
  }

  return value === 'true' || value === '' || value === '1';
};

const signPackage = async ({productSignCertificateName, pkgPath, signedPath}) => {
  try {
    await execa('productsign', [
      '--sign',
      productSignCertificateName,
      pkgPath,
      signedPath
    ]);
  } catch (error) {
    throw new Error(`Failed to sign ${pkgPath}\n\n${error.message}`);
  }
};

const getAuthorizingArgs = notarizeOptions => {
  const {
    appleId,
    appleIdPassword,
    appleApiKey,
    appleApiIssuer
  } = notarizeOptions;

  return appleId ? [
    '--username', appleId, '--password', appleIdPassword
  ] : [
    '--apiKey', appleApiKey, '--apiIssuer', appleApiIssuer
  ];
};

const startNotarizingPackage = async ({
  pkgPath,
  appId,
  notarizeOpts
}) => {
  try {
    const {stdout} = await execa('xcrun', [
      'altool',
      '--notarize-app',
      '--primary-bundle-id',
      appId,
      '--file',
      pkgPath,
      ...getAuthorizingArgs(notarizeOpts),
      ...(
        notarizeOpts.teamShortName ? [
          '-itc_provider', notarizeOpts.teamShortName
        ] : []
      )
    ]);

    const uuidMatch = /\nRequestUUID = (.+?)\n/g.exec(stdout);
    if (!uuidMatch) {
      throw new Error(`Failed to find request UUID in output:\n\n${stdout}`);
    }

    return uuidMatch[1];
  } catch (error) {
    throw new Error(`Failed to upload app to Apple's notarization servers\n\n${error.message}`);
  }
};

const parseNotarizationInfo = text => {
  const out = {};
  const matchToProperty = (key, r, modifier) => {
    const exec = r.exec(text);
    if (exec) {
      out[key] = modifier ? modifier(exec[1]) : exec[1];
    }
  };

  matchToProperty('uuid', /\n *RequestUUID: (.+?)\n/);
  matchToProperty('date', /\n *Date: (.+?)\n/, d => new Date(d));
  matchToProperty('status', /\n *Status: (.+?)\n/);
  matchToProperty('logFileUrl', /\n *LogFileURL: (.+?)\n/);
  matchToProperty('statusCode', /\n *Status Code: (.+?)\n/, n => Number.parseInt(n, 10));
  matchToProperty('statusMessage', /\n *Status Message: (.+?)\n/);

  if (out.logFileUrl === '(null)') {
    out.logFileUrl = null;
  }

  return out;
};

const waitForNotarize = async ({uuid, notarizeOpts}) => {
  let output;
  try {
    const {stdout} = await execa('xcrun', [
      'altool',
      '--notarization-info',
      uuid,
      ...getAuthorizingArgs(notarizeOpts)
    ]);
    output = stdout;
  } catch {
    await delay(30000);
    return waitForNotarize({uuid, notarizeOpts});
  }

  const notarizationInfo = parseNotarizationInfo(output);

  if (notarizationInfo.status === 'in progress') {
    await delay(30000);
    await waitForNotarize({uuid, notarizeOpts});
  }

  if (notarizationInfo.status === 'invalid') {
    throw new Error(`Apple failed to notarize your application, check the logs for more info

Status Code: ${notarizationInfo.statusCode || 'No Code'}
Message: ${notarizationInfo.statusMessage || 'No Message'}
Logs: ${notarizationInfo.logFileUrl}`);
  }

  if (notarizationInfo.status !== 'success') {
    throw new Error(`Unrecognized notarization status: "${notarizationInfo.status}"`);
  }
};

const stapleApp = async ({pkgPath}) => {
  try {
    await execa('xcrun', [
      'stapler',
      'staple',
      '-v',
      path.basename(pkgPath)
    ], {
      cwd: path.dirname(pkgPath)
    });
  } catch (error) {
    throw new Error(
      `Failed to staple your application with code: ${error.code}\n\n${error.message}`
    );
  }
};

module.exports = async parameters => {
  if (parameters.electronPlatformName !== 'darwin') {
    return;
  }

  // Read and validate auth information from environment variables
  let authInfo;
  try {
    authInfo = getAuthInfo();
  } catch (error) {
    console.log(`Skipping notarization: ${error.message}`);
    return;
  }

  // https://github.com/electron-userland/electron-builder/blob/c11fa1f1033aeb7c378856d7db93369282d363f5/packages/app-builder-lib/src/codeSign/macCodeSign.ts#L22-L49
  if (util.isPullRequest()) {
    if (!isEnvTrue(process.env.CSC_FOR_PULL_REQUEST)) {
      console.log('Skipping notarizing, since app was not signed.');
      return;
    }
  }

  // Only notarize the app on the master branch
  if (
    !isEnvTrue(process.env.CSC_FOR_PULL_REQUEST) && (
      (process.env.CIRCLE_BRANCH && process.env.CIRCLE_BRANCH !== 'master') ||
      (process.env.TRAVIS_BRANCH && process.env.TRAVIS_BRANCH !== 'master')
    )
  ) {
    return;
  }

  const {productSignCertificateName, ...notarizeOptions} = authInfo;
  const {artifactPaths, configuration: {appId}} = parameters;

  const pkgPath = artifactPaths.find(filePath => path.extname(filePath) === '.pkg');

  if (!pkgPath) {
    console.log('Skipping notarizing, since no pkg artifact was found');
    return;
  }

  const {dir, name} = path.parse(pkgPath);
  const signedPath = path.resolve(dir, `${name}-signed.pkg`);

  console.log(`Signing ${pkgPath}...`);
  await signPackage(productSignCertificateName, pkgPath, signedPath);

  fs.renameSync(pkgPath, path.resolve(dir, `${name}-unsigned.pkg`));
  fs.renameSync(signedPath, pkgPath);

  console.log(`Notarizing ${pkgPath}...`);
  const uuid = await startNotarizingPackage({
    pkgPath,
    appId,
    notarizeOpts: notarizeOptions
  });
  await delay(10000);
  await waitForNotarize({uuid, notarizeOpts: notarizeOptions});
  await stapleApp({pkgPath});
  console.log(`Notarized ${pkgPath} successfully.`);
};
